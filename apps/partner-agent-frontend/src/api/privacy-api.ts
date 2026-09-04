import type {
  CommandEnvelope,
  CommandResult,
  SubmitPrivacyDecisionPayload,
} from '@partner-agent/contracts';

import { createCommandEnvelope } from './command-envelope';
import { apiConfig } from './config';
import { postJson, type RequestOptions } from './http-client';

export type PrivacyDecision = SubmitPrivacyDecisionPayload['decision'];

export interface SubmitPrivacyDecisionParams extends RequestOptions {
  egressId: string;
  decision: PrivacyDecision;
  operationId?: string;
}

export async function submitPrivacyDecision(
  params: SubmitPrivacyDecisionParams,
): Promise<CommandResult> {
  const payload: SubmitPrivacyDecisionPayload = {
    egress_id: params.egressId,
    decision: params.decision,
  };
  const envelope = await createCommandEnvelope(payload, {
    operationId: params.operationId,
  });

  return postJson<CommandEnvelope<SubmitPrivacyDecisionPayload>, CommandResult>(
    apiConfig.submitPrivacyDecisionPath,
    envelope,
    { signal: params.signal },
  );
}
