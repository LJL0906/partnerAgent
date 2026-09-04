import 'dotenv/config';

import { pathToFileURL } from 'node:url';
import { createDatabaseDataSource } from '../src/database/database-definition.js';
import {
  TOOL_RECONCILIATION_OUTCOMES,
  ToolReconciliationError,
  buildToolReconciliationPhrase,
  type ReconcileIndeterminateToolInput,
  type ToolReconciliationOutcome,
} from '../src/tools/tool-operation.store.js';
import { ToolReconciliationService } from '../src/tools/tool-reconciliation.service.js';
import { TypeOrmToolOperationStore } from '../src/tools/typeorm-tool-operation.store.js';

export type ToolReconciliationCliOptions =
  | { command: 'list'; ownerId: string; limit: number }
  | ({ command: 'reconcile' } & ReconcileIndeterminateToolInput);

export class ToolReconciliationCliError extends Error {}

export function parseToolReconciliationArgs(
  args: readonly string[],
): ToolReconciliationCliOptions {
  const command = args[0];
  if (command !== 'list' && command !== 'reconcile') {
    throw new ToolReconciliationCliError('首个参数必须是 list 或 reconcile');
  }
  const values = parseOptions(args.slice(1));
  const ownerId = requireOption(values, '--owner-id');
  if (command === 'list') {
    rejectUnexpected(values, ['--owner-id', '--limit']);
    return {
      command,
      ownerId,
      limit: parsePositiveInteger(
        values.get('--limit') ?? '50',
        '--limit',
        100,
      ),
    };
  }

  rejectUnexpected(values, [
    '--owner-id',
    '--confirmation-id',
    '--expected-version',
    '--expected-state',
    '--outcome',
    '--operator-label',
    '--confirm',
  ]);
  const outcome = requireOption(values, '--outcome');
  if (!(TOOL_RECONCILIATION_OUTCOMES as readonly string[]).includes(outcome)) {
    throw new ToolReconciliationCliError(
      `--outcome 只能是 ${TOOL_RECONCILIATION_OUTCOMES.join('/')}`,
    );
  }
  const expectedStatus = requireOption(values, '--expected-state');
  if (expectedStatus !== 'indeterminate') {
    throw new ToolReconciliationCliError(
      '--expected-state 必须是 indeterminate',
    );
  }
  return {
    command,
    confirmationId: requireOption(values, '--confirmation-id'),
    ownerId,
    expectedVersion: parsePositiveInteger(
      requireOption(values, '--expected-version'),
      '--expected-version',
      2_147_483_646,
    ),
    expectedStatus,
    outcome: outcome as ToolReconciliationOutcome,
    operatorLabel: requireOption(values, '--operator-label'),
    confirmationPhrase: requireOption(values, '--confirm'),
  };
}

export async function executeToolReconciliationCommand(
  options: ToolReconciliationCliOptions,
  service: ToolReconciliationService,
): Promise<unknown> {
  if (options.command === 'list') {
    const records = await service.list(options.ownerId, options.limit);
    return records.map((record) => ({
      ...record,
      confirmationPhrases: Object.fromEntries(
        TOOL_RECONCILIATION_OUTCOMES.map((outcome) => [
          outcome,
          buildToolReconciliationPhrase({
            confirmationId: record.confirmationId,
            ownerId: record.ownerId,
            expectedVersion: record.currentVersion,
            expectedStatus: record.currentStatus,
            outcome,
          }),
        ]),
      ),
    }));
  }
  const { command: _command, ...input } = options;
  return {
    ...(await service.reconcile(input)),
    taskRecovery: 'not_performed',
    toolReplay: 'not_performed',
    operatorAction: 'perform_manual_compensation_if_needed',
  };
}

export async function runToolReconciliationCli(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<unknown> {
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new ToolReconciliationCliError('DATABASE_URL 未配置');
  }
  const dataSource = createDatabaseDataSource(databaseUrl);
  try {
    await dataSource.initialize();
    const service = new ToolReconciliationService(
      new TypeOrmToolOperationStore(dataSource),
    );
    return await executeToolReconciliationCommand(
      parseToolReconciliationArgs(args),
      service,
    );
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

export function formatToolReconciliationError(error: unknown): string {
  if (
    error instanceof ToolReconciliationCliError ||
    error instanceof ToolReconciliationError
  ) {
    return error.message;
  }
  return '工具核对失败（底层错误详情已隐藏）';
}

function parseOptions(args: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!option?.startsWith('--')) {
      throw new ToolReconciliationCliError(`非法参数：${option ?? ''}`);
    }
    if (!value || value.startsWith('--')) {
      throw new ToolReconciliationCliError(`${option} 缺少值`);
    }
    if (values.has(option)) {
      throw new ToolReconciliationCliError(`${option} 不能重复`);
    }
    values.set(option, value.trim());
  }
  return values;
}

function requireOption(values: Map<string, string>, option: string): string {
  const value = values.get(option);
  if (!value) throw new ToolReconciliationCliError(`必须提供 ${option}`);
  return value;
}

function rejectUnexpected(
  values: Map<string, string>,
  allowed: readonly string[],
): void {
  const unexpected = [...values.keys()].find(
    (option) => !allowed.includes(option),
  );
  if (unexpected) {
    throw new ToolReconciliationCliError(`未知参数：${unexpected}`);
  }
}

function parsePositiveInteger(
  value: string,
  option: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!/^\d+$/.test(value)) {
    throw new ToolReconciliationCliError(`${option} 必须是正整数`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new ToolReconciliationCliError(
      maximum === Number.MAX_SAFE_INTEGER
        ? `${option} 必须是正整数`
        : `${option} 必须在 1 到 ${maximum} 之间`,
    );
  }
  return parsed;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runToolReconciliationCli(process.argv.slice(2))
    .then((result) =>
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    )
    .catch((error: unknown) => {
      process.stderr.write(`${formatToolReconciliationError(error)}\n`);
      process.exitCode = 1;
    });
}
