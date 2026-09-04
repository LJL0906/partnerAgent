import {
  SENSITIVE_CATEGORIES,
  type SensitiveCategory,
} from '@partner-agent/contracts';
import {
  DEFAULT_SENSITIVE_DATA_LIMITS,
  SAFE_SENSITIVE_PLACEHOLDERS,
  type SensitiveDataFailureCode,
  type SensitiveDataLimits,
  type SensitiveFinding,
  type SensitiveScanResult,
} from './sensitive-data.types.js';

type FieldRule = { category: SensitiveCategory; detector: string };

const FIELD_RULES = new Map<string, FieldRule>([
  ['password', { category: 'password', detector: 'field_name_password' }],
  ['passwd', { category: 'password', detector: 'field_name_password' }],
  ['pwd', { category: 'password', detector: 'field_name_password' }],
  ['密码', { category: 'password', detector: 'field_name_password' }],
  ['secret', { category: 'secret', detector: 'field_name_secret' }],
  ['clientsecret', { category: 'secret', detector: 'field_name_secret' }],
  ['privatekey', { category: 'secret', detector: 'field_name_secret' }],
  ['密钥', { category: 'secret', detector: 'field_name_secret' }],
  ['token', { category: 'secret', detector: 'field_name_token' }],
  ['accesstoken', { category: 'secret', detector: 'field_name_token' }],
  ['refreshtoken', { category: 'secret', detector: 'field_name_token' }],
  ['authorization', { category: 'secret', detector: 'field_name_token' }],
  ['令牌', { category: 'secret', detector: 'field_name_token' }],
  ['apikey', { category: 'api_key', detector: 'field_name_api_key' }],
]);

const FAILURE_CODES = new Set<SensitiveDataFailureCode>([
  'CIRCULAR_REFERENCE',
  'MAX_DEPTH_EXCEEDED',
  'MAX_NODES_EXCEEDED',
  'MAX_TOTAL_STRING_LENGTH_EXCEEDED',
  'MAX_STRING_LENGTH_EXCEEDED',
  'UNSUPPORTED_TYPE',
  'UNSAFE_PROPERTY',
]);

class TraversalFailure extends Error {
  constructor(readonly code: SensitiveDataFailureCode) {
    super(code);
  }
}

export function normalizeSensitiveFieldName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s_\-‐‑‒–—―.:：/\\]+/gu, '');
}

export function sensitiveFieldRule(key: string): FieldRule | undefined {
  return FIELD_RULES.get(normalizeSensitiveFieldName(key));
}

export function isSafeSensitivePlaceholder(value: unknown): boolean {
  return typeof value === 'string' && SAFE_SENSITIVE_PLACEHOLDERS.has(value);
}

export function passesLuhn(candidate: string): boolean {
  const digits = candidate.replace(/[\s-]/gu, '');
  if (!/^\d{16,19}$/u.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export class SensitiveDataScanner {
  private readonly limits: SensitiveDataLimits;

  constructor(limits: Partial<SensitiveDataLimits> = {}) {
    this.limits = validateLimits({
      ...DEFAULT_SENSITIVE_DATA_LIMITS,
      ...limits,
    });
  }

  scan(value: unknown): SensitiveScanResult {
    const findings: SensitiveFinding[] = [];
    const ancestors = new Set<object>();
    let nodes = 0;
    let totalStringLength = 0;

    const countString = (text: string): void => {
      if (text.length > this.limits.maxStringLength) {
        throw new TraversalFailure('MAX_STRING_LENGTH_EXCEEDED');
      }
      totalStringLength += text.length;
      if (totalStringLength > this.limits.maxTotalStringLength) {
        throw new TraversalFailure('MAX_TOTAL_STRING_LENGTH_EXCEEDED');
      }
    };

    const add = (
      category: SensitiveCategory,
      path: string,
      detector: string,
    ): void => {
      findings.push({ category, path, detector });
    };

    const visit = (item: unknown, path: string, depth: number): void => {
      if (depth > this.limits.maxDepth) {
        throw new TraversalFailure('MAX_DEPTH_EXCEEDED');
      }
      nodes += 1;
      if (nodes > this.limits.maxNodes) {
        throw new TraversalFailure('MAX_NODES_EXCEEDED');
      }
      if (item === null || item === undefined || typeof item === 'boolean')
        return;
      if (typeof item === 'string') {
        countString(item);
        this.scanText(item, path, add);
        return;
      }
      if (typeof item === 'number') {
        if (
          !Number.isFinite(item) ||
          (Number.isInteger(item) && !Number.isSafeInteger(item))
        ) {
          throw new TraversalFailure('UNSUPPORTED_TYPE');
        }
        const rendered = String(item);
        countString(rendered);
        this.scanText(rendered, path, add);
        return;
      }
      if (typeof item !== 'object') {
        throw new TraversalFailure('UNSUPPORTED_TYPE');
      }
      if (item instanceof Date) {
        if (Number.isNaN(item.getTime())) {
          throw new TraversalFailure('UNSUPPORTED_TYPE');
        }
        return;
      }
      if (!Array.isArray(item) && !isPlainObject(item)) {
        throw new TraversalFailure('UNSUPPORTED_TYPE');
      }
      if (ancestors.has(item)) {
        throw new TraversalFailure('CIRCULAR_REFERENCE');
      }
      assertSafeProperties(item);
      ancestors.add(item);
      try {
        if (Array.isArray(item)) {
          for (let index = 0; index < item.length; index += 1) {
            if (Object.hasOwn(item, index)) {
              visit(item[index], `${path}[${index}]`, depth + 1);
            }
          }
          return;
        }
        for (const key of Object.keys(item)) {
          countString(key);
          const childPath = appendPath(path, key);
          const child = item[key];
          const fieldRule = sensitiveFieldRule(key);
          if (fieldRule && !isSafeSensitivePlaceholder(child)) {
            add(fieldRule.category, childPath, fieldRule.detector);
          }
          visit(child, childPath, depth + 1);
        }
      } finally {
        ancestors.delete(item);
      }
    };

    try {
      visit(value, '$', 0);
      return {
        ok: true,
        findings,
        categories: SENSITIVE_CATEGORIES.filter((category) =>
          findings.some((finding) => finding.category === category),
        ),
      };
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof TraversalFailure && FAILURE_CODES.has(error.code)
            ? error.code
            : 'SCANNER_ERROR',
      };
    }
  }

  private scanText(
    original: string,
    path: string,
    add: (category: SensitiveCategory, path: string, detector: string) => void,
  ): void {
    if (isSafeSensitivePlaceholder(original)) return;
    const text = original.normalize('NFKC');
    const detectors: Array<[SensitiveCategory, string, RegExp]> = [
      ['secret', 'bearer_token', /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu],
      [
        'secret',
        'jwt',
        /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
      ],
      ['api_key', 'sk_api_key', /\bsk-[A-Za-z0-9_-]{12,}\b/iu],
      [
        'password',
        'password_expression',
        /(?:password|passwd|pwd|密码)\s*(?:是|为|[:=])\s*(?!\[REDACTED:)[^\s,，;；}"']+/iu,
      ],
      [
        'api_key',
        'api_key_expression',
        /(?:api[\s_-]*key|api\s*密钥|API密钥)\s*(?:是|为|[:=])\s*(?!\[REDACTED:)[^\s,，;；}"']+/iu,
      ],
      [
        'secret',
        'secret_expression',
        /(?:client[\s_-]*secret|private[\s_-]*key|secret|token|(?<!API)(?<!API )密钥|令牌)\s*(?:是|为|[:=])\s*(?!\[REDACTED:)[^\s,，;；}"']+/iu,
      ],
      [
        'identity_document',
        'cn_identity_document',
        /(?<!\d)\d{17}[\dXx](?!\d)/u,
      ],
    ];
    for (const [category, detector, pattern] of detectors) {
      if (pattern.test(text)) add(category, path, detector);
    }
    const bankCandidates =
      text.match(/(?<!\d)(?:\d[\s-]?){15,18}\d(?!\d)/gu) ?? [];
    if (bankCandidates.some(passesLuhn))
      add('bank_card', path, 'bank_card_luhn');
  }
}

function validateLimits(limits: SensitiveDataLimits): SensitiveDataLimits {
  if (
    !Object.values(limits).every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  ) {
    throw new TypeError('Sensitive data limits must be non-negative integers');
  }
  return limits;
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
    throw new TraversalFailure('UNSUPPORTED_TYPE');
  }
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (descriptor.enumerable && !('value' in descriptor)) {
      throw new TraversalFailure('UNSAFE_PROPERTY');
    }
  }
}

function appendPath(parent: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/u.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}
