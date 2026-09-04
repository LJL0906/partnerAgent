import { Injectable } from '@nestjs/common';

const SENSITIVE_KEY =
  /(authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key)/i;
const MAX_SUMMARY_LENGTH = 2_000;
const SENSITIVE_VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [已脱敏]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[JWT已脱敏]'],
  [
    /\b(api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^\s,'";}]+/gi,
    '$1=[已脱敏]',
  ],
  [/[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]*/g, '[内部路径已脱敏]'],
  [
    /(?:\/(?:home|Users|workspace|app|srv|opt|var)\/)[^\s:'"]+/g,
    '[内部路径已脱敏]',
  ],
];

@Injectable()
export class RedactionService {
  sanitize(value: unknown): unknown {
    return this.walk(value, new WeakSet<object>());
  }

  summarize(value: unknown): string {
    const serialized = JSON.stringify(this.sanitize(value));
    if (!serialized) return '';
    return serialized.length > MAX_SUMMARY_LENGTH
      ? `${serialized.slice(0, MAX_SUMMARY_LENGTH)}…`
      : serialized;
  }

  private walk(value: unknown, seen: WeakSet<object>): unknown {
    if (typeof value === 'string') return this.sanitizeString(value);
    if (Array.isArray(value))
      return value.map((entry) => this.walk(entry, seen));
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return '[循环引用]';
    seen.add(value);

    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_KEY.test(key) ? '[已脱敏]' : this.walk(entry, seen),
      ]),
    );
  }

  private sanitizeString(value: string): string {
    return SENSITIVE_VALUE_PATTERNS.reduce(
      (sanitized, [pattern, replacement]) =>
        sanitized.replace(pattern, replacement),
      value,
    );
  }
}
