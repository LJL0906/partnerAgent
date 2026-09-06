import { describe, expect, it } from 'vitest';
import {
  DATABASE_MIGRATIONS,
  createDatabaseDataSource,
} from './database-definition.js';
import { AddToolReconciliation1788512000000 } from './migrations/1788512000000-add-tool-reconciliation.js';
import { AddToolControlOutboxRemediation1788513000000 } from './migrations/1788513000000-add-tool-control-outbox-remediation.js';
import { CreateAccountTables1788514000000 } from './migrations/1788514000000-create-account-tables.js';
import { AddChatTaskModelSelection1788515000000 } from './migrations/1788515000000-add-chat-task-model-selection.js';
import { AddOffReasoningLevel1788518000000 } from './migrations/1788518000000-add-off-reasoning-level.js';
import { AlignChatMessageRuntime1788519000000 } from './migrations/1788519000000-align-chat-message-runtime.js';
import { AddChatTaskOutputMode1788520000000 } from './migrations/1788520000000-add-chat-task-output-mode.js';
import { AddChatTaskRevision1788521000000 } from './migrations/1788521000000-add-chat-task-revision.js';
import { CompleteActionWorkflow1788522000000 } from './migrations/1788522000000-complete-action-workflow.js';

describe('database definition', () => {
  it('registers the latest reversible migration exactly once', () => {
    expect(DATABASE_MIGRATIONS.at(-1)).toBe(CompleteActionWorkflow1788522000000);
    expect(DATABASE_MIGRATIONS.filter((migration) => migration === CompleteActionWorkflow1788522000000)).toHaveLength(1);
    expect(
      DATABASE_MIGRATIONS.filter(
        (migration) => migration === AddChatTaskRevision1788521000000,
      ),
    ).toHaveLength(1);
    expect(DATABASE_MIGRATIONS).toContain(AddChatTaskOutputMode1788520000000);
    expect(DATABASE_MIGRATIONS).toContain(AlignChatMessageRuntime1788519000000);
    expect(
      DATABASE_MIGRATIONS.filter(
        (migration) => migration === AddOffReasoningLevel1788518000000,
      ),
    ).toHaveLength(1);
    expect(
      DATABASE_MIGRATIONS.filter(
        (migration) => migration === AddToolReconciliation1788512000000,
      ),
    ).toHaveLength(1);
    expect(DATABASE_MIGRATIONS.filter((migration) => migration === CreateAccountTables1788514000000)).toHaveLength(1);
    expect(DATABASE_MIGRATIONS.filter((migration) => migration === AddChatTaskModelSelection1788515000000)).toHaveLength(1);
    expect(
      DATABASE_MIGRATIONS.filter(
        (migration) =>
          migration === AddToolControlOutboxRemediation1788513000000,
      ),
    ).toHaveLength(1);
  });

  it('keeps schema synchronization disabled', () => {
    const dataSource = createDatabaseDataSource(
      'postgresql://user:password@localhost/partner_agent_migration_verify',
    );

    expect(dataSource.options.synchronize).toBe(false);
  });
});


