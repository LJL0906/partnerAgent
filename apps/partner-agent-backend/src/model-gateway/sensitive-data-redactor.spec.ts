import { describe, expect, it } from 'vitest';
import { SensitiveDataRedactor } from './sensitive-data-redactor.js';
import { SensitiveDataScanner } from './sensitive-data-scanner.js';

function redact(value: unknown): unknown {
  const result = new SensitiveDataRedactor().redact(value);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe('SensitiveDataRedactor', () => {
  it('creates a copy without modifying the original object', () => {
    const original = {
      profile: { password: 'hunter2' },
      messages: ['Bearer abcdefghijklmnop'],
    };
    const snapshot = structuredClone(original);
    const output = redact(original);
    expect(original).toEqual(snapshot);
    expect(output).not.toBe(original);
    expect((output as typeof original).profile).not.toBe(original.profile);
  });

  it('redacts sensitive fields and values through nested arrays', () => {
    const originalSecrets = [
      'hunter2',
      'sk-abcdefghijklmnop',
      '4111111111111111',
      '11010119900101123X',
    ];
    const output = redact({
      profile: { password: originalSecrets[0] },
      values: [
        { api_key: originalSecrets[1] },
        `银行卡号为 ${originalSecrets[2]}`,
        `身份证 ${originalSecrets[3]}`,
      ],
    });
    const serialized = JSON.stringify(output);
    for (const secret of originalSecrets)
      expect(serialized).not.toContain(secret);
    expect(serialized).toContain('[REDACTED:PASSWORD]');
    expect(serialized).toContain('[REDACTED:API_KEY]');
    expect(serialized).toContain('[REDACTED:BANK_CARD]');
    expect(serialized).toContain('[REDACTED:IDENTITY_DOCUMENT]');
  });

  it('redacts natural-language password, key, token and Bearer fragments', () => {
    const output = String(
      redact(
        '我的密码是 hunter2；API 密钥：abcdefgh1234；token=tokensecret；Bearer abcdefghijklmnop',
      ),
    );
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('abcdefgh1234');
    expect(output).not.toContain('tokensecret');
    expect(output).not.toContain('abcdefghijklmnop');
  });

  it('produces standard placeholders that pass a complete rescan', () => {
    const output = redact({
      password: 'hunter2',
      authorization: 'Bearer abcdefghijklmnop',
      body: '银行卡号为 4111111111111111',
    });
    expect(new SensitiveDataScanner().scan(output)).toEqual({
      ok: true,
      findings: [],
      categories: [],
    });
  });

  it('does not let a non-standard placeholder bypass a sensitive field', () => {
    const result = new SensitiveDataScanner().scan({ password: '[REDACTED]' });
    expect(result.ok && result.categories).toEqual(['password']);
  });

  it('fails closed for cycles and unsupported values', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(new SensitiveDataRedactor().redact(cyclic)).toEqual({
      ok: false,
      reason: 'CIRCULAR_REFERENCE',
    });
    expect(new SensitiveDataRedactor().redact(() => undefined)).toEqual({
      ok: false,
      reason: 'UNSUPPORTED_TYPE',
    });
  });
});
