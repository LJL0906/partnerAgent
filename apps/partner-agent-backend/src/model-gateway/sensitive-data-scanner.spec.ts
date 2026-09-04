import { describe, expect, it } from 'vitest';
import { SensitiveDataScanner, passesLuhn } from './sensitive-data-scanner.js';

function successfulFindings(value: unknown) {
  const result = new SensitiveDataScanner().scan(value);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe('SensitiveDataScanner', () => {
  it.each([
    ['top-level password', '我的密码是 hunter2', 'password'],
    [
      'JWT',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123',
      'secret',
    ],
    ['Bearer', 'Bearer abcdefghijklmnop', 'secret'],
    ['sk key', 'sk-abcdefghijklmnop', 'api_key'],
    ['Chinese API key', '我的 API 密钥：abcdefgh1234', 'api_key'],
    ['identity document', '11010119900101123X', 'identity_document'],
    ['Luhn bank card', '4111 1111 1111 1111', 'bank_card'],
  ])('detects %s without retaining matched text', (_name, value, category) => {
    const result = successfulFindings(value);
    expect(result.categories).toContain(category);
    expect(JSON.stringify(result.findings)).not.toContain('hunter2');
    expect(JSON.stringify(result.findings)).not.toContain('abcdefgh1234');
    expect(Object.keys(result.findings[0] ?? {})).toEqual([
      'category',
      'path',
      'detector',
    ]);
  });

  it('recursively scans nested objects and multi-level arrays', () => {
    const result = successfulFindings({
      safe: [{ deeper: [{ message: 'password=nest-secret' }] }],
    });
    expect(result.categories).toEqual(['password']);
    expect(result.findings[0]?.path).toBe('$.safe[0].deeper[0].message');
  });

  it.each([
    ['password', 'random-value', 'password'],
    ['ACCESS-token', 'random-value', 'secret'],
    ['api key', 'random-value', 'api_key'],
    ['ｃｌｉｅｎｔ＿ｓｅｃｒｅｔ', 'random-value', 'secret'],
    ['密码', '随机值', 'password'],
  ])('detects sensitive field variant %s', (field, value, category) => {
    expect(successfulFindings({ [field]: value }).categories).toContain(
      category,
    );
  });

  it('normalizes full-width text before value detection', () => {
    expect(
      successfulFindings('ｐａｓｓｗｏｒｄ＝ｈｕｎｔｅｒ２').categories,
    ).toEqual(['password']);
  });

  it('uses Luhn to reject ordinary long numbers', () => {
    expect(passesLuhn('4111111111111111')).toBe(true);
    expect(passesLuhn('1234567890123456')).toBe(false);
    expect(successfulFindings('编号 1234567890123456').categories).toEqual([]);
  });

  it('returns identical results across consecutive scans', () => {
    const scanner = new SensitiveDataScanner();
    const value = { token: 'abc', body: 'sk-abcdefghijklmnop' };
    expect(scanner.scan(value)).toEqual(scanner.scan(value));
    expect(scanner.scan(value)).toEqual(scanner.scan(value));
  });

  it.each([
    [
      'cycle',
      () => {
        const value: Record<string, unknown> = {};
        value.self = value;
        return new SensitiveDataScanner().scan(value);
      },
      'CIRCULAR_REFERENCE',
    ],
    [
      'depth',
      () => new SensitiveDataScanner({ maxDepth: 1 }).scan({ a: { b: true } }),
      'MAX_DEPTH_EXCEEDED',
    ],
    [
      'nodes',
      () => new SensitiveDataScanner({ maxNodes: 2 }).scan([true, false]),
      'MAX_NODES_EXCEEDED',
    ],
    [
      'single string',
      () => new SensitiveDataScanner({ maxStringLength: 3 }).scan('four'),
      'MAX_STRING_LENGTH_EXCEEDED',
    ],
    [
      'total strings',
      () =>
        new SensitiveDataScanner({ maxTotalStringLength: 5 }).scan([
          'abc',
          'def',
        ]),
      'MAX_TOTAL_STRING_LENGTH_EXCEEDED',
    ],
    [
      'unsupported type',
      () => new SensitiveDataScanner().scan(new Map([['password', 'value']])),
      'UNSUPPORTED_TYPE',
    ],
  ])('fails closed on %s', (_name, scan, reason) => {
    expect(scan()).toEqual({ ok: false, reason });
  });

  it('accepts null, a valid Date, and ordinary chat without false positives', () => {
    expect(successfulFindings(null).categories).toEqual([]);
    expect(
      successfulFindings(new Date('2026-09-04T00:00:00Z')).categories,
    ).toEqual([]);
    expect(
      successfulFindings({ message: '今天散步很开心，晚上想早点休息。' })
        .categories,
    ).toEqual([]);
  });
});
