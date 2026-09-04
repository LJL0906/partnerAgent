import { describe, expect, it } from 'vitest';
import { fingerprintExternalPayload } from './external-request-fingerprint.js';

describe('fingerprintExternalPayload', () => {
  it('is stable across object key order and supports controlled dates', () => {
    const first = fingerprintExternalPayload({
      when: new Date('2026-09-04T12:00:00.000Z'),
      nested: { b: 2, a: 1 },
    });
    const second = fingerprintExternalPayload({
      nested: { a: 1, b: 2 },
      when: new Date('2026-09-04T12:00:00.000Z'),
    });
    expect(first).toBe(second);
  });

  it('supports null-prototype records without invoking accessors', () => {
    const record = Object.create(null) as Record<string, unknown>;
    record.message = 'safe';
    expect(() => fingerprintExternalPayload(record)).not.toThrow();

    const unsafe = {};
    Object.defineProperty(unsafe, 'secret', {
      enumerable: true,
      get: () => 'must-not-run',
    });
    expect(() => fingerprintExternalPayload(unsafe)).toThrow(
      'unsafe fingerprint property',
    );
  });
});
