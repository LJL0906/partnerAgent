import { describe, expect, it } from 'vitest';
import { ObservabilityModelGatewayObserver } from './model-gateway-observer.js';
import {
  InMemoryObservabilitySink,
  ObservabilitySink,
} from './observability.types.js';

const common = {
  runId: '00000000-0000-4000-8000-000000000001',
  requestId: '00000000-0000-4000-8000-000000000002',
  ownerId: 'owner-a',
  sessionId: 'session-a',
  taskId: 'task-a',
  operationId: 'operation-a',
  source: 'test',
  provider: 'deepseek',
  modelId: 'model-a',
};

describe('ObservabilityModelGatewayObserver', () => {
  it('keeps the explicit Agent run id across model request observations', () => {
    const sink = new InMemoryObservabilitySink();
    const observer = new ObservabilityModelGatewayObserver(sink);
    observer.record({
      ...common,
      type: 'request_started',
      timeoutMs: 1_000,
      maxRetries: 1,
      maxRetryDelayMs: 100,
    });
    observer.record({
      ...common,
      type: 'stream_completed',
      elapsedMs: 25,
      inputTokens: 5,
      outputTokens: 7,
      totalTokens: 12,
    });

    expect(sink.events).toEqual([
      expect.objectContaining({
        kind: 'model_request_started',
        runId: common.runId,
        requestId: common.requestId,
      }),
      expect.objectContaining({
        kind: 'model_request_finished',
        runId: common.runId,
        status: 'success',
        totalTokens: 12,
      }),
    ]);
  });

  it('does not expose raw provider errors and isolates sink failures', () => {
    const observer = new ObservabilityModelGatewayObserver({
      record() {
        throw new Error('sink unavailable with raw payload');
      },
    } as ObservabilitySink);
    expect(() =>
      observer.record({
        ...common,
        type: 'stream_failed',
        elapsedMs: 20,
        failure: {
          category: 'timeout',
          code: 'MODEL_TIMEOUT',
          transient: true,
        },
      }),
    ).not.toThrow();
  });
});
