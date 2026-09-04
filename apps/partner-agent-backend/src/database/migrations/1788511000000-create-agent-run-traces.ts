import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentRunTraces1788511000000 implements MigrationInterface {
  name = 'CreateAgentRunTraces1788511000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create table agent_run_trace_events (
        id uuid primary key,
        run_id uuid not null,
        sequence integer not null,
        owner_id text not null,
        session_id text not null,
        task_id text,
        operation_id text,
        request_id uuid,
        tool_call_id text,
        source text not null,
        event_type text not null,
        status text,
        provider text,
        model_id text,
        tool_name text,
        duration_ms integer,
        input_tokens integer,
        output_tokens integer,
        total_tokens integer,
        model_turns integer,
        tool_calls integer,
        output_token_budget integer,
        deadline_ms integer,
        error_code text,
        created_at timestamptz not null default transaction_timestamp(),
        constraint agent_run_trace_events_run_sequence_key unique (run_id, sequence),
        constraint agent_run_trace_events_sequence_check check (sequence > 0 and sequence <= 256),
        constraint agent_run_trace_events_numbers_check check (
          (duration_ms is null or duration_ms >= 0)
          and (input_tokens is null or input_tokens >= 0)
          and (output_tokens is null or output_tokens >= 0)
          and (total_tokens is null or total_tokens >= 0)
          and (model_turns is null or model_turns >= 0)
          and (tool_calls is null or tool_calls >= 0)
          and (output_token_budget is null or output_token_budget >= 0)
          and (deadline_ms is null or deadline_ms >= 0)
        ),
        constraint agent_run_trace_events_type_check check (event_type in (
          'agent_run_started','agent_turn_started','agent_budget_observed',
          'agent_first_token','agent_tool_started','agent_tool_finished',
          'agent_run_finished','model_request_started','model_egress_decided',
          'model_first_response','model_request_finished'
        ))
      )
    `);
    await queryRunner.query(`
      create index agent_run_trace_events_owner_created_idx
        on agent_run_trace_events (owner_id, created_at desc, id desc)
    `);
    await queryRunner.query(`
      create index agent_run_trace_events_owner_run_created_idx
        on agent_run_trace_events (owner_id, run_id, created_at, id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('drop table if exists agent_run_trace_events');
  }
}
