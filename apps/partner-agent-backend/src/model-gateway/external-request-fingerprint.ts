import { createHash } from 'node:crypto';

export const DEFAULT_FINGERPRINT_MAX_BYTES = 10 * 1024 * 1024;

export function fingerprintExternalPayload(
  value: unknown,
  maxBytes = DEFAULT_FINGERPRINT_MAX_BYTES,
): string {
  return createHash('sha256')
    .update(stableSerialize(value, maxBytes))
    .digest('hex');
}

function stableSerialize(value: unknown, maxBytes: number): string {
  let bytes = 0;
  const ancestors = new Set<object>();
  const add = (part: string): string => {
    bytes += Buffer.byteLength(part);
    if (bytes > maxBytes) throw new Error('fingerprint payload too large');
    return part;
  };
  const encode = (item: unknown, depth: number): string => {
    if (depth > 20) throw new Error('fingerprint depth exceeded');
    if (item === null) return add('null');
    if (typeof item === 'string') return add(JSON.stringify(item));
    if (typeof item === 'boolean') return add(item ? 'true' : 'false');
    if (typeof item === 'number') {
      if (
        !Number.isFinite(item) ||
        (Number.isInteger(item) && !Number.isSafeInteger(item))
      )
        throw new Error('unsupported fingerprint number');
      return add(Object.is(item, -0) ? '0' : String(item));
    }
    if (typeof item === 'undefined') return add('null');
    if (typeof item !== 'object')
      throw new Error('unsupported fingerprint value');
    if (item instanceof Date) {
      if (Number.isNaN(item.getTime()))
        throw new Error('unsupported fingerprint date');
      return add(JSON.stringify(item.toISOString()));
    }
    if (!Array.isArray(item) && !isPlainObject(item))
      throw new Error('unsupported fingerprint object');
    if (ancestors.has(item)) throw new Error('circular fingerprint value');
    assertDataProperties(item);
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        const parts = Array.from(item, (entry) => encode(entry, depth + 1));
        if (parts.length > 1) add(','.repeat(parts.length - 1));
        return add('[') + parts.join(',') + add(']');
      }
      const object = item as Record<string, unknown>;
      const keys = Object.keys(object)
        .filter((key) => object[key] !== undefined)
        .sort();
      const parts = keys.map(
        (key) =>
          add(JSON.stringify(key)) +
          add(':') +
          encode(object[key], depth + 1),
      );
      if (parts.length > 1) add(','.repeat(parts.length - 1));
      return add('{') + parts.join(',') + add('}');
    } finally {
      ancestors.delete(item);
    }
  };
  return encode(value, 0);
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertDataProperties(value: object): void {
  if (
    Object.getOwnPropertySymbols(value).some((symbol) =>
      Object.prototype.propertyIsEnumerable.call(value, symbol),
    )
  ) {
    throw new Error('unsupported fingerprint symbol');
  }
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (descriptor.enumerable && !('value' in descriptor))
      throw new Error('unsafe fingerprint property');
  }
}
