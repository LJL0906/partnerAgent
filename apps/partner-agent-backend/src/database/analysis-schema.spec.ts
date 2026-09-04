import type { QueryRunner } from 'typeorm';
import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';
import {
  AnalysisRunEntity,
  CORE_ENTITIES,
  StructuredAnalysisEntity,
} from './core-entities.js';
import { ChatTaskEntity } from './entities/chat-task.entity.js';
import { CreateAnalysisTables1788505000000 } from './migrations/1788505000000-create-analysis-tables.js';

const normalize = (sql: string) =>
  sql.replace(/\s+/g, ' ').trim().toLowerCase();

describe('CreateAnalysisTables1788505000000', () => {
  it('creates owner-isolated analysis runs and versioned structured results', async () => {
    const statements: string[] = [];
    const runner = {
      query: async (sql: string) => void statements.push(normalize(sql)),
    } as unknown as QueryRunner;

    await new CreateAnalysisTables1788505000000().up(runner);
    const sql = statements.join('\n');

    expect(sql).toContain('create table analysis_runs');
    expect(sql).toContain('create table structured_analyses');
    expect(sql).toContain(
      'foreign key (owner_id, original_record_id) references original_records(owner_id, id)',
    );
    expect(sql).toContain(
      'foreign key (owner_id, chat_task_id) references chat_tasks(owner_id, id)',
    );
    expect(sql).toContain(
      'foreign key (owner_id, analysis_run_id) references analysis_runs(owner_id, id) on delete cascade',
    );
    expect(sql).toContain(
      "analysis_type in ('idea_organize','experience_review','problem_analysis','content_extract','action')",
    );
    expect(sql).toContain(
      "status in ('queued','running','completed','partially_completed','failed','cancelled')",
    );
    expect(sql).toContain('request_fingerprint text not null');
    expect(sql).toContain(
      'analysis_runs_owner_task_type_key unique (owner_id, chat_task_id, analysis_type)',
    );
    expect(sql).toContain('analysis_runs_version_check check (version >= 1)');
    expect(sql).toContain(
      'structured_analyses_owner_run_key unique (owner_id, analysis_run_id)',
    );
    expect(sql).toContain('schema_version integer not null default 1');
    expect(sql).toContain("status in ('valid','partially_valid','invalid')");
    expect(sql).toContain(
      "validation_errors jsonb not null default '[]'::jsonb",
    );
    expect(sql).toContain(
      'foreign key (user_id, source_analysis_id) references structured_analyses(owner_id, id)',
    );
    expect(sql).toContain(
      'foreign key (user_id, source_record_id) references original_records(owner_id, id)',
    );
    expect(sql).toContain('analysis_runs_owner_status_created_idx');
    expect(sql).toContain('analysis_runs_owner_record_created_idx');
    expect(sql).toContain('analysis_runs_owner_task_created_idx');
  });

  it('drops dependent source constraints before analysis tables', async () => {
    const statements: string[] = [];
    const runner = {
      query: async (sql: string) => void statements.push(normalize(sql)),
    } as unknown as QueryRunner;

    await new CreateAnalysisTables1788505000000().down(runner);

    expect(statements[0]).toContain(
      'drop constraint if exists confirmation_batches_user_analysis_fk',
    );
    expect(statements[1]).toBe('drop table if exists structured_analyses');
    expect(statements[2]).toBe('drop table if exists analysis_runs');
  });

  it('registers both analysis entities and the chat task composite owner key', () => {
    expect(CORE_ENTITIES).toEqual(
      expect.arrayContaining([AnalysisRunEntity, StructuredAnalysisEntity]),
    );

    const tables = getMetadataArgsStorage().tables;
    expect(
      tables.find((table) => table.target === AnalysisRunEntity)?.name,
    ).toBe('analysis_runs');
    expect(
      tables.find((table) => table.target === StructuredAnalysisEntity)?.name,
    ).toBe('structured_analyses');

    const uniques = getMetadataArgsStorage().uniques;
    expect(
      uniques.some(
        (unique) =>
          unique.target === AnalysisRunEntity &&
          unique.name === 'analysis_runs_owner_task_type_key',
      ),
    ).toBe(true);
    expect(
      uniques.some(
        (unique) =>
          unique.target === ChatTaskEntity &&
          unique.name === 'chat_tasks_owner_id_key',
      ),
    ).toBe(true);
  });
});
