import type {
  CommandEnvelope,
  CommandResult,
  ChatSessionSummary,
  SubmitTextInputPayload,
  SubmitTextInputResult,
  TaskStatus,
} from '@partner-agent/contracts';

import { createCommandEnvelope, createOperationId } from './command-envelope';
import { apiConfig } from './config';
import { getJson, postJson, type RequestOptions } from './http-client';

export interface SubmitTextInputParams {
  text: string;
  sessionId: string;
  requestAnalysis?: boolean;
  analysisTypes?: SubmitTextInputPayload['analysis_types'];
  signal?: AbortSignal;
}

export interface CancelTaskPayload {
  task_id: string;
}

export async function submitTextInput(
  params: SubmitTextInputParams,
): Promise<CommandResult<SubmitTextInputResult>> {
  const inputId = createOperationId();
  const operationId = createOperationId();
  const payload: SubmitTextInputPayload = {
    text: params.text,
    session_id: params.sessionId,
    request_analysis: params.requestAnalysis ?? false,
    analysis_types: params.analysisTypes,
    input_id: inputId,
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
