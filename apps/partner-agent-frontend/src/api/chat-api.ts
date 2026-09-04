import type {
  CommandEnvelope,
  CommandResult,
  ChatSessionSummary,
  SubmitTextInputPayload,
  SubmitTextInputResult,
  TaskStatus,
} from '@partner-agent/contracts';
import * as Crypto from 'expo-crypto';

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
  const inputId = Crypto.randomUUID();
  const operationId = Crypto.randomUUID();
  const payload: SubmitTextInputPayload = {
    text: params.text,
    session_id: params.sessionId,
    request_analysis: params.requestAnalysis ?? false,
    analysis_types: params.analysisTypes,
    input_id: inputId,
  };
  const envelope = await createCommandEnvelope(payload, operationId);

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
  const operationId = Crypto.randomUUID();
  const payload: CancelTaskPayload = { task_id: taskId };
  const envelope = await createCommandEnvelope(payload, operationId);
  return postJson<CommandEnvelope<CancelTaskPayload>, CommandResult>(
    apiConfig.cancelTaskPath,
    envelope,
    options,
  );
}

async function createCommandEnvelope<TPayload>(
  payload: TPayload,
  operationId: string,
): Promise<CommandEnvelope<TPayload>> {
  const requestFingerprint = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(payload),
  );

  return {
    operation_id: operationId,
    client_source: getClientSource(),
    request_fingerprint: requestFingerprint,
    payload,
  };
}

function getClientSource(): CommandEnvelope['client_source'] {
  const os = process.env.EXPO_OS;
  if (os === 'ios' || os === 'android' || os === 'web') return os;
  return 'other';
}
