import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATABASE_ENTITIES } from '../src/database/database-definition.js';
import {
  OutboxRemediationService,
  buildOutboxRemediationPhrase,
} from '../src/tools/outbox-remediation.service.js';
import { TypeOrmToolOperationStore } from '../src/tools/typeorm-tool-operation.store.js';

const databaseUrl = process.env.REAL_POSTGRES_DATABASE_URL;
const describeReal = databaseUrl ? describe : describe.skip;

describeReal('PostgreSQL tool control outbox', () => {
  let dataSource: DataSource;
  const ownerId = `tool-outbox-${randomUUID()}`;
  const ids = {
    session: randomUUID(),
    operation: randomUUID(),
    record: randomUUID(),
    message: randomUUID(),
    input: randomUUID(),
    task: randomUUID(),
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: databaseUrl,
      entities: [...DATABASE_ENTITIES],
    });
    await dataSource.initialize();
    await seedTask(dataSource, ownerId, ids);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await dataSource.query(
      `delete from outbox_remediation_audits where event_id in (
         select event_id from tool_control_outbox where owner_id=$1
       )`,
      [ownerId],
    );
    for (const table of [
      'tool_control_outbox',
      'tool_execution_receipts',
      'tool_confirmation_requests',
      'chat_tasks',
      'session_messages',
      'original_records',
      'local_core_operations',
      'chat_sessions',
    ]) {
      await dataSource.query(`delete from ${table} where owner_id=$1`, [
        ownerId,
      ]);
    }
    await dataSource.query('delete from users where id=$1', [ownerId]);
    await dataSource.destroy();
  });

  it('commits confirmation, dismissal and undo notifications with state', async () => {
    const store = new TypeOrmToolOperationStore(dataSource);
    const confirmedId = randomUUID();
    await store.saveConfirmation(confirmation(confirmedId, ownerId, ids));
    await expect(store.claimConfirmation(confirmedId)).resolves.toBe(true);
    await store.updateConfirmation(confirmedId, {
      status: 'succeeded',
      result: {
        content: [{ type: 'text', text: 'ok' }],
        details: { ok: true },
      },
    });
    const confirmedRows = (await dataSource.query(
      `select event_type from tool_control_outbox
       where event_key like $1 order by sequence_no`,
      [`tool-control:${confirmedId}:%`],
    )) as Array<{ event_type: string }>;
    expect(confirmedRows.map((row) => row.event_type)).toEqual([
      'tool_confirmation_confirmed',
      'tool_execution_start',
      'tool_execution_end',
    ]);

    const dismissedId = randomUUID();
    await store.saveConfirmation(confirmation(dismissedId, ownerId, ids));
    await store.claimConfirmation(dismissedId, 'dismiss');
    await store.updateConfirmation(dismissedId, { status: 'dismissed' });

    const dismissedRows = (await dataSource.query(
      `select event_type from tool_control_outbox
       where event_key like $1 order by sequence_no`,
      [`tool-control:${dismissedId}:%`],
    )) as Array<{ event_type: string }>;
    expect(dismissedRows.map((row) => row.event_type)).toEqual([
      'tool_confirmation_dismissed',
    ]);

    const undoId = randomUUID();
    const executionId = randomUUID();
    await store.saveConfirmation(confirmation(undoId, ownerId, ids));
    await store.saveReceipt({
      id: executionId,
      confirmationId: undoId,
      ownerId,
      sessionId: ids.session,
      toolName: 'external-tool',
      undoPayload: { safe: true },
      status: 'applied',
      appliedAt: new Date(),
      undoExpiresAt: new Date(Date.now() + 60_000),
    });
    await expect(store.claimReceiptForUndo(executionId)).resolves.toBe(true);
    await store.completeUndo(executionId);

    const rows = (await dataSource.query(
      `select event_type from tool_control_outbox
       where owner_id=$1 order by created_at, sequence_no`,
      [ownerId],
    )) as Array<{ event_type: string }>;
    expect(rows.map((row) => row.event_type)).toEqual(
      expect.arrayContaining([
        'tool_confirmation_confirmed',
        'tool_execution_start',
        'tool_execution_end',
        'tool_confirmation_dismissed',
        'tool_undo_completed',
      ]),
    );
  });

  it('lists and safely retries a poison event with an audit record', async () => {
    const mutation = await dataSource.query(
      `update tool_control_outbox set attempt_count=8,last_error_code='FAILED'
       where event_id=(select event_id from tool_control_outbox where owner_id=$1 limit 1)
       returning event_id`,
      [ownerId],
    );
    const row = (
      Array.isArray(mutation?.[0]) ? mutation[0] : mutation
    ) as Array<{
      event_id: string;
    }>;
    const service = new OutboxRemediationService(dataSource);
    const event = (await service.list()).find(
      (candidate) => candidate.eventId === row[0]?.event_id,
    );
    expect(event).toBeDefined();
    const input = {
      kind: event!.kind,
      eventId: event!.eventId,
      action: 'retry' as const,
      expectedAttempts: 8,
      operatorLabel: 'e2e-operator',
      confirmationPhrase: '',
    };
    input.confirmationPhrase = buildOutboxRemediationPhrase(input);
    await service.remediate(input);
    const [updated] = (await dataSource.query(
      'select attempt_count,last_error_code from tool_control_outbox where event_id=$1',
      [event!.eventId],
    )) as Array<{ attempt_count: number; last_error_code: string }>;
    expect(updated).toMatchObject({
      attempt_count: 0,
      last_error_code: 'MANUAL_RETRY',
    });
  });
});

function confirmation(id: string, ownerId: string, ids: typeof baseIds) {
  return {
    id,
    ownerId,
    sessionId: ids.session,
    taskId: ids.task,
    operationId: ids.operation,
    toolCallId: `call-${id}`,
    toolName: 'external-tool',
    riskLevel: 'high' as const,
    status: 'pending' as const,
    arguments: { safe: true },
    requestSummary: 'safe request',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  };
}

const baseIds = {
  session: '',
  operation: '',
  record: '',
  message: '',
  input: '',
  task: '',
};

async function seedTask(
  dataSource: DataSource,
  ownerId: string,
  ids: typeof baseIds,
): Promise<void> {
  await dataSource.query('insert into users(id) values ($1)', [ownerId]);
  await dataSource.query(
    `insert into chat_sessions(id,owner_id,context_format,context_json,
      context_revision,created_at,last_active_at,version,lifecycle_status,updated_at)
     values ($1,$2,'pi-agent-v2-sequence-watermark','[]',0,now(),now(),1,'active',now())`,
    [ids.session, ownerId],
  );
  await dataSource.query(
    `insert into local_core_operations
      (id,owner_id,operation_id,request_fingerprint,command_name,result_json,created_at)
     values ($1,$2,$3,'fingerprint','SubmitTextInput','{}',now())`,
    [randomUUID(), ownerId, ids.operation],
  );
  await dataSource.query(
    `insert into original_records
      (id,owner_id,session_id,input_id,request_fingerprint,content,created_at)
     values ($1,$2,$3,$4,'fingerprint','tool input',now())`,
    [ids.record, ownerId, ids.session, ids.input],
  );
  await dataSource.query(
    `insert into session_messages
      (id,session_id,owner_id,sequence,role,content,status,input_id,
       operation_id,task_id,original_record_id,created_at,completed_at)
     values ($1,$2,$3,1,'user','tool input','complete',$4,$5,$6,$7,now(),now())`,
    [
      ids.message,
      ids.session,
      ownerId,
      ids.input,
      ids.operation,
      ids.task,
      ids.record,
    ],
  );
  await dataSource.query(
    `insert into chat_tasks
      (id,owner_id,session_id,operation_id,input_id,original_record_id,
       user_message_id,state,created_at,updated_at,attempt_count)
     values ($1,$2,$3,$4,$5,$6,$7,'queued',now(),now(),1)`,
    [
      ids.task,
      ownerId,
      ids.session,
      ids.operation,
      ids.input,
      ids.record,
      ids.message,
    ],
  );
}
