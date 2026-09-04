import { describe, expect, it } from 'vitest';
import { validateRuntimeConfig } from './runtime-config.js';

const secret = 'test-secret-that-is-at-least-32-bytes';

describe('validateRuntimeConfig', () => {
  it('keeps development memory mode usable and supplies canonical defaults', () => {
    const input = {
      AUTH_JWT_SECRET: secret,
      SESSION_STORE: 'memory',
    };

    const result = validateRuntimeConfig(input);

    expect(result).toMatchObject({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: '3000',
      SESSION_STORE: 'memory',
      DATABASE_POOL_SIZE: '10',
      WS_EVENT_RETENTION_COUNT: '100',
      WS_EVENT_RETENTION_AGE_MS: '86400000',
      WS_EVENT_RETENTION_BATCH_SIZE: '500',
      WS_EVENT_RETENTION_INTERVAL_MS: '60000',
      CHAT_TASK_LEASE_MS: '30000',
      CHAT_TASK_POLL_MS: '1000',
      DEFAULT_PROVIDER: 'deepseek',
      AGENT_RUN_MAX_REQUEST_TOKENS: '4096',
    });
    expect(result.DATABASE_URL).toBeUndefined();
    expect(input).toEqual({
      AUTH_JWT_SECRET: secret,
      SESSION_STORE: 'memory',
    });
  });

  it.each([
    ['deepseek', 'DEEPSEEK_API_KEY'],
    ['openai', 'OPENAI_API_KEY'],
    ['anthropic', 'ANTHROPIC_API_KEY'],
  ] as const)(
    'accepts production provider %s with its matching key',
    (provider, providerKey) => {
      expect(() =>
        validateRuntimeConfig({
          NODE_ENV: 'production',
          HOST: '0.0.0.0',
          PORT: '3000',
          AUTH_JWT_SECRET: secret,
          SESSION_STORE: 'postgres',
          DATABASE_URL: 'postgresql://app:secret@db.internal:5432/app',
          CORS_ALLOWED_ORIGINS: 'https://app.example.com',
          DEFAULT_PROVIDER: provider,
          [providerKey]: 'provider-secret',
        }),
      ).not.toThrow();
    },
  );

  it.each([
    [{ PORT: '3000.5' }, 'PORT'],
    [{ DATABASE_POOL_SIZE: '0' }, 'DATABASE_POOL_SIZE'],
    [{ CHAT_TASK_WORKER_CONCURRENCY: '101' }, 'CHAT_TASK_WORKER_CONCURRENCY'],
    [{ MODEL_GATEWAY_MAX_RETRIES: '4' }, 'MODEL_GATEWAY_MAX_RETRIES'],
    [{ AGENT_RUN_MAX_MODEL_TURNS: '65' }, 'AGENT_RUN_MAX_MODEL_TURNS'],
    [{ EXTERNAL_TOOL_APPROVAL_TTL_MS: '-1' }, 'EXTERNAL_TOOL_APPROVAL_TTL_MS'],
    [{ PRIVACY_DECISION_TTL_MS: 'not-a-number' }, 'PRIVACY_DECISION_TTL_MS'],
    [{ WS_EVENT_RETENTION_COUNT: '9' }, 'WS_EVENT_RETENTION_COUNT'],
    [{ WS_EVENT_RETENTION_AGE_MS: '2592000001' }, 'WS_EVENT_RETENTION_AGE_MS'],
    [{ WS_EVENT_RETENTION_BATCH_SIZE: '5001' }, 'WS_EVENT_RETENTION_BATCH_SIZE'],
  ])('rejects invalid numeric config %j', (override, key) => {
    expect(() =>
      validateRuntimeConfig({
        AUTH_JWT_SECRET: secret,
        SESSION_STORE: 'memory',
        ...override,
      }),
    ).toThrow(key);
  });

  it('rejects cross-field timing and token budget inversions', () => {
    expect(() =>
      validateRuntimeConfig({
        AUTH_JWT_SECRET: secret,
        SESSION_STORE: 'memory',
        CHAT_TASK_LEASE_MS: '1000',
        CHAT_TASK_POLL_MS: '1001',
        PRIVACY_DECISION_TTL_MS: '1000',
        PRIVACY_DECISION_SCAN_INTERVAL_MS: '1001',
        AGENT_RUN_MAX_OUTPUT_TOKENS: '100',
        AGENT_RUN_MAX_REQUEST_TOKENS: '101',
        WS_EVENT_RETENTION_AGE_MS: '60000',
        WS_EVENT_RETENTION_INTERVAL_MS: '60001',
      }),
    ).toThrow(
      'AGENT_RUN_MAX_OUTPUT_TOKENS,AGENT_RUN_MAX_REQUEST_TOKENS,CHAT_TASK_LEASE_MS,CHAT_TASK_POLL_MS,PRIVACY_DECISION_SCAN_INTERVAL_MS,PRIVACY_DECISION_TTL_MS,WS_EVENT_RETENTION_AGE_MS,WS_EVENT_RETENTION_INTERVAL_MS',
    );
  });

  it('rejects the legacy Agent WS in production', () => {
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: 'production',
        AUTH_JWT_SECRET: secret,
        SESSION_STORE: 'postgres',
        DATABASE_URL: 'postgresql://app:secret@db.internal:5432/app',
        CORS_ALLOWED_ORIGINS: 'https://app.example.com',
        DEFAULT_PROVIDER: 'deepseek',
        DEEPSEEK_API_KEY: 'provider-secret',
        ENABLE_LEGACY_AGENT_WS: 'true',
      }),
    ).toThrow('ENABLE_LEGACY_AGENT_WS');
  });

  it.each([
    [{ SESSION_STORE: 'memory' }, 'SESSION_STORE'],
    [{ DATABASE_URL: undefined }, 'DATABASE_URL'],
    [{ CORS_ALLOWED_ORIGINS: undefined }, 'CORS_ALLOWED_ORIGINS'],
    [{ CORS_ALLOWED_ORIGINS: 'http://localhost:3000' }, 'CORS_ALLOWED_ORIGINS'],
    [{ DEEPSEEK_API_KEY: undefined }, 'DEEPSEEK_API_KEY'],
  ])('enforces production safety for %s', (override, key) => {
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: 'production',
        AUTH_JWT_SECRET: secret,
        SESSION_STORE: 'postgres',
        DATABASE_URL: 'postgresql://app:secret@db.internal:5432/app',
        CORS_ALLOWED_ORIGINS: 'https://app.example.com',
        DEFAULT_PROVIDER: 'deepseek',
        DEEPSEEK_API_KEY: 'provider-secret',
        ...override,
      }),
    ).toThrow(key);
  });

  it('rejects wildcard, non-origin and duplicate CORS entries', () => {
    for (const origins of [
      '*',
      'https://app.example.com/path',
      'https://app.example.com,https://app.example.com',
    ]) {
      expect(() =>
        validateRuntimeConfig({
          AUTH_JWT_SECRET: secret,
          SESSION_STORE: 'memory',
          CORS_ALLOWED_ORIGINS: origins,
        }),
      ).toThrow('CORS_ALLOWED_ORIGINS');
    }
  });

  it('never includes rejected secret values in errors', () => {
    const rejected = 'sensitive-but-invalid';
    let error: unknown;
    try {
      validateRuntimeConfig({
        AUTH_JWT_SECRET: rejected,
        SESSION_STORE: 'memory',
        DEEPSEEK_API_KEY: ` ${rejected}`,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('AUTH_JWT_SECRET,DEEPSEEK_API_KEY');
    expect((error as Error).message).not.toContain(rejected);
  });

  it('rejects malformed database, host, egress and boolean settings', () => {
    expect(() =>
      validateRuntimeConfig({
        AUTH_JWT_SECRET: secret,
        SESSION_STORE: 'postgres',
        DATABASE_URL: 'https://db.example.com/app',
        HOST: 'https://localhost',
        EGRESS_SENSITIVE_ACTION: 'permit',
        EGRESS_FORBIDDEN_CATEGORIES: 'password,unknown',
        ENABLE_LEGACY_AGENT_WS: 'yes',
      }),
    ).toThrow(
      'DATABASE_URL,EGRESS_FORBIDDEN_CATEGORIES,EGRESS_SENSITIVE_ACTION,ENABLE_LEGACY_AGENT_WS,HOST',
    );
  });

  it('keeps legacy tool TTL aliases effective when primary keys are absent', () => {
    expect(
      validateRuntimeConfig({
        AUTH_JWT_SECRET: secret,
        SESSION_STORE: 'memory',
        TOOL_CONFIRMATION_TTL_MS: '1234',
        TOOL_UNDO_TTL_MS: '5678',
      }),
    ).toMatchObject({
      EXTERNAL_TOOL_APPROVAL_TTL_MS: '1234',
      EXTERNAL_TOOL_UNDO_TTL_MS: '5678',
    });
  });

  it('strictly rejects a provided non-string database URL in memory mode', () => {
    expect(() =>
      validateRuntimeConfig({
        AUTH_JWT_SECRET: secret,
        SESSION_STORE: 'memory',
        DATABASE_URL: 123,
      }),
    ).toThrow('DATABASE_URL');
  });
});
