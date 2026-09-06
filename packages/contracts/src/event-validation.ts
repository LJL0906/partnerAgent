import type { ServerPushEventV1, SubscriptionChannel } from './events.js';
import { chatItemIds, isOperationId, TASK_STATES } from './chat-item-identity.js';
import { ANALYSIS_TYPES } from './local-core-analysis.js';
import { ERRORS } from './local-core.js';
import { isSessionMessageDto } from './local-core-queries.js';

const DISPLAY_EVENT_TYPES = [
  'text_delta', 'thinking_delta', 'tool_execution_start', 'tool_execution_end',
  'tool_confirmation_pending', 'tool_confirmation_confirmed',
  'tool_confirmation_dismissed', 'tool_undo_available', 'tool_undo_completed',
  'candidate', 'reminder', 'summary', 'task_state', 'error',
] as const;

const EVENT_TYPES = [
  ...DISPLAY_EVENT_TYPES, 'history', 'todo_update', 'cancelled', 'done', 'recovery_required',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isChannel = (value: unknown): value is SubscriptionChannel =>
  value === 'user:self'
  || (typeof value === 'string'
    && /^(task|operation|session):\S+$/.test(value));
const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isResourceRef = (value: unknown, kind: string): boolean =>
  isRecord(value) && value.kind === kind && hasText(value.id);

export function isServerPushEventV1(value: unknown): value is ServerPushEventV1 {
  if (!isRecord(value)
    || value.schema_version !== 1
    || !hasText(value.event_id)
    || !isChannel(value.channel)
    || !isPositiveInteger(value.sequence)
    || (value.operation_id !== undefined && !isOperationId(value.operation_id))
    || (value.session_id !== undefined && !hasText(value.session_id))
    || (value.task_id !== undefined && !hasText(value.task_id))
    || !(EVENT_TYPES as readonly unknown[]).includes(value.event_type)
    || typeof value.timestamp !== 'number'
    || !Number.isFinite(value.timestamp)
    || value.timestamp < 0
    || !isRecord(value.data)
      && typeof value.data !== 'string') return false;

  if ((value.channel as string).startsWith('task:')
    && value.task_id !== (value.channel as string).slice(5)) return false;
  if ((value.channel as string).startsWith('operation:')
    && value.operation_id !== (value.channel as string).slice(10)) return false;
  if ((value.channel as string).startsWith('session:')
    && value.session_id !== (value.channel as string).slice(8)) return false;

  const type = value.event_type;
  if ((DISPLAY_EVENT_TYPES as readonly unknown[]).includes(type)
    && (!hasText(value.item_id) || !isPositiveInteger(value.item_revision))) return false;

  if (type === 'text_delta') {
    return typeof value.data === 'string'
      && hasText(value.message_id)
      && isNonNegativeInteger(value.text_offset)
      && value.item_id === (hasText(value.task_id)
        ? chatItemIds.taskAssistant(value.task_id)
        : chatItemIds.message(value.message_id));
  }
  if (type === 'thinking_delta') {
    return typeof value.data === 'string'
      && isNonNegativeInteger(value.text_offset)
      && (!hasText(value.task_id)
        || value.item_id === chatItemIds.taskThinking(value.task_id));
  }
  if (type === 'history') {
    return isRecord(value.data)
      && Array.isArray(value.data.messages)
      && value.data.messages.every(isSessionMessageDto)
      && hasText(value.session_id)
      && value.data.messages.every((message) => message.session_id === value.session_id);
  }
  if (type === 'todo_update') {
    if (!hasText(value.task_id) || !isRecord(value.data) || !Array.isArray(value.data.items)
      || value.data.items.length > 8) return false;
    const ids = new Set<string>();
    for (const item of value.data.items) {
      if (!isRecord(item) || !hasText(item.id) || !hasText(item.content)
        || !['pending', 'in_progress', 'completed'].includes(item.status as string)
        || ids.has(item.id)) return false;
      ids.add(item.id);
    }
    return value.data.items.filter((item) => isRecord(item) && item.status === 'in_progress').length <= 1;
  }
  if (type === 'task_state') {
    if (!isRecord(value.data)
      || !(TASK_STATES as readonly unknown[]).includes(value.data.state)) return false;
    if (!hasText(value.task_id)
      || value.item_id !== chatItemIds.taskRuntime(value.task_id)
      || (value.data.error_code !== undefined
        && !(Object.values(ERRORS) as readonly unknown[]).includes(value.data.error_code))
      || (value.data.message !== undefined && typeof value.data.message !== 'string')
      || (value.data.privacy_decision !== undefined
        && (value.data.state !== 'waiting_privacy_decision'
          || !isRecord(value.data.privacy_decision)))) return false;
    if (value.data.privacy_decision !== undefined) {
      const privacy = value.data.privacy_decision;
      return hasText(privacy.egress_id)
        && Array.isArray(privacy.categories)
        && privacy.categories.every((category) => [
          'identity_document', 'bank_card', 'password', 'api_key', 'secret',
        ].includes(category as string))
        && hasText(privacy.provider)
        && hasText(privacy.model_id)
        && typeof privacy.expires_at === 'string'
        && Number.isFinite(Date.parse(privacy.expires_at));
    }
    return true;
  }
  if (type === 'tool_execution_start') {
    return isRecord(value.data)
      && hasText(value.data.tool)
      && hasText(value.data.tool_call_id)
      && value.item_id === chatItemIds.tool(value.data.tool_call_id);
  }
  if (type === 'tool_execution_end') {
    return isRecord(value.data)
      && hasText(value.data.tool)
      && hasText(value.data.tool_call_id)
      && typeof value.data.success === 'boolean'
      && (value.data.execution_id === undefined || hasText(value.data.execution_id))
      && (value.data.undo_available === undefined || typeof value.data.undo_available === 'boolean')
      && (value.data.undo_expires_at === undefined || isTimestamp(value.data.undo_expires_at))
      && value.item_id === chatItemIds.tool(value.data.tool_call_id);
  }
  if (type === 'tool_confirmation_pending') {
    return isRecord(value.data)
      && hasText(value.data.confirmation_id)
      && hasText(value.data.tool)
      && hasText(value.data.tool_call_id)
      && ['read_only', 'low', 'medium', 'high'].includes(value.data.risk_level as string)
      && typeof value.data.request_summary === 'string'
      && isTimestamp(value.data.expires_at)
      && value.item_id === chatItemIds.approval(value.data.confirmation_id);
  }
  if (type === 'tool_confirmation_confirmed') {
    return isRecord(value.data)
      && hasText(value.data.confirmation_id)
      && hasText(value.data.tool)
      && hasText(value.data.tool_call_id)
      && value.item_id === chatItemIds.approval(value.data.confirmation_id);
  }
  if (type === 'tool_confirmation_dismissed') {
    return isRecord(value.data)
      && hasText(value.data.confirmation_id)
      && hasText(value.data.tool)
      && hasText(value.data.tool_call_id)
      && (value.data.reason === 'user_dismissed' || value.data.reason === 'expired')
      && value.item_id === chatItemIds.approval(value.data.confirmation_id);
  }
  if (type === 'tool_undo_available') {
    return isRecord(value.data)
      && hasText(value.data.execution_id)
      && hasText(value.data.tool)
      && hasText(value.data.tool_call_id)
      && isTimestamp(value.data.expires_at)
      && value.item_id === chatItemIds.tool(value.data.tool_call_id);
  }
  if (type === 'tool_undo_completed') {
    return isRecord(value.data)
      && hasText(value.data.execution_id)
      && hasText(value.data.tool)
      && hasText(value.data.tool_call_id)
      && typeof value.data.success === 'boolean'
      && value.item_id === chatItemIds.tool(value.data.tool_call_id);
  }
  if (type === 'candidate') {
    return isRecord(value.data)
      && isResourceRef(value.data.analysis_ref, 'analysis_run')
      && isResourceRef(value.data.batch_ref, 'confirmation_batch')
      && Array.isArray(value.data.candidate_refs)
      && value.data.candidate_refs.every((ref) => isResourceRef(ref, 'candidate'))
      && isRecord(value.data.task_ref)
      && value.data.task_ref.kind === 'analysis'
      && hasText(value.data.task_ref.task_id)
      && hasText(value.data.task_ref.analysis_run_id)
      && Array.isArray(value.data.task_ref.analysis_types)
      && value.data.task_ref.analysis_types.length > 0
      && value.data.task_ref.analysis_types.every((analysisType) =>
        (ANALYSIS_TYPES as readonly unknown[]).includes(analysisType))
      && new Set(value.data.task_ref.analysis_types).size === value.data.task_ref.analysis_types.length
      && value.data.task_ref.task_id === value.task_id
      && value.data.task_ref.analysis_run_id === (value.data.analysis_ref as { id: string }).id
      && isNonNegativeInteger(value.data.candidate_count)
      && value.data.candidate_count === value.data.candidate_refs.length
      && (value.data.risk_level === 'normal' || value.data.risk_level === 'high')
      && typeof value.data.safe_summary === 'string'
      && isTimestamp(value.data.occurred_at);
  }
  if (type === 'reminder') {
    return isRecord(value.data) && hasText(value.data.reminder_instance_id);
  }
  if (type === 'summary') {
    return isRecord(value.data)
      && hasText(value.data.summary_id)
      && (value.data.summary_kind === 'daily' || value.data.summary_kind === 'weekly');
  }
  if (type === 'error') {
    return isRecord(value.data) && hasText(value.data.code) && typeof value.data.message === 'string';
  }
  if (type === 'cancelled' || type === 'done') {
    return isRecord(value.data) && Object.keys(value.data).length === 0;
  }
  if (type === 'recovery_required') {
    return isRecord(value.data)
      && value.data.reason === 'event_expired'
      && (value.data.query_url === undefined || typeof value.data.query_url === 'string');
  }
  return isRecord(value.data);
}

export function parseServerPushEventV1(value: unknown): ServerPushEventV1 {
  if (!isServerPushEventV1(value)) throw new TypeError('Invalid ServerPushEventV1');
  return value;
}
