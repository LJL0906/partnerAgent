import type { CommandEnvelope } from '@partner-agent/contracts';
import * as Crypto from 'expo-crypto';

export interface CreateCommandEnvelopeOptions {
  operationId?: string;
  expectedVersion?: string;
}

export async function createCommandEnvelope<TPayload>(
  payload: TPayload,
  options: CreateCommandEnvelopeOptions = {},
): Promise<CommandEnvelope<TPayload>> {
  const requestFingerprint = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(payload),
  );

  return {
    operation_id: options.operationId ?? createOperationId(),
    client_source: getClientSource(),
    request_fingerprint: requestFingerprint,
    ...(options.expectedVersion ? { expected_version: options.expectedVersion } : {}),
    payload,
  };
}

export function createOperationId(): string {
  return Crypto.randomUUID();
}

export function getClientSource(): CommandEnvelope['client_source'] {
  const os = process.env.EXPO_OS;
  if (os === 'ios' || os === 'android' || os === 'web') return os;
  return 'other';
}
