import type {
  CommandEnvelope,
  CommandResult,
  ChatSessionSummary,
  ChatSessionTaskRef,
  ChatSessionListItem,
  ChatOutputMode,
  CancelTaskPayload,
  ListChatSessionsResult,
  SubmitTextInputPayload,
  SubmitTextInputCommandResult,
  TaskStatus,
  ModelConfig,
  ReasoningLevel,
  SessionMessageDto,
  SetMessageModelSelectionResult,
} from '@partner-agent/contracts';
import {
  isModelConfig,
  isOperationId,
  isSessionMessageDto,
  parseChatSessionSummary,
  parseSubmitTextInputCommandResult,
  TASK_STATES,
} from '@partner-agent/contracts';

import { createCommandEnvelope, createOperationId } from './command-envelope';
import { apiConfig } from './config';
import { getJson, postJson, type RequestOptions } from './http-client';

interface SubmitTextInputParamsBase {
  text: string;
  sessionId?: string;
  inputId?: string;
  operationId?: string;
  modelConfigId: string;
  reasoningLevel: ReasoningLevel;
  signal?: AbortSignal;
}
export type SubmitTextOutputMode = ChatOutputMode;
export type SubmitTextInputParams = SubmitTextInputParamsBase & (
  | { outputMode?: 'chat'; requestAnalysis: true; analysisTypes: NonNullable<SubmitTextInputPayload['analysis_types']> }
  | { outputMode?: 'chat'; requestAnalysis?: false; analysisTypes?: never }
  | { outputMode: 'structured_preview'; requestAnalysis?: false; analysisTypes?: never }
);

export async function submitTextInput(
  params: SubmitTextInputParams,
): Promise<SubmitTextInputCommandResult> {
  const inputId = params.inputId ?? createOperationId();
  const operationId = params.operationId ?? createOperationId();
  const base = {
    text: params.text,
    ...(params.sessionId ? { session_id: params.sessionId } : {}),
    input_id: inputId,
    model_config_id: params.modelConfigId,
    reasoning_level: params.reasoningLevel,
  };
  const payload: SubmitTextInputPayload = params.outputMode === 'structured_preview'
    ? {
      ...base,
      output_mode: 'structured_preview',
      preview_kind: 'action',
      request_analysis: false,
    }
    : params.requestAnalysis === true
    ? {
      ...base,
      output_mode: 'chat',
      request_analysis: true,
      analysis_types: params.analysisTypes,
    }
    : { ...base, output_mode: 'chat', request_analysis: false };
  const envelope = await createCommandEnvelope(payload, { operationId });
  const result = await postJson<CommandEnvelope<SubmitTextInputPayload>, unknown>(
    apiConfig.submitTextPath,
    envelope,
    { signal: params.signal },
  );
  try {
    return parseSubmitTextInputCommandResult(result, operationId);
  } catch {
    throw new Error('消息提交响应格式无效。');
  }
}

export type RecoverableTaskStatus = TaskStatus;

type LegacyRecoverableChatSession = Omit<ChatSessionSummary, 'items' | 'tool_views'>;
export type RecoverableChatSession = ChatSessionSummary;
export function getTaskStatus(
  taskId: string,
  options: RequestOptions = {},
): Promise<RecoverableTaskStatus> {
  return getJson(`${apiConfig.taskPath}/${encodeURIComponent(taskId)}`, options);
}

export function getChatSession(
  sessionId: string,
  options: RequestOptions = {},
): Promise<RecoverableChatSession> {
  return getJson<unknown>(`${apiConfig.chatSessionPath}/${encodeURIComponent(sessionId)}`, options)
    .then((value) => {
      try {
        const parsed = parseChatSessionSummary(value);
        if (parsed.id !== sessionId) throw new TypeError('Session mismatch');
        return parsed;
      } catch {
        // The snapshot applier owns this finite migration branch and detects the
        // deliberate absence of items/tool_views. Keep the public query type on
        // the current shared contract so normal callers cannot create legacy data.
        if (isLegacyRecoverableChatSession(value) && value.id === sessionId) {
          return value as RecoverableChatSession;
        }
        throw new Error('会话快照响应格式无效。');
      }
    });
}

function isLegacyRecoverableChatSession(value: unknown): value is LegacyRecoverableChatSession {
  if (!isRecord(value)
    || !Object.keys(value).every((key) => [
      'id', 'title', 'created_at', 'updated_at', 'message_count',
      'last_message_preview', 'active_task', 'latest_task', 'messages',
    ].includes(key))
    || !hasText(value.id)
    || (value.title !== undefined && typeof value.title !== 'string')
    || !isDateString(value.created_at)
    || !isDateString(value.updated_at)
    || typeof value.message_count !== 'number'
    || !Number.isSafeInteger(value.message_count)
    || value.message_count < 0
    || (value.last_message_preview !== undefined && typeof value.last_message_preview !== 'string')
    || (value.active_task !== undefined && !isChatSessionTaskRef(value.active_task))
    || (value.latest_task !== undefined && !isChatSessionTaskRef(value.latest_task))
    || !Array.isArray(value.messages)
    || !value.messages.every(isSessionMessageDto)
    || value.message_count < value.messages.length) return false;

  const messages = value.messages as SessionMessageDto[];
  return messages.every((message) => message.session_id === value.id)
    && new Set(messages.map((message) => message.id)).size === messages.length
    && new Set(messages.map((message) => message.sequence)).size === messages.length
    && !messages.some((message, index) => index > 0 && message.sequence <= messages[index - 1].sequence);
}

function isChatSessionTaskRef(value: unknown): value is ChatSessionTaskRef {
  return isRecord(value)
    && Object.keys(value).every((key) => ['task_id', 'operation_id', 'state'].includes(key))
    && hasText(value.task_id)
    && isOperationId(value.operation_id)
    && (TASK_STATES as readonly unknown[]).includes(value.state);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export async function cancelTask(
  taskId: string,
  options: RequestOptions = {},
): Promise<CommandResult> {
  const operationId = createOperationId();
  const payload: CancelTaskPayload = { task_id: taskId };
  const envelope = await createCommandEnvelope(payload, { operationId });
  return postJson<CommandEnvelope<CancelTaskPayload>, CommandResult>(
    apiConfig.cancelTaskPath,
    envelope,
    options,
  );
}

export function listChatSessions(options: RequestOptions = {}): Promise<ListChatSessionsResult> {
  return getJson(apiConfig.chatSessionPath, options);
}


export async function renameChatSession(sessionId: string, title: string): Promise<ChatSessionListItem> {
  const operationId = createOperationId();
  const envelope = await createCommandEnvelope({ title }, { operationId });
  return postJson<typeof envelope, ChatSessionListItem>(
    `${apiConfig.renameChatSessionPath}/${encodeURIComponent(sessionId)}/rename`,
    envelope,
  );
}

export async function archiveChatSession(sessionId: string): Promise<ChatSessionListItem> {
  const operationId = createOperationId();
  const envelope = await createCommandEnvelope({}, { operationId });
  return postJson<typeof envelope, ChatSessionListItem>(
    `${apiConfig.archiveChatSessionPath}/${encodeURIComponent(sessionId)}/archive`,
    envelope,
  );
}

export async function listModelConfigs(options: RequestOptions = {}): Promise<{ items: ModelConfig[] }> {
  const value = await getJson<unknown>(apiConfig.modelConfigsPath, options);
  if (typeof value !== 'object' || value === null || !('items' in value)
    || !Array.isArray(value.items) || !value.items.every(isModelConfig)) {
    throw new Error('模型配置响应格式无效。');
  }
  return { items: value.items };
}


export async function setMessageModelSelection(params: { sessionId: string; previousModelConfigId?: string; modelConfigId: string; reasoningLevel: ReasoningLevel; signal?: AbortSignal }): Promise<CommandResult<SetMessageModelSelectionResult>> {
  const operationId = createOperationId();
  const envelope = await createCommandEnvelope({ session_id: params.sessionId, previous_model_config_id: params.previousModelConfigId, model_config_id: params.modelConfigId, reasoning_level: params.reasoningLevel }, { operationId });
  return postJson<typeof envelope, CommandResult<SetMessageModelSelectionResult>>(
    apiConfig.setModelSelectionPath,
    envelope,
    { signal: params.signal },
  );
}
