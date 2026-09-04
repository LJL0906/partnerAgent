import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TypeOrmEgressDecisionStore } from '../src/model-gateway/typeorm-egress-decision.store.js';

const databaseUrl = process.env.REAL_POSTGRES_DATABASE_URL;
const describeReal = databaseUrl ? describe : describe.skip;

describeReal('PostgreSQL privacy decision persistence', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({ type: 'postgres', url: databaseUrl });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it('installs the state constraints and partial indexes', async () => {
    const constraints = await dataSource.query(
      `select conname from pg_constraint
       where conrelid = 'egress_decision_requests'::regclass`,
    );
    expect(constraints.map((row: { conname: string }) => row.conname)).toEqual(
      expect.arrayContaining([
        'egress_decision_owner_task_fk',
        'egress_decision_state_check',
        'egress_decision_decision_check',
        'egress_decision_state_decision_check',
        'egress_decision_expiry_check',
      ]),
    );
    const indexes = await dataSource.query(
      `select indexname from pg_indexes
       where tablename = 'egress_decision_requests'`,
    );
    expect(indexes.map((row: { indexname: string }) => row.indexname)).toEqual(
      expect.arrayContaining([
        'egress_decision_pending_expiry_idx',
        'egress_decision_owner_state_created_idx',
        'egress_decision_active_payload_key',
      ]),
    );
  });

  it('allows one concurrent decision and consumes it once after reconnect', async () => {
    const seeded = await seedTask('concurrent');
    const store = new TypeOrmEgressDecisionStore(dataSource);
    const pending = await store.createOrGetPending({
      ...seeded,
      requestFingerprint: 'payload-fingerprint',
      provider: 'deepseek',
      modelId: 'model-a',
      source: 'submit_text_input',
      categories: ['secret'],
      ttlMs: 900_000,
    });
    const outcomes = await Promise.allSettled([
      store.submitDecision({
        ownerId: seeded.ownerId,
        egressId: pending.id,
        decision: 'allow',
        commandOperationId: randomUUID(),
        commandRequestFingerprint: 'decision-a',
      }),
      store.submitDecision({
        ownerId: seeded.ownerId,
        egressId: pending.id,
        decision: 'redact',
        commandOperationId: randomUUID(),
        commandRequestFingerprint: 'decision-b',
      }),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const restarted = new DataSource({ type: 'postgres', url: databaseUrl });
    await restarted.initialize();
    try {
      const restartedStore = new TypeOrmEgressDecisionStore(restarted);
      const current = await restartedStore.findCurrentForTask(
        seeded.taskId,
        seeded.ownerId,
      );
      expect(current?.state).toMatch(/^ready_(allow|redact)$/);
      const binding = {
        ownerId: seeded.ownerId,
        taskId: seeded.taskId,
        requestFingerprint: 'payload-fingerprint',
        provider: 'deepseek',
        modelId: 'model-a',
        source: 'submit_text_input',
      };
      await expect(
        restartedStore.consumeMatchingDecision(binding),
      ).resolves.toMatchObject({ status: 'consumed' });
      await expect(
        restartedStore.consumeMatchingDecision(binding),
      ).resolves.toMatchObject({ status: 'missing' });
    } finally {
      await restarted.destroy();
    }
  });

  it('expires pending records using database time', async () => {
    const seeded = await seedTask('expiry');
    const store = new TypeOrmEgressDecisionStore(dataSource);
    const pending = await store.createOrGetPending({
      ...seeded,
      requestFingerprint: 'expiry-fingerprint',
      provider: 'deepseek',
      modelId: 'model-a',
      source: 'submit_text_input',
      categories: ['secret'],
      ttlMs: 1,
    });
    await dataSource.query('select pg_sleep(0.01)');
    const expired = await store.expireDue();
    expect(expired).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: pending.id, state: 'expired' })]),
    );
  });

  async function seedTask(label: string) {
    const ownerId = `privacy-${label}-${randomUUID()}`;
    const sessionId = randomUUID();
    const operationId = randomUUID();
    const recordId = randomUUID();
    const messageId = randomUUID();
    const taskId = randomUUID();
    await dataSource.query(`insert into users(id) values ($1)`, [ownerId]);
    await dataSource.query(
      `insert into chat_sessions(
         id,owner_id,context_format,context_json,context_revision,
         created_at,last_active_at,version,lifecycle_status,updated_at
       ) values ($1,$2,'pi-agent-v1','[]',0,now(),now(),1,'active',now())`,
      [sessionId, ownerId],
    );
    await dataSource.query(
      `insert into local_core_operations(
         id,owner_id,operation_id,request_fingerprint,command_name,result_json,created_at
       ) values ($1,$2,$3,'chat-fingerprint','SubmitTextInput','{}',now())`,
      [randomUUID(), ownerId, operationId],
    );
    await dataSource.query(
      `insert into original_records(
         id,owner_id,session_id,input_id,request_fingerprint,content,created_at
       ) values ($1,$2,$3,$4,'chat-fingerprint','private source',now())`,
      [recordId, ownerId, sessionId, randomUUID()],
    );
    await dataSource.query(
      `insert into session_messages(
         id,session_id,owner_id,sequence,role,content,status,created_at,completed_at
       ) values ($1,$2,$3,1,'user','private source','complete',now(),now())`,
      [messageId, sessionId, ownerId],
    );
    await dataSource.query(
      `insert into chat_tasks(
         id,owner_id,session_id,operation_id,input_id,original_record_id,
         user_message_id,state,created_at,updated_at,started_at
       ) values ($1,$2,$3,$4,$5,$6,$7,'waiting_privacy_decision',now(),now(),now())`,
      [
        taskId,
        ownerId,
        sessionId,
        operationId,
        randomUUID(),
        recordId,
        messageId,
      ],
    );
    return { ownerId, taskId, sessionId, operationId };
  }
});
