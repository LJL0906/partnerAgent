import 'dotenv/config';
import { createDatabaseDataSource } from '../database/database-definition.js';
import {
  OUTBOX_KINDS,
  OUTBOX_REMEDIATION_ACTIONS,
  OutboxRemediationError,
  OutboxRemediationService,
  buildOutboxRemediationPhrase,
  type OutboxKind,
  type OutboxRemediationAction,
} from './outbox-remediation.service.js';

type Options =
  | { command: 'list'; limit: number }
  | {
      command: 'remediate';
      kind: OutboxKind;
      eventId: string;
      action: OutboxRemediationAction;
      expectedAttempts: number;
      operatorLabel: string;
      confirmationPhrase: string;
    };

export function parseOutboxRemediationArgs(args: readonly string[]): Options {
  const command = args[0];
  if (command !== 'list' && command !== 'remediate') {
    throw new OutboxRemediationError('首个参数必须是 list 或 remediate');
  }
  const values = parseOptions(args.slice(1));
  if (command === 'list') {
    rejectUnexpected(values, ['--limit']);
    return { command, limit: positiveInteger(values.get('--limit') ?? '50') };
  }
  rejectUnexpected(values, [
    '--kind',
    '--event-id',
    '--action',
    '--expected-attempts',
    '--operator-label',
    '--confirm',
  ]);
  const kind = required(values, '--kind');
  const action = required(values, '--action');
  if (!(OUTBOX_KINDS as readonly string[]).includes(kind)) {
    throw new OutboxRemediationError('--kind 无效');
  }
  if (!(OUTBOX_REMEDIATION_ACTIONS as readonly string[]).includes(action)) {
    throw new OutboxRemediationError('--action 无效');
  }
  return {
    command,
    kind: kind as OutboxKind,
    eventId: required(values, '--event-id'),
    action: action as OutboxRemediationAction,
    expectedAttempts: positiveInteger(required(values, '--expected-attempts')),
    operatorLabel: required(values, '--operator-label'),
    confirmationPhrase: required(values, '--confirm'),
  };
}

export async function executeOutboxRemediation(
  options: Options,
  service: OutboxRemediationService,
): Promise<unknown> {
  if (options.command === 'list') {
    return (await service.list(options.limit)).map((event) => ({
      ...event,
      confirmationPhrases: Object.fromEntries(
        OUTBOX_REMEDIATION_ACTIONS.map((action) => [
          action,
          buildOutboxRemediationPhrase({
            kind: event.kind,
            eventId: event.eventId,
            action,
            expectedAttempts: event.attemptCount,
          }),
        ]),
      ),
    }));
  }
  const { command: _command, ...input } = options;
  return { ...(await service.remediate(input)), action: input.action };
}

export async function runOutboxRemediation(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<unknown> {
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new OutboxRemediationError('DATABASE_URL 未配置');
  const dataSource = createDatabaseDataSource(databaseUrl);
  try {
    await dataSource.initialize();
    return await executeOutboxRemediation(
      parseOutboxRemediationArgs(args),
      new OutboxRemediationService(dataSource),
    );
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

function parseOptions(args: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!option?.startsWith('--') || !value || value.startsWith('--')) {
      throw new OutboxRemediationError(`${option ?? '参数'} 缺少值`);
    }
    if (values.has(option)) throw new OutboxRemediationError(`${option} 重复`);
    values.set(option, value.trim());
  }
  return values;
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new OutboxRemediationError(`必须提供 ${key}`);
  return value;
}

function rejectUnexpected(
  values: Map<string, string>,
  allowed: string[],
): void {
  const unexpected = [...values.keys()].find((key) => !allowed.includes(key));
  if (unexpected) throw new OutboxRemediationError(`未知参数：${unexpected}`);
}

function positiveInteger(value: string): number {
  if (!/^\d+$/.test(value)) throw new OutboxRemediationError('必须是正整数');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1000) {
    throw new OutboxRemediationError('整数范围必须为 1 到 1000');
  }
  return parsed;
}
