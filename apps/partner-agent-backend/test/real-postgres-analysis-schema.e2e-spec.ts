import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.REAL_POSTGRES_DATABASE_URL;
const describeReal = databaseUrl ? describe : describe.skip;

interface TaskFixture {
  ownerId: string;
  recordId: string;
  taskId: string;
}

describeReal('PostgreSQL analysis schema constraints', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({ type: 'postgres', url: databaseUrl });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it('persists the complete same-owner analysis and confirmation source chain', async () => {
    const fixture = await seedTask('complete');
    const runId = await insertRun(fixture, 'action');
    const analysisId = randomUUID();

    const analyses = await dataSource.query(
      `insert into structured_analyses(
         id,owner_id,analysis_run_id,status,result_json
       ) values ($1,$2,$3,'valid',$4)
       returning id,schema_version,status,validation_errors`,
      [
        analysisId,
        fixture.ownerId,
        runId,
        { schema_version: 1, analysis_type: 'action', candidates: [] },
      ],
    );
    const batches = await dataSource.query(
      `insert into confirmation_batches(
         user_id,source_record_id,source_analysis_id,risk_level
       ) values ($1,$2,$3,'normal')
       returning id,batch_status,version,expires_at,created_at`,
      [fixture.ownerId, fixture.recordId, analysisId],
    );

    expect(analyses[0]).toMatchObject({
      id: analysisId,
      schema_version: 1,
      status: 'valid',
      validation_errors: [],
    });
    expect(batches[0]).toMatchObject({
      batch_status: 'pending',
      version: '1',
    });
    expect(
      new Date(batches[0].expires_at).getTime() -
        new Date(batches[0].created_at).getTime(),
    ).toBe(24 * 60 * 60 * 1000);
  });

  it('rejects cross-owner record, task and analysis-run references', async () => {
    const ownerA = await seedTask('owner-a');
    const ownerB = await seedTask('owner-b');

    await expectConstraint(
      insertRunRows({ ...ownerA, recordId: ownerB.recordId }),
      'analysis_runs_owner_record_fk',
    );
    await expectConstraint(
      insertRunRows({ ...ownerA, taskId: ownerB.taskId }),
      'analysis_runs_owner_task_fk',
    );

    const runId = await insertRun(ownerA, 'action');
    await expectConstraint(
      insertAnalysisRows(ownerB.ownerId, runId),
      'structured_analyses_owner_run_fk',
    );
  });

  it('enforces analysis type, statuses and positive versions', async () => {
    const fixture = await seedTask('checks');
    await expectConstraint(
      insertRunRows(fixture, 'unknown'),
      'analysis_runs_type_check',
    );
    await expectConstraint(
      insertRunRows(fixture, 'action', 'unknown'),
      'analysis_runs_status_check',
    );
    await expectConstraint(
      insertRunRows(fixture, 'action', 'completed', 0),
      'analysis_runs_version_check',
    );

    const runId = await insertRun(fixture, 'action');
    await expectConstraint(
      insertAnalysisRows(fixture.ownerId, runId, 'unknown'),
      'structured_analyses_status_check',
    );
    await expectConstraint(
      insertAnalysisRows(fixture.ownerId, runId, 'valid', 0),
      'structured_analyses_schema_version_check',
    );
  });

  it('rejects duplicate runs for the same owner, task and analysis type', async () => {
    const fixture = await seedTask('repeat');
    await insertRun(fixture, 'action');

    await expectConstraint(
      dataSource.query(
        `insert into analysis_runs(
           owner_id,original_record_id,chat_task_id,analysis_type,request_fingerprint
         ) values ($1,$2,$3,'action',$4)`,
        [fixture.ownerId, fixture.recordId, fixture.taskId, randomUUID()],
      ),
      'analysis_runs_owner_task_type_key',
    );
  });

  it('rejects cross-owner confirmation batch record and analysis sources', async () => {
    const ownerA = await seedTask('batch-owner-a');
    const ownerB = await seedTask('batch-owner-b');
    const runA = await insertRun(ownerA, 'action');
    const runB = await insertRun(ownerB, 'action');
    const analysisA = await insertAnalysis(ownerA.ownerId, runA);
    const analysisB = await insertAnalysis(ownerB.ownerId, runB);

    await expectConstraint(
      dataSource.query(
        `insert into confirmation_batches(
           user_id,source_record_id,source_analysis_id
         ) values ($1,$2,$3)`,
        [ownerA.ownerId, ownerB.recordId, analysisA],
      ),
      'confirmation_batches_user_record_fk',
    );
    await expectConstraint(
      dataSource.query(
        `insert into confirmation_batches(
           user_id,source_record_id,source_analysis_id
         ) values ($1,$2,$3)`,
        [ownerA.ownerId, ownerA.recordId, analysisB],
      ),
      'confirmation_batches_user_analysis_fk',
    );
  });

  async function seedTask(label: string): Promise<TaskFixture> {
    const ownerId = `analysis-${label}-${randomUUID()}`;
    const sessionId = randomUUID();
    const operationId = randomUUID();
    const recordId = randomUUID();
    const messageId = randomUUID();
    const taskId = randomUUID();
    const inputId = randomUUID();

    await dataSource.query('insert into users(id) values ($1)', [ownerId]);
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
       ) values ($1,$2,$3,$4,'SubmitTextInput','{}',now())`,
      [randomUUID(), ownerId, operationId, `operation-${label}`],
    );
    await dataSource.query(
      `insert into original_records(
         id,owner_id,session_id,input_id,request_fingerprint,content,created_at
       ) values ($1,$2,$3,$4,$5,'analysis source',now())`,
      [recordId, ownerId, sessionId, inputId, `record-${label}`],
    );
    await dataSource.query(
      `insert into session_messages(
         id,session_id,owner_id,sequence,role,content,status,created_at,completed_at
       ) values ($1,$2,$3,1,'user','analysis source','complete',now(),now())`,
      [messageId, sessionId, ownerId],
    );
    await dataSource.query(
      `insert into chat_tasks(
         id,owner_id,session_id,operation_id,input_id,original_record_id,
         user_message_id,state,created_at,updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,'completed',now(),now())`,
      [taskId, ownerId, sessionId, operationId, inputId, recordId, messageId],
    );
    return { ownerId, recordId, taskId };
  }

  async function insertRun(
    fixture: TaskFixture,
    type: string,
  ): Promise<string> {
    const rows = await insertRunRows(fixture, type);
    return rows[0].id as string;
  }

  function insertRunRows(
    fixture: TaskFixture,
    type = 'action',
    status = 'completed',
    version = 1,
  ) {
    return dataSource.query(
      `insert into analysis_runs(
         owner_id,original_record_id,chat_task_id,analysis_type,status,
         request_fingerprint,version,completed_at
       ) values ($1,$2,$3,$4,$5,$6,$7,now()) returning id`,
      [
        fixture.ownerId,
        fixture.recordId,
        fixture.taskId,
        type,
        status,
        randomUUID(),
        version,
      ],
    );
  }

  async function insertAnalysis(
    ownerId: string,
    runId: string,
  ): Promise<string> {
    const rows = await insertAnalysisRows(ownerId, runId);
    return rows[0].id as string;
  }

  function insertAnalysisRows(
    ownerId: string,
    runId: string,
    status = 'valid',
    schemaVersion = 1,
  ) {
    return dataSource.query(
      `insert into structured_analyses(
         owner_id,analysis_run_id,schema_version,status,result_json
       ) values ($1,$2,$3,$4,'{}'::jsonb) returning id`,
      [ownerId, runId, schemaVersion, status],
    );
  }
});

async function expectConstraint(
  operation: Promise<unknown>,
  constraint: string,
): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    driverError: { constraint },
  });
}
