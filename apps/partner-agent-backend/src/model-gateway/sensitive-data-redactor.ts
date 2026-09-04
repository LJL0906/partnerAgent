import type { SensitiveCategory } from '@partner-agent/contracts';
import {
  DEFAULT_SENSITIVE_DATA_LIMITS,
  SENSITIVE_PLACEHOLDERS,
  TOKEN_PLACEHOLDER,
  type SensitiveDataFailureCode,
  type SensitiveDataLimits,
  type SensitiveRedactionResult,
} from './sensitive-data.types.js';
import {
  isSafeSensitivePlaceholder,
  passesLuhn,
  sensitiveFieldRule,
} from './sensitive-data-scanner.js';

class RedactionFailure extends Error {
  constructor(readonly code: SensitiveDataFailureCode) {
    super(code);
  }
}

export class SensitiveDataRedactor {
  private readonly limits: SensitiveDataLimits;

  constructor(limits: Partial<SensitiveDataLimits> = {}) {
    const resolved = { ...DEFAULT_SENSITIVE_DATA_LIMITS, ...limits };
    if (
      !Object.values(resolved).every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      )
    ) {
      throw new TypeError(
        'Sensitive data limits must be non-negative integers',
      );
    }
    this.limits = resolved;
  }

  redact(value: unknown): SensitiveRedactionResult {
    const ancestors = new Set<object>();
    let nodes = 0;
    let totalStringLength = 0;

    const countString = (text: string): void => {
      if (text.length > this.limits.maxStringLength) {
        throw new RedactionFailure('MAX_STRING_LENGTH_EXCEEDED');
      }
      totalStringLength += text.length;
      if (totalStringLength > this.limits.maxTotalStringLength) {
        throw new RedactionFailure('MAX_TOTAL_STRING_LENGTH_EXCEEDED');
      }
    };

    const clone = (item: unknown, depth: number): unknown => {
      if (depth > this.limits.maxDepth) {
        throw new RedactionFailure('MAX_DEPTH_EXCEEDED');
      }
      nodes += 1;
      if (nodes > this.limits.maxNodes) {
        throw new RedactionFailure('MAX_NODES_EXCEEDED');
      }
      if (item === null || item === undefined || typeof item === 'boolean')
        return item;
      if (typeof item === 'string') {
        countString(item);
        return redactText(item);
      }
      if (typeof item === 'number') {
        if (
          !Number.isFinite(item) ||
          (Number.isInteger(item) && !Number.isSafeInteger(item))
        ) {
          throw new RedactionFailure('UNSUPPORTED_TYPE');
        }
        return item;
      }
      if (typeof item !== 'object')
        throw new RedactionFailure('UNSUPPORTED_TYPE');
      if (item instanceof Date) {
        if (Number.isNaN(item.getTime()))
          throw new RedactionFailure('UNSUPPORTED_TYPE');
        return new Date(item.getTime());
      }
      if (!Array.isArray(item) && !isPlainObject(item)) {
        throw new RedactionFailure('UNSUPPORTED_TYPE');
      }
      if (ancestors.has(item)) throw new RedactionFailure('CIRCULAR_REFERENCE');
      assertSafeProperties(item);
      ancestors.add(item);
      try {
        if (Array.isArray(item)) {
          const result: unknown[] = [];
          result.length = item.length;
          for (let index = 0; index < item.length; index += 1) {
            if (Object.hasOwn(item, index))
              result[index] = clone(item[index], depth + 1);
          }
          return result;
        }
        const result: Record<string, unknown> = Object.create(
          Object.getPrototypeOf(item) === null ? null : Object.prototype,
        ) as Record<string, unknown>;
        for (const key of Object.keys(item)) {
          countString(key);
          const fieldRule = sensitiveFieldRule(key);
          const child = item[key];
          Object.defineProperty(result, key, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: fieldRule
              ? placeholderForField(
                  fieldRule.category,
                  fieldRule.detector,
                  child,
                )
              : clone(child, depth + 1),
          });
        }
        return result;
      } finally {
        ancestors.delete(item);
      }
    };

    try {
      return { ok: true, value: clone(value, 0) };
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof RedactionFailure ? error.code : 'REDACTOR_ERROR',
      };
    }
  }
}

function placeholderForField(
  category: SensitiveCategory,
  detector: string,
  value: unknown,
): string {
  if (typeof value === 'string' && isSafeSensitivePlaceholder(value))
    return value;
  if (detector === 'field_name_token') return TOKEN_PLACEHOLDER;
  return SENSITIVE_PLACEHOLDERS[category];
}

function redactText(original: string): string {
  if (isSafeSensitivePlaceholder(original)) return original;
  let text = original.normalize('NFKC');
  text = text.replace(
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu,
    `Bearer ${TOKEN_PLACEHOLDER}`,
  );
  text = text.replace(
    /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
    TOKEN_PLACEHOLDER,
  );
  text = text.replace(
    /\bsk-[A-Za-z0-9_-]{12,}\b/giu,
    SENSITIVE_PLACEHOLDERS.api_key,
  );
  text = redactExpression(
    text,
    /((?:password|passwd|pwd|密码)\s*(?:是|为|[:=])\s*)(?!\[REDACTED:)[^\s,，;；}"']+/giu,
    SENSITIVE_PLACEHOLDERS.password,
  );
  text = redactExpression(
    text,
    /((?:api[\s_-]*key|api\s*密钥|API密钥)\s*(?:是|为|[:=])\s*)(?!\[REDACTED:)[^\s,，;；}"']+/giu,
    SENSITIVE_PLACEHOLDERS.api_key,
  );
  text = redactExpression(
    text,
    /((?:client[\s_-]*secret|private[\s_-]*key|secret|token|(?<!API)(?<!API )密钥|令牌)\s*(?:是|为|[:=])\s*)(?!\[REDACTED:)[^\s,，;；}"']+/giu,
    SENSITIVE_PLACEHOLDERS.secret,
  );
  text = text.replace(
    /(?<!\d)\d{17}[\dXx](?!\d)/gu,
    SENSITIVE_PLACEHOLDERS.identity_document,
  );
  return text.replace(
    /(?<!\d)(?:\d[\s-]?){15,18}\d(?!\d)/gu,
    (candidate: string) =>
      passesLuhn(candidate) ? SENSITIVE_PLACEHOLDERS.bank_card : candidate,
  );
}

function redactExpression(
  text: string,
  pattern: RegExp,
  placeholder: string,
): string {
  return text.replace(
    pattern,
    (_match, prefix: string) => `${prefix}${placeholder}`,
  );
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeProperties(value: object): void {
  if (
    Object.getOwnPropertySymbols(value).some((symbol) =>
      Object.prototype.propertyIsEnumerable.call(value, symbol),
    )
  ) {
    throw new RedactionFailure('UNSUPPORTED_TYPE');
  }
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (descriptor.enumerable && !('value' in descriptor)) {
      throw new RedactionFailure('UNSAFE_PROPERTY');
    }
  }
}
