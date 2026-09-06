/** 聊天结构化预览是未确认、未生效的展示附件，不是正式候选或确认对象。 */

export const CHAT_PREVIEW_SCHEMA_VERSION = 1 as const;
export const CHAT_PREVIEW_KINDS = ['action'] as const;
export type ChatPreviewKind = (typeof CHAT_PREVIEW_KINDS)[number];

export const CHAT_PREVIEW_CONFIRMATION_STATUS = 'unconfirmed' as const;
export const CHAT_PREVIEW_APPLIED = false as const;
export const CHAT_PREVIEW_MAX_ITEMS_PER_TASK = 20;
export const CHAT_PREVIEW_MAX_PUBLIC_BYTES = 64 * 1024;
export const CHAT_PREVIEW_TITLE_MAX_CHARS = 200;
export const CHAT_PREVIEW_TEXT_MAX_CHARS = 2_000;

/** Agent 工具和契约测试共同消费的 proposal JSON Schema。 */
export const CHAT_PREVIEW_PROPOSAL_V1_JSON_SCHEMA = {
  type: 'object',
  properties: {
    schema_version: { const: 1, type: 'number' },
    kind: { const: 'action', type: 'string' },
    source_refs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: {
            anyOf: [
              { const: 'original_record', type: 'string' },
              { const: 'chat_message', type: 'string' },
            ],
          },
          id: { minLength: 1, type: 'string' },
        },
        required: ['kind', 'id'],
        additionalProperties: false,
      },
    },
    content: {
      type: 'object',
      properties: {
        title: { minLength: 1, maxLength: CHAT_PREVIEW_TITLE_MAX_CHARS, type: 'string' },
        description: { maxLength: CHAT_PREVIEW_TEXT_MAX_CHARS, type: 'string' },
        planned_at: { type: 'string' },
        deadline_at: { type: 'string' },
        timezone: { minLength: 1, type: 'string' },
        priority: {
          anyOf: [
            { const: 'low', type: 'string' },
            { const: 'medium', type: 'string' },
            { const: 'high', type: 'string' },
          ],
        },
        confidence: { minimum: 0, maximum: 1, type: 'number' },
        uncertainty: { maxLength: CHAT_PREVIEW_TEXT_MAX_CHARS, type: 'string' },
        risk_summary: { maxLength: CHAT_PREVIEW_TEXT_MAX_CHARS, type: 'string' },
      },
      required: ['title', 'confidence'],
      additionalProperties: false,
    },
  },
  required: ['schema_version', 'kind', 'content'],
  additionalProperties: false,
} as const;

export const CHAT_PREVIEW_ERROR_CODES = {
  INVALID: 'STRUCTURED_PREVIEW_INVALID',
  MISSING: 'STRUCTURED_PREVIEW_MISSING',
  TOO_LARGE: 'STRUCTURED_PREVIEW_TOO_LARGE',
  SOURCE_INVALID: 'STRUCTURED_PREVIEW_SOURCE_INVALID',
} as const;
export type ChatPreviewErrorCode =
  (typeof CHAT_PREVIEW_ERROR_CODES)[keyof typeof CHAT_PREVIEW_ERROR_CODES];

export interface ChatPreviewSourceRef {
  kind: 'original_record' | 'chat_message';
  id: string;
}

export interface ActionChatPreviewContentV1 {
  title: string;
  description?: string;
  planned_at?: string;
  deadline_at?: string;
  timezone?: string;
  priority?: 'low' | 'medium' | 'high';
  confidence: number;
  uncertainty?: string;
  risk_summary?: string;
}

export interface ChatPreviewWarningV1 {
  code: string;
  path?: string;
  message: string;
}

/** 模型/Agent 可提交的内容；不允许携带服务端身份、确认状态或生效状态。 */
export interface ChatPreviewProposalV1 {
  schema_version: 1;
  kind: 'action';
  source_refs?: ChatPreviewSourceRef[];
  content: ActionChatPreviewContentV1;
}

/** 服务端校验并补齐身份后的公开附件。 */
export interface ChatPreviewV1 {
  schema_version: 1;
  preview_id: string;
  kind: 'action';
  confirmation_status: 'unconfirmed';
  applied: false;
  source_refs: ChatPreviewSourceRef[];
  content: ActionChatPreviewContentV1;
  warnings: ChatPreviewWarningV1[];
}

export interface ChatPreviewValidationIssue {
  code: ChatPreviewErrorCode;
  path: string;
  message: string;
}

export class ChatPreviewValidationError extends TypeError {
  readonly issues: ChatPreviewValidationIssue[];

  constructor(issues: ChatPreviewValidationIssue[]) {
    super('Invalid ChatPreviewV1');
    this.name = 'ChatPreviewValidationError';
    this.issues = issues;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const charLength = (value: string): number => Array.from(value).length;
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));
const isBoundedText = (value: unknown, maximum: number, allowEmpty = true): value is string =>
  typeof value === 'string'
  && (allowEmpty || value.trim().length > 0)
  && charLength(value) <= maximum;
const isOptional = (value: unknown, check: (input: unknown) => boolean): boolean =>
  value === undefined || check(value);
const isRfc3339WithOffset = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12
    && day >= 1 && day <= daysInMonth
    && Number(hourText) <= 23
    && Number(minuteText) <= 59
    && Number(secondText) <= 59
    && (offsetHourText === undefined || Number(offsetHourText) <= 23)
    && (offsetMinuteText === undefined || Number(offsetMinuteText) <= 59)
    && Number.isFinite(Date.parse(value));
};
const isIanaTimeZone = (value: unknown): value is string => {
  if (!hasText(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};
const isWithinPublicSize = (value: unknown): boolean => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= CHAT_PREVIEW_MAX_PUBLIC_BYTES;
  } catch {
    return false;
  }
};

const isSourceRef = (value: unknown): value is ChatPreviewSourceRef =>
  isRecord(value)
  && hasOnlyKeys(value, ['kind', 'id'])
  && (value.kind === 'original_record' || value.kind === 'chat_message')
  && hasText(value.id);

const isSourceRefs = (value: unknown): value is ChatPreviewSourceRef[] =>
  Array.isArray(value) && value.every(isSourceRef);

const hasChronologicalTimes = (value: Record<string, unknown>): boolean =>
  typeof value.planned_at !== 'string'
  || typeof value.deadline_at !== 'string'
  || Date.parse(value.planned_at) <= Date.parse(value.deadline_at);

const isActionContent = (value: unknown): value is ActionChatPreviewContentV1 => {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'title', 'description', 'planned_at', 'deadline_at', 'timezone',
    'priority', 'confidence', 'uncertainty', 'risk_summary',
  ])) return false;

  return isBoundedText(value.title, CHAT_PREVIEW_TITLE_MAX_CHARS, false)
    && isOptional(value.description, (input) => isBoundedText(input, CHAT_PREVIEW_TEXT_MAX_CHARS))
    && isOptional(value.planned_at, isRfc3339WithOffset)
    && isOptional(value.deadline_at, isRfc3339WithOffset)
    && isOptional(value.timezone, isIanaTimeZone)
    && isOptional(value.priority, (input) => input === 'low' || input === 'medium' || input === 'high')
    && typeof value.confidence === 'number'
    && Number.isFinite(value.confidence)
    && value.confidence >= 0
    && value.confidence <= 1
    && isOptional(value.uncertainty, (input) => isBoundedText(input, CHAT_PREVIEW_TEXT_MAX_CHARS))
    && isOptional(value.risk_summary, (input) => isBoundedText(input, CHAT_PREVIEW_TEXT_MAX_CHARS))
    && hasChronologicalTimes(value);
};

const isWarning = (value: unknown): value is ChatPreviewWarningV1 =>
  isRecord(value)
  && hasOnlyKeys(value, ['code', 'path', 'message'])
  && hasText(value.code)
  && isOptional(value.path, (input) => typeof input === 'string')
  && typeof value.message === 'string';

export function isChatPreviewProposalV1(value: unknown): value is ChatPreviewProposalV1 {
  return isRecord(value)
    && hasOnlyKeys(value, ['schema_version', 'kind', 'source_refs', 'content'])
    && value.schema_version === CHAT_PREVIEW_SCHEMA_VERSION
    && value.kind === 'action'
    && isOptional(value.source_refs, isSourceRefs)
    && isActionContent(value.content)
    && isWithinPublicSize(value);
}

export function parseChatPreviewProposalV1(value: unknown): ChatPreviewProposalV1 {
  if (!isChatPreviewProposalV1(value)) {
    throw new ChatPreviewValidationError([{
      code: isWithinPublicSize(value)
        ? CHAT_PREVIEW_ERROR_CODES.INVALID
        : CHAT_PREVIEW_ERROR_CODES.TOO_LARGE,
      path: '/',
      message: '模型输出不符合 ChatPreviewProposalV1 契约',
    }]);
  }
  return value;
}

export function isChatPreviewV1(value: unknown): value is ChatPreviewV1 {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'schema_version', 'preview_id', 'kind', 'confirmation_status',
      'applied', 'source_refs', 'content', 'warnings',
    ])
    && value.schema_version === CHAT_PREVIEW_SCHEMA_VERSION
    && hasText(value.preview_id)
    && value.kind === 'action'
    && value.confirmation_status === CHAT_PREVIEW_CONFIRMATION_STATUS
    && value.applied === CHAT_PREVIEW_APPLIED
    && isSourceRefs(value.source_refs)
    && value.source_refs.length > 0
    && isActionContent(value.content)
    && Array.isArray(value.warnings)
    && value.warnings.every(isWarning)
    && isWithinPublicSize(value);
}

export function parseChatPreviewV1(value: unknown): ChatPreviewV1 {
  if (!isChatPreviewV1(value)) {
    const tooLarge = !isWithinPublicSize(value);
    const sourceInvalid = isRecord(value)
      && (!isSourceRefs(value.source_refs) || value.source_refs.length === 0);
    throw new ChatPreviewValidationError([{
      code: tooLarge
        ? CHAT_PREVIEW_ERROR_CODES.TOO_LARGE
        : sourceInvalid
          ? CHAT_PREVIEW_ERROR_CODES.SOURCE_INVALID
          : CHAT_PREVIEW_ERROR_CODES.INVALID,
      path: sourceInvalid ? '/source_refs' : '/',
      message: tooLarge
        ? '结构化预览附件超过 64 KiB'
        : sourceInvalid
          ? '结构化预览必须包含至少一个合法来源引用'
          : '结构化预览不符合 ChatPreviewV1 安全契约',
    }]);
  }
  return value;
}

/** 按单任务附件集合校验数量和整体 UTF-8 JSON 大小。 */
export function parseChatPreviewsV1(value: unknown): ChatPreviewV1[] {
  if (!Array.isArray(value)) {
    throw new ChatPreviewValidationError([{
      code: CHAT_PREVIEW_ERROR_CODES.INVALID,
      path: '/',
      message: '结构化预览集合必须是数组',
    }]);
  }
  if (value.length === 0) {
    throw new ChatPreviewValidationError([{
      code: CHAT_PREVIEW_ERROR_CODES.MISSING,
      path: '/',
      message: '结构化预览集合不能为空',
    }]);
  }
  if (value.length > CHAT_PREVIEW_MAX_ITEMS_PER_TASK || !isWithinPublicSize(value)) {
    throw new ChatPreviewValidationError([{
      code: CHAT_PREVIEW_ERROR_CODES.TOO_LARGE,
      path: '/',
      message: '结构化预览最多 20 项且整体不得超过 64 KiB',
    }]);
  }
  const previewIds = value
    .filter(isRecord)
    .map((preview) => preview.preview_id)
    .filter((previewId): previewId is string => typeof previewId === 'string');
  if (new Set(previewIds).size !== previewIds.length) {
    throw new ChatPreviewValidationError([{
      code: CHAT_PREVIEW_ERROR_CODES.INVALID,
      path: '/preview_id',
      message: '同一任务的 preview_id 不得重复',
    }]);
  }
  return value.map((preview, index) => {
    try {
      return parseChatPreviewV1(preview);
    } catch (error) {
      if (error instanceof ChatPreviewValidationError) {
        throw new ChatPreviewValidationError(error.issues.map((issue) => ({
          ...issue,
          path: `/${index}${issue.path === '/' ? '' : issue.path}`,
        })));
      }
      throw error;
    }
  });
}

/**
 * 按持久化顺序恢复可安全展示的附件集合。
 *
 * 严格写入仍由 parseChatPreviewsV1 拒绝非法集合；本函数仅用于读取历史
 * JSONB 时逐项隔离损坏、重复、超数量或使累计载荷超限的条目。
 */
export function recoverChatPreviewsV1(value: unknown): ChatPreviewV1[] {
  if (!Array.isArray(value)) return [];
  const recovered: ChatPreviewV1[] = [];
  for (const candidate of value) {
    let preview: ChatPreviewV1;
    try {
      preview = parseChatPreviewV1(candidate);
      parseChatPreviewsV1([...recovered, preview]);
    } catch {
      continue;
    }
    recovered.push(preview);
  }
  return recovered;
}
