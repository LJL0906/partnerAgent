import type { SensitiveCategory } from '@partner-agent/contracts';

export type { SensitiveCategory } from '@partner-agent/contracts';

export interface SensitiveDataLimits {
  maxDepth: number;
  maxNodes: number;
  maxTotalStringLength: number;
  maxStringLength: number;
}

export const DEFAULT_SENSITIVE_DATA_LIMITS: Readonly<SensitiveDataLimits> = {
  maxDepth: 20,
  maxNodes: 10_000,
  maxTotalStringLength: 2 * 1024 * 1024,
  maxStringLength: 1024 * 1024,
};

export type SensitiveDataFailureCode =
  | 'CIRCULAR_REFERENCE'
  | 'MAX_DEPTH_EXCEEDED'
  | 'MAX_NODES_EXCEEDED'
  | 'MAX_TOTAL_STRING_LENGTH_EXCEEDED'
  | 'MAX_STRING_LENGTH_EXCEEDED'
  | 'UNSUPPORTED_TYPE'
  | 'UNSAFE_PROPERTY'
  | 'SCANNER_ERROR'
  | 'REDACTOR_ERROR';

export interface SensitiveFinding {
  category: SensitiveCategory;
  path: string;
  detector: string;
}

export type SensitiveScanResult =
  | {
      ok: true;
      findings: SensitiveFinding[];
      categories: SensitiveCategory[];
    }
  | { ok: false; reason: SensitiveDataFailureCode };

export type SensitiveRedactionResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: SensitiveDataFailureCode };

export const SENSITIVE_PLACEHOLDERS: Readonly<
  Record<SensitiveCategory, string>
> = {
  password: '[REDACTED:PASSWORD]',
  api_key: '[REDACTED:API_KEY]',
  bank_card: '[REDACTED:BANK_CARD]',
  identity_document: '[REDACTED:IDENTITY_DOCUMENT]',
  secret: '[REDACTED:SECRET]',
};

export const TOKEN_PLACEHOLDER = '[REDACTED:TOKEN]';

export const SAFE_SENSITIVE_PLACEHOLDERS = new Set<string>([
  ...Object.values(SENSITIVE_PLACEHOLDERS),
  TOKEN_PLACEHOLDER,
]);
