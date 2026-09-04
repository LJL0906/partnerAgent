import { isIP } from 'node:net';
import {
  AGENT_RUNTIME_CONFIG_KEYS,
  DEFAULT_AGENT_RUNTIME_POLICY,
  MAX_AGENT_RUNTIME_POLICY,
} from '../agent/agent-runtime-policy.js';

type RuntimeEnvironment = Record<string, unknown>;

const DEFAULT_CORS_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];
const MODEL_PROVIDERS = ['deepseek', 'openai', 'anthropic'] as const;
const SENSITIVE_CATEGORIES = new Set([
  'identity_document',
  'bank_card',
  'password',
  'api_key',
  'secret',
]);
const MAX_TIMER_MS = 2_147_483_647;

/** ConfigModule `validate` contract. It never reads process.env or logs values. */
export function validateRuntimeConfig(
  environment: RuntimeEnvironment,
): RuntimeEnvironment {
  const output = { ...environment };
  const invalid = new Set<string>();
  const integer = (
    key: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ) => {
    const value = parseInteger(
      environment[key],
      key,
      fallback,
      minimum,
      maximum,
      invalid,
    );
    output[key] = String(value);
    return value;
  };

  const nodeEnv = enumValue(
    environment.NODE_ENV,
    'NODE_ENV',
    ['development', 'test', 'production'] as const,
    'development',
    invalid,
  );
  output.NODE_ENV = nodeEnv;
  const production = nodeEnv === 'production';

  output.HOST = hostValue(environment.HOST, invalid);
  integer('PORT', 3_000, 1, 65_535);

  validateJwtSecret(environment.AUTH_JWT_SECRET, invalid);
  output.AUTH_JWT_SECRET = environment.AUTH_JWT_SECRET;
  output.CORS_ALLOWED_ORIGINS = corsValue(
    environment.CORS_ALLOWED_ORIGINS,
    production,
    invalid,
  );
  output.ENABLE_LEGACY_AGENT_WS = booleanValue(
    environment.ENABLE_LEGACY_AGENT_WS,
    'ENABLE_LEGACY_AGENT_WS',
    false,
    invalid,
  );
  integer('MAX_SESSIONS_PER_USER', 100, 1, 100_000);

  const sessionStore = enumValue(
    environment.SESSION_STORE,
    'SESSION_STORE',
    ['memory', 'postgres'] as const,
    'postgres',
    invalid,
  );
  output.SESSION_STORE = sessionStore;
  if (production && sessionStore !== 'postgres') invalid.add('SESSION_STORE');
  validateDatabaseUrl(environment.DATABASE_URL, sessionStore, invalid);
  integer('DATABASE_POOL_SIZE', 10, 1, 100);

  const chatTaskLeaseMs = integer(
    'CHAT_TASK_LEASE_MS',
    30_000,
    100,
    MAX_TIMER_MS,
  );
  const chatTaskPollMs = integer('CHAT_TASK_POLL_MS', 1_000, 10, MAX_TIMER_MS);
  integer('CHAT_TASK_WORKER_CONCURRENCY', 4, 1, 100);
  if (chatTaskPollMs > chatTaskLeaseMs) {
    invalid.add('CHAT_TASK_POLL_MS');
    invalid.add('CHAT_TASK_LEASE_MS');
  }

  const privacyTtlMs = integer(
    'PRIVACY_DECISION_TTL_MS',
    900_000,
    1,
    MAX_TIMER_MS,
  );
  const privacyScanMs = integer(
    'PRIVACY_DECISION_SCAN_INTERVAL_MS',
    5_000,
    1,
    MAX_TIMER_MS,
  );
  if (privacyScanMs > privacyTtlMs) {
    invalid.add('PRIVACY_DECISION_SCAN_INTERVAL_MS');
    invalid.add('PRIVACY_DECISION_TTL_MS');
  }
  integer('EGRESS_FINGERPRINT_MAX_BYTES', 1_048_576, 1, 67_108_864);
  output.EGRESS_SENSITIVE_ACTION = enumValue(
    environment.EGRESS_SENSITIVE_ACTION,
    'EGRESS_SENSITIVE_ACTION',
    ['allow', 'ask', 'block', 'redact'] as const,
    'redact',
    invalid,
  );
  output.EGRESS_FORBIDDEN_CATEGORIES = categoryList(
    environment.EGRESS_FORBIDDEN_CATEGORIES,
    invalid,
  );

  const legacyToolTtl = validateLegacyToolTtl(environment, output, invalid);
  integer(
    'EXTERNAL_TOOL_APPROVAL_TTL_MS',
    legacyToolTtl.approval ?? 600_000,
    1,
    MAX_TIMER_MS,
  );
  integer(
    'EXTERNAL_TOOL_UNDO_TTL_MS',
    legacyToolTtl.undo ?? 600_000,
    1,
    MAX_TIMER_MS,
  );

  integer('MODEL_GATEWAY_TIMEOUT_MS', 60_000, 1, 600_000);
  integer('MODEL_GATEWAY_MAX_RETRIES', 1, 0, 3);
  integer('MODEL_GATEWAY_MAX_RETRY_DELAY_MS', 2_000, 1, 60_000);

  integer(
    AGENT_RUNTIME_CONFIG_KEYS.runTimeoutMs,
    DEFAULT_AGENT_RUNTIME_POLICY.runTimeoutMs,
    1,
    MAX_AGENT_RUNTIME_POLICY.runTimeoutMs,
  );
  integer(
    AGENT_RUNTIME_CONFIG_KEYS.maxModelTurns,
    DEFAULT_AGENT_RUNTIME_POLICY.maxModelTurns,
    1,
    MAX_AGENT_RUNTIME_POLICY.maxModelTurns,
  );
  integer(
    AGENT_RUNTIME_CONFIG_KEYS.maxToolCalls,
    DEFAULT_AGENT_RUNTIME_POLICY.maxToolCalls,
    1,
    MAX_AGENT_RUNTIME_POLICY.maxToolCalls,
  );
  const totalOutputTokens = integer(
    AGENT_RUNTIME_CONFIG_KEYS.totalOutputTokens,
    DEFAULT_AGENT_RUNTIME_POLICY.totalOutputTokens,
    1,
    MAX_AGENT_RUNTIME_POLICY.totalOutputTokens,
  );
  const requestMaxTokens = integer(
    AGENT_RUNTIME_CONFIG_KEYS.requestMaxTokens,
    DEFAULT_AGENT_RUNTIME_POLICY.requestMaxTokens,
    1,
    MAX_AGENT_RUNTIME_POLICY.requestMaxTokens,
  );
  if (requestMaxTokens > totalOutputTokens) {
    invalid.add(AGENT_RUNTIME_CONFIG_KEYS.requestMaxTokens);
    invalid.add(AGENT_RUNTIME_CONFIG_KEYS.totalOutputTokens);
  }

  const provider = enumValue(
    environment.DEFAULT_PROVIDER,
    'DEFAULT_PROVIDER',
    MODEL_PROVIDERS,
    'deepseek',
    invalid,
  );
  output.DEFAULT_PROVIDER = provider;
  output.DEFAULT_MODEL = optionalPlainString(
    environment.DEFAULT_MODEL,
    'DEFAULT_MODEL',
    invalid,
  );
  for (const key of [
    'DEEPSEEK_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
  ]) {
    validateOptionalSecret(environment[key], key, invalid);
  }
  if (production) {
    const providerKey = `${provider.toUpperCase()}_API_KEY`;
    if (!nonEmptyString(environment[providerKey])) invalid.add(providerKey);
  }

  if (invalid.size > 0) throw new Error([...invalid].sort().join(','));
  return output;
}

function parseInteger(
  raw: unknown,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
  invalid: Set<string>,
): number {
  if (raw === undefined) return fallback;
  const strict =
    typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : '';
  if (!/^(?:0|[1-9]\d*)$/u.test(strict)) {
    invalid.add(key);
    return fallback;
  }
  const value = Number(strict);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    invalid.add(key);
    return fallback;
  }
  return value;
}

function enumValue<const T extends readonly string[]>(
  raw: unknown,
  key: string,
  values: T,
  fallback: T[number],
  invalid: Set<string>,
): T[number] {
  if (raw === undefined) return fallback;
  if (typeof raw === 'string' && values.includes(raw)) return raw as T[number];
  invalid.add(key);
  return fallback;
}

function hostValue(raw: unknown, invalid: Set<string>): string {
  if (raw === undefined) return '127.0.0.1';
  if (typeof raw !== 'string' || raw !== raw.trim() || !validHost(raw)) {
    invalid.add('HOST');
    return '127.0.0.1';
  }
  return raw;
}

function validHost(host: string): boolean {
  if (isIP(host)) return true;
  if (host.length === 0 || host.length > 253) return false;
  return host
    .split('.')
    .every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label),
    );
}

function validateJwtSecret(raw: unknown, invalid: Set<string>): void {
  if (
    typeof raw !== 'string' ||
    raw !== raw.trim() ||
    Buffer.byteLength(raw, 'utf8') < 32
  ) {
    invalid.add('AUTH_JWT_SECRET');
  }
}

function corsValue(
  raw: unknown,
  production: boolean,
  invalid: Set<string>,
): string {
  if (raw === undefined) {
    if (production) invalid.add('CORS_ALLOWED_ORIGINS');
    return DEFAULT_CORS_ORIGINS.join(',');
  }
  if (typeof raw !== 'string') {
    invalid.add('CORS_ALLOWED_ORIGINS');
    return DEFAULT_CORS_ORIGINS.join(',');
  }
  const origins = raw.split(',').map((origin) => origin.trim());
  if (
    origins.length === 0 ||
    origins.some((origin) => !validOrigin(origin, production)) ||
    new Set(origins).size !== origins.length
  ) {
    invalid.add('CORS_ALLOWED_ORIGINS');
  }
  return origins.filter(Boolean).join(',');
}

function validOrigin(origin: string, production: boolean): boolean {
  if (!origin || origin === '*') return false;
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.origin !== origin || parsed.username || parsed.password)
      return false;
    return !production || !localHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function localHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized === '[::1]'
  );
}

function booleanValue(
  raw: unknown,
  key: string,
  fallback: boolean,
  invalid: Set<string>,
): string {
  if (raw === undefined) return String(fallback);
  if (raw === 'true' || raw === 'false') return raw;
  invalid.add(key);
  return String(fallback);
}

function validateDatabaseUrl(
  raw: unknown,
  sessionStore: 'memory' | 'postgres',
  invalid: Set<string>,
): void {
  if (raw === undefined || raw === '') {
    if (sessionStore === 'postgres') invalid.add('DATABASE_URL');
    return;
  }
  if (typeof raw !== 'string' || raw !== raw.trim() || !nonEmptyString(raw)) {
    invalid.add('DATABASE_URL');
    return;
  }
  try {
    const parsed = new URL(raw);
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.pathname === '/'
    ) {
      invalid.add('DATABASE_URL');
    }
  } catch {
    invalid.add('DATABASE_URL');
  }
}

function categoryList(raw: unknown, invalid: Set<string>): string {
  if (raw === undefined || raw === '') return '';
  if (typeof raw !== 'string') {
    invalid.add('EGRESS_FORBIDDEN_CATEGORIES');
    return '';
  }
  const categories = raw.split(',').map((category) => category.trim());
  if (
    categories.some((category) => !SENSITIVE_CATEGORIES.has(category)) ||
    new Set(categories).size !== categories.length
  ) {
    invalid.add('EGRESS_FORBIDDEN_CATEGORIES');
  }
  return categories.filter(Boolean).join(',');
}

function validateLegacyToolTtl(
  environment: RuntimeEnvironment,
  output: RuntimeEnvironment,
  invalid: Set<string>,
): { approval?: number; undo?: number } {
  const result: { approval?: number; undo?: number } = {};
  const mappings = [
    ['TOOL_CONFIRMATION_TTL_MS', 'approval'],
    ['TOOL_UNDO_TTL_MS', 'undo'],
  ] as const;
  for (const [key, field] of mappings) {
    if (environment[key] === undefined) continue;
    const value = parseInteger(
      environment[key],
      key,
      600_000,
      1,
      MAX_TIMER_MS,
      invalid,
    );
    output[key] = String(value);
    result[field] = value;
  }
  return result;
}

function optionalPlainString(
  raw: unknown,
  key: string,
  invalid: Set<string>,
): string {
  if (raw === undefined) return '';
  if (typeof raw !== 'string' || /[\r\n]/u.test(raw)) {
    invalid.add(key);
    return '';
  }
  return raw.trim();
}

function validateOptionalSecret(
  raw: unknown,
  key: string,
  invalid: Set<string>,
): void {
  if (raw === undefined || raw === '') return;
  if (typeof raw !== 'string' || raw !== raw.trim()) invalid.add(key);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
