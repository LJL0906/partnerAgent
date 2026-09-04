import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCommandEnvelope } from './command-envelope';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async () => 'payload-fingerprint'),
  randomUUID: vi.fn(() => 'generated-operation'),
}));

describe('command envelope', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates the shared idempotent envelope shape', async () => {
    vi.stubEnv('EXPO_OS', 'web');

    await expect(
      createCommandEnvelope(
        { egress_id: 'egress-1', decision: 'redact' },
        { operationId: 'operation-1', expectedVersion: 'version-2' },
      ),
    ).resolves.toEqual({
      operation_id: 'operation-1',
      client_source: 'web',
      request_fingerprint: 'payload-fingerprint',
      expected_version: 'version-2',
      payload: { egress_id: 'egress-1', decision: 'redact' },
    });
  });

  it('generates an operation id and uses a safe source fallback', async () => {
    vi.stubEnv('EXPO_OS', 'windows');

    await expect(createCommandEnvelope({ task_id: 'task-1' })).resolves.toMatchObject({
      operation_id: 'generated-operation',
      client_source: 'other',
    });
  });
});
