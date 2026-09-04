import { getMetadataArgsStorage, type QueryRunner } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { AgentRunTraceEntity } from './entities/agent-run-trace.entity.js';
import { CreateAgentRunTraces1788511000000 } from './migrations/1788511000000-create-agent-run-traces.js';

const normalize = (sql: string) =>
  sql.replace(/\s+/gu, ' ').trim().toLowerCase();

describe('CreateAgentRunTraces1788511000000', () => {
  it('creates bounded metadata-only trace storage and supports down', async () => {
    const statements: string[] = [];
    const runner = {
      query: async (sql: string) => void statements.push(normalize(sql)),
    } as unknown as QueryRunner;
    const migration = new CreateAgentRunTraces1788511000000();

    await migration.up(runner);
    await migration.down(runner);
    const sql = statements.join('\n');

    expect(sql).toContain('create table agent_run_trace_events');
    expect(sql).toContain('sequence > 0 and sequence <= 256');
    expect(sql).toContain(
      'on agent_run_trace_events (owner_id, created_at desc, id desc)',
    );
    expect(sql).toContain(
      'on agent_run_trace_events (owner_id, run_id, created_at, id)',
    );
    expect(sql).toContain('drop table if exists agent_run_trace_events');
    expect(sql).not.toMatch(
      /prompt|wire_payload|message_content|tool_args|tool_result|raw_error|request_body|response_body/gu,
    );
  });

  it('maps only explicit safe metadata columns on the entity', () => {
    const columns = getMetadataArgsStorage()
      .columns.filter((column) => column.target === AgentRunTraceEntity)
      .map((column) => column.options.name ?? column.propertyName);

    expect(columns).toEqual(
      expect.arrayContaining([
        'run_id',
        'owner_id',
        'session_id',
        'task_id',
        'operation_id',
        'request_id',
        'tool_call_id',
        'event_type',
        'provider',
        'model_id',
        'duration_ms',
        'input_tokens',
        'output_tokens',
        'total_tokens',
        'error_code',
      ]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([
        'prompt',
        'content',
        'args',
        'result',
        'raw_error',
      ]),
    );
  });
});
