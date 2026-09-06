import type { QueryRunner } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { AddChatTaskOutputMode1788520000000 } from './migrations/1788520000000-add-chat-task-output-mode.js';

const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().toLowerCase();

describe('AddChatTaskOutputMode1788520000000', () => {
  it('persists only chat or action-preview task modes with a reversible migration', async () => {
    const up: string[] = [];
    const down: string[] = [];
    await new AddChatTaskOutputMode1788520000000().up({
      query: async (sql: string) => void up.push(normalize(sql)),
    } as unknown as QueryRunner);
    await new AddChatTaskOutputMode1788520000000().down({
      query: async (sql: string) => void down.push(normalize(sql)),
    } as unknown as QueryRunner);

    expect(up.join('\n')).toContain("output_mode in ('chat','structured_preview')");
    expect(up.join('\n')).toContain("output_mode = 'structured_preview' and preview_kind = 'action'");
    expect(down.join('\n')).toContain('drop column if exists output_mode');
  });
});
