import { getMetadataArgsStorage, type QueryRunner } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { ChatTaskEntity } from './entities/chat-task.entity.js';
import { AddChatTaskRevision1788521000000 } from './migrations/1788521000000-add-chat-task-revision.js';

const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().toLowerCase();

describe('AddChatTaskRevision1788521000000', () => {
  it('backfills one and enforces a reversible positive task revision', async () => {
    const up: string[] = [];
    const down: string[] = [];
    const migration = new AddChatTaskRevision1788521000000();
    await migration.up({
      query: async (sql: string) => void up.push(normalize(sql)),
    } as unknown as QueryRunner);
    await migration.down({
      query: async (sql: string) => void down.push(normalize(sql)),
    } as unknown as QueryRunner);

    expect(up.join('\n')).toContain('revision integer not null default 1');
    expect(up.join('\n')).toContain('check (revision > 0)');
    expect(down.join('\n')).toContain('drop column if exists revision');
  });

  it('maps revision as an integer entity column with a creation default', () => {
    const column = getMetadataArgsStorage().columns.find(
      (candidate) =>
        candidate.target === ChatTaskEntity && candidate.propertyName === 'revision',
    );

    expect(column?.options).toMatchObject({ type: 'integer', default: 1 });
  });
});
