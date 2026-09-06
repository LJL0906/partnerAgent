import type {
  CommandEnvelope,
  CommandResult,
  ChatSessionSummary,
  ChatSessionListItem,
  ListChatSessionsResult,
  SubmitTextInputPayload,
  SubmitTextInputResult,
  TaskStatus,
  ModelConfig,
  ReasoningLevel,
} from '@partner-agent/contracts';

import { createCommandEnvelope, createOperationId } from './command-envelope';
import { apiConfig } from './config';
import { getJson, postJson, type RequestOptions } from './http-client';

export interface SubmitTextInputParams {
  text: string;
  sessionId: string;
  inputId?: string;
  operationId?: string;
  requestAnalysis?: boolean;
  analysisTypes?: SubmitTextInputPayload['analysis_types'];
  modelConfigId: string;
  reasoningLevel: ReasoningLevel;
  signal?: AbortSignal;
}

export interface CancelTaskPayload {
  task_id: string;
}

export async function submitTextInput(
  params: SubmitTextInputParams,
): Promise<CommandResult<SubmitTextInputResult>> {
  const inputId = params.inputId ?? createOperationId();
  const operationId = params.operationId ?? createOperationId();
  const payload: SubmitTextInputPayload = {
    text: params.text,
    session_id: params.sessionId,
    request_analysis: params.requestAnalysis ?? false,
    analysis_types: params.analysisTypes,
    input_id: inputId,
    model_config_id: params.modelConfigId,
    reasoning_level: params.reasoningLevel,
  };
  const envelope = await createCommandEnvelope(payload, { operationId });

  return postJson<CommandEnvelope<SubmitTextInputPayload>, CommandResult<SubmitTextInputResult>>(
    apiConfig.submitTextPath,
    envelope,
    { signal: params.signal },
  );
}

export type RecoverableTaskStatus = TaskStatus;

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
  return getJson(`${apiConfig.chatSessionPath}/${encodeURIComponent(sessionId)}`, options);
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

export function listModelConfigs(): Promise<{ items: ModelConfig[] }> { return getJson(apiConfig.modelConfigsPath); }


export async function setMessageModelSelection(params: { sessionId: string; previousModelConfigId?: string; modelConfigId: string; reasoningLevel: ReasoningLevel }): Promise<CommandResult> {
  const operationId = createOperationId();
  const envelope = await createCommandEnvelope({ session_id: params.sessionId, previous_model_config_id: params.previousModelConfigId, model_config_id: params.modelConfigId, reasoning_level: params.reasoningLevel }, { operationId });
  return postJson<typeof envelope, CommandResult>(apiConfig.setModelSelectionPath, envelope);
}
