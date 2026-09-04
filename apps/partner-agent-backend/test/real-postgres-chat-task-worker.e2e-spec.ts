import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CORE_ENTITIES } from '../src/database/core-entities.js';
import { ChatSessionEntity } from '../src/database/entities/chat-session.entity.js';
import { SessionMessageEntity } from '../src/database/entities/session-message.entity.js';
import { ToolAuditEntity } from '../src/database/entities/tool-audit.entity.js';
import { ToolConfirmationEntity } from '../src/database/entities/tool-confirmation.entity.js';
import { ToolExecutionReceiptEntity } from '../src/database/entities/tool-execution-receipt.entity.js';
import { TypeOrmChatTaskStore } from '../src/local-core-api/typeorm-chat-task.store.js';
import {
  CHAT_TASK_NOTIFICATION_CHANNEL,
  PostgresChatTaskNotifier,
} from '../src/local-core-api/chat-task-notifier.js';

const databaseUrl = process.env.REAL_POSTGRES_DATABASE_URL;
const describeReal = databaseUrl ? describe : describe.skip;

describeReal('PostgreSQL ChatTask worker recovery', () => {
  let dataSource: DataSource;
  const ownerId = `chat-worker-${randomUUID()}`;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: databaseUrl,
      entities: [
        ChatSessionEntity,
        SessionMessageEntity,
        ToolConfirmationEntity,
        ToolAuditEntity,
        ToolExecutionReceiptEntity,
        ...CORE_ENTITIES,
      ],
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      for (const table of [
        'tool_confirmation_requests',
        'chat_tasks',
        'session_messages',
        'original_records',
        'local_core_operations',
        'chat_sessions',
      ]) {
        await dataSource.query(`delete from ${table} where owner_id = $1`, [
          ownerId,
        ]);
      }
      await dataSource.query('delete from users where id = $1', [ownerId]);
      await dataSource.destroy();
    }
  });

  it('recovers an expired running task to its pending tool confirmation', async () => {
    const ids = {
      session: randomUUID(),
      operation: randomUUID(),
      record: randomUUID(),
      message: randomUUID(),
      input: randomUUID(),
      task: randomUUID(),
      confirmation: randomUUID(),
    };
    await dataSource.query(`insert into users(id) values ($1)`, [ownerId]);
    await dataSource.query(
      `insert into chat_sessions(
         id,owner_id,context_format,context_json,context_revision,
         created_at,last_active_at,version,lifecycle_status,updated_at
       ) values ($1,$2,'pi-agent-v2-sequence-watermark','[]',0,now(),now(),1,'active',now())`,
      [ids.session, ownerId],
    );
    await dataSource.query(
      `insert into local_core_operations(
         id,owner_id,operation_id,request_fingerprint,command_name,result_json,created_at
       ) values ($1,$2,$3,'fingerprint','SubmitTextInput','{}',now())`,
      [randomUUID(), ownerId, ids.operation],
    );
    await dataSource.query(
      `insert into original_records(
         id,owner_id,session_id,input_id,request_fingerprint,content,created_at
       ) values ($1,$2,$3,$4,'fingerprint','tool input',now())`,
      [ids.record, ownerId, ids.session, ids.input],
    );
    await dataSource.query(
      `insert into session_messages(
         id,session_id,owner_id,sequence,role,content,status,input_id,
         operation_id,task_id,original_record_id,created_at,completed_at
       ) values ($1,$2,$3,1,'user','tool input','complete',$4,$5,$6,$7,now(),now())`,
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
      `insert into chat_tasks(
         id,owner_id,session_id,operation_id,input_id,original_record_id,
         user_message_id,state,created_at,updated_at,started_at,
         lease_owner,lease_expires_at,attempt_count
       ) values ($1,$2,$3,$4,$5,$6,$7,'running',now(),now(),now(),
         'worker:crashed:attempt',now() - interval '1 second',1)`,
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
    await dataSource.query(
      `insert into tool_confirmation_requests(
         id,owner_id,session_id,task_id,operation_id,tool_call_id,tool_name,
         risk_level,status,arguments_json,request_summary,created_at,expires_at
       ) values ($1,$2,$3,$4,$5,'tool-call','external-tool','high','pending',
         '{}','pending request',now(),now() + interval '10 minutes')`,
      [ids.confirmation, ownerId, ids.session, ids.task, ids.operation],
    );

    const store = new TypeOrmChatTaskStore(dataSource);
    await expect(store.recoverExpiredLeases()).resolves.toBe(1);
    await expect(store.getTask(ownerId, ids.task)).resolves.toMatchObject({
      state: 'waiting_tool_approval',
      waitingToolConfirmationId: ids.confirmation,
    });
    await expect(
      store.claimToolResume(
        ids.task,
        ownerId,
        randomUUID(),
        `tool-decision:worker:${randomUUID()}:${randomUUID()}`,
        30_000,
      ),
    ).resolves.toBeUndefined();
    const leaseOwner = `tool-decision:worker:${randomUUID()}:${ids.confirmation}`;
    await expect(
      store.claimToolResume(
        ids.task,
        ownerId,
        ids.confirmation,
        leaseOwner,
        30_000,
      ),
    ).resolves.toMatchObject({ state: 'running' });
    await dataSource.query(
      `update chat_tasks set lease_expires_at=now() - interval '1 second'
       where owner_id=$1 and id=$2`,
      [ownerId, ids.task],
    );
    await store.recoverExpiredLeases();
    await expect(store.getTask(ownerId, ids.task)).resolves.toMatchObject({
      state: 'waiting_tool_approval',
      waitingToolConfirmationId: ids.confirmation,
    });
  });

  it('delivers task wakeups only after the notifying transaction commits', async () => {
    const notifier = new PostgresChatTaskNotifier(dataSource, databaseUrl!);
    const taskId = randomUUID();
    let received = false;
    let resolveReceived!: () => void;
    const delivered = new Promise<void>((resolve) => {
      resolveReceived = resolve;
    });
    await notifier.start((receivedTaskId) => {
      if (receivedTaskId !== taskId) return;
      received = true;
      resolveReceived();
    });

    try {
      await dataSource.transaction(async (manager) => {
        await manager.query('select pg_notify($1, $2)', [
          CHAT_TASK_NOTIFICATION_CHANNEL,
          taskId,
        ]);
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(received).toBe(false);
      });
      await Promise.race([
        delivered,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('notification timeout')), 2_000),
        ),
      ]);
      expect(received).toBe(true);
    } finally {
      await notifier.stop();
    }
  });
});
