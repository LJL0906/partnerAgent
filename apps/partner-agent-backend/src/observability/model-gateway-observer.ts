import { Injectable } from '@nestjs/common';
import {
  ModelGatewayObserver,
  type ModelGatewayObservation,
} from '../model-gateway/model-gateway-reliability.js';
import {
  ObservabilitySink,
  safelyRecord,
  type ModelObservabilityEvent,
} from './observability.types.js';

@Injectable()
export class ObservabilityModelGatewayObserver extends ModelGatewayObserver {
  constructor(private readonly sink: ObservabilitySink) {
    super();
  }

  record(event: ModelGatewayObservation): void {
    const common = {
      runId: event.runId,
      requestId: event.requestId,
      ownerId: safeText(event.ownerId),
      sessionId: safeText(event.sessionId),
      taskId: optionalSafeText(event.taskId),
      operationId: optionalSafeText(event.operationId),
      source: safeText(event.source),
      provider: safeText(event.provider),
      modelId: safeText(event.modelId),
    };
    let observation: ModelObservabilityEvent;
    switch (event.type) {
      case 'request_started':
        observation = {
          ...common,
          kind: 'model_request_started',
          timeoutMs: event.timeoutMs,
        };
        break;
      case 'egress_decided':
        observation = {
          ...common,
          kind: 'model_egress_decided',
          decision: event.decision,
        };
        break;
      case 'provider_response':
        observation = {
          ...common,
          kind: 'model_first_response',
          durationMs: event.elapsedMs,
          status:
            event.status >= 200 && event.status < 400 ? 'success' : 'error',
        };
        break;
      case 'stream_completed':
        observation = {
          ...common,
          kind: 'model_request_finished',
          durationMs: event.elapsedMs,
          status: 'success',
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          totalTokens: event.totalTokens,
        };
        break;
      case 'stream_failed':
        observation = {
          ...common,
          kind: 'model_request_finished',
          durationMs: event.elapsedMs,
          status: 'error',
          failureCategory: event.failure.category,
          errorCode: event.failure.code,
        };
        break;
    }
    safelyRecord(this.sink, observation);
  }
}

function optionalSafeText(value: string | undefined): string | undefined {
  return value === undefined ? undefined : safeText(value);
}

function safeText(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127 ? '_' : character;
    })
    .join('')
    .slice(0, 128);
}
