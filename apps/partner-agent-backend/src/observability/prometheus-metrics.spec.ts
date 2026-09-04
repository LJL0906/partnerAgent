import { describe, expect, it } from 'vitest';
import {
  PrometheusMetricsExporter,
  PrometheusMetricsSink,
  PrometheusRegistry,
} from './prometheus-metrics.js';

describe('PrometheusMetricsSink', () => {
  it('exports counters, timings and an explicit unavailable retry hook', () => {
    const sink = new PrometheusMetricsSink(new PrometheusRegistry());
    sink.record({
      kind: 'agent_run_finished',
      runId: 'run-a',
      ownerId: 'owner-a',
      sessionId: 'session-a',
      source: 'test',
      at: 1,
      elapsedMs: 125,
      reason: 'completed',
      modelTurnsStarted: 1,
      toolCallsStarted: 0,
      outputTokensUsed: 12,
    });
    sink.record({
      kind: 'model_request_finished',
      runId: 'run-a',
      requestId: 'request-a',
      ownerId: 'owner-a',
      sessionId: 'session-a',
      source: 'test',
      provider: 'provider-with-high-cardinality-name',
      modelId: 'model-with-high-cardinality-id',
      durationMs: 25,
      status: 'error',
      failureCategory: 'timeout',
      errorCode: 'MODEL_TIMEOUT',
    });
    sink.record({
      kind: 'agent_tool_finished',
      runId: 'run-a',
      ownerId: 'owner-a',
      sessionId: 'session-a',
      source: 'test',
      at: 1,
      elapsedMs: 20,
      toolCallId: 'call-a',
      toolName: 'private-tool-name',
      status: 'succeeded',
      durationMs: 20,
    });

    const output = new PrometheusMetricsExporter(sink).render();
    expect(output).toContain('partner_agent_runs_total{reason="completed"} 1');
    expect(output).toContain(
      'partner_agent_model_requests_total{status="error",failure_category="timeout"} 1',
    );
    expect(output).toContain(
      'partner_agent_model_retry_observability_available 0',
    );
    expect(output).not.toContain('owner-a');
    expect(output).not.toContain('session-a');
    expect(output).not.toContain('private-tool-name');
    expect(output).not.toContain('provider-with-high-cardinality-name');
    expect(output).not.toContain('model-with-high-cardinality-id');
  });

  it('rejects arbitrary labels at the registry boundary', () => {
    const registry = new PrometheusRegistry();
    expect(() =>
      registry.increment(
        {
          name: 'unsafe_metric_total',
          help: 'test',
          kind: 'counter',
          labelNames: ['owner_id'],
        },
        { owner_id: 'owner/a' },
      ),
    ).toThrow('低基数枚举');
    expect(() =>
      registry.increment(
        {
          name: 'unsafe_metric_total',
          help: 'test',
          kind: 'counter',
          labelNames: ['status'],
        },
        { status: 'owner_a' },
      ),
    ).toThrow('固定枚举');
  });
});
