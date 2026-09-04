import { Injectable } from '@nestjs/common';
import {
  ObservabilitySink,
  type ObservabilityEvent,
} from './observability.types.js';

type MetricKind = 'counter' | 'gauge' | 'histogram';
type Labels = Readonly<Record<string, string>>;

interface MetricDefinition {
  name: string;
  help: string;
  kind: MetricKind;
  labelNames: readonly string[];
  buckets?: readonly number[];
}

interface MetricSample {
  labels: Labels;
  value: number;
  count: number;
  sum: number;
  buckets: number[];
}

const DURATION_BUCKETS = [
  5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000,
] as const;

const ALLOWED_LABEL_VALUES: Readonly<Record<string, readonly string[]>> = {
  reason: [
    'completed',
    'failed',
    'cancelled',
    'waiting_tool_approval',
    'waiting_privacy_decision',
  ],
  status: ['success', 'error', 'succeeded', 'failed'],
  failure_category: [
    'none',
    'timeout',
    'cancelled',
    'rate_limited',
    'authentication',
    'invalid_request',
    'unavailable',
    'unknown',
  ],
  result: ['claimed', 'empty', 'error', 'completed', 'partial', 'failed'],
  operation: ['renew', 'finish', 'wait'],
};

const DEFINITIONS = {
  runs: definition(
    'partner_agent_runs_total',
    'Finished Agent runs.',
    'counter',
    ['reason'],
  ),
  firstToken: definition(
    'partner_agent_first_token_duration_ms',
    'Agent time to first text token.',
    'histogram',
    [],
    DURATION_BUCKETS,
  ),
  modelRequests: definition(
    'partner_agent_model_requests_total',
    'Finished model requests.',
    'counter',
    ['status', 'failure_category'],
  ),
  modelDuration: definition(
    'partner_agent_model_request_duration_ms',
    'Model request duration.',
    'histogram',
    ['status', 'failure_category'],
    DURATION_BUCKETS,
  ),
  modelFirstResponse: definition(
    'partner_agent_model_first_response_duration_ms',
    'Model provider first response duration.',
    'histogram',
    ['status'],
    DURATION_BUCKETS,
  ),
  toolCalls: definition(
    'partner_agent_tool_calls_total',
    'Finished tool calls.',
    'counter',
    ['status'],
  ),
  toolDuration: definition(
    'partner_agent_tool_call_duration_ms',
    'Tool call duration.',
    'histogram',
    ['status'],
    DURATION_BUCKETS,
  ),
  queueDepth: definition(
    'partner_agent_chat_task_queue_depth',
    'Runnable ChatTask queue depth.',
    'gauge',
    [],
  ),
  claims: definition(
    'partner_agent_chat_task_claims_total',
    'ChatTask claim attempts.',
    'counter',
    ['result'],
  ),
  leaseExpiry: definition(
    'partner_agent_chat_task_lease_expiries_total',
    'Recovered expired ChatTask leases.',
    'counter',
    [],
  ),
  fenceReject: definition(
    'partner_agent_chat_task_fence_rejects_total',
    'Rejected stale-fence writes.',
    'counter',
    ['operation'],
  ),
  listenReconnect: definition(
    'partner_agent_listen_reconnects_total',
    'PostgreSQL LISTEN reconnects.',
    'counter',
    [],
  ),
  replay: definition(
    'partner_agent_ws_replayed_events_total',
    'WS events delivered by replay.',
    'counter',
    [],
  ),
  catchUp: definition(
    'partner_agent_ws_catch_up_total',
    'WS catch-up attempts.',
    'counter',
    ['result'],
  ),
  catchUpEvents: definition(
    'partner_agent_ws_catch_up_events_total',
    'WS events delivered by catch-up.',
    'counter',
    ['result'],
  ),
  recovery: definition(
    'partner_agent_ws_recovery_required_total',
    'WS recovery-required signals.',
    'counter',
    [],
  ),
  retryAvailable: definition(
    'partner_agent_model_retry_observability_available',
    'Whether reliable provider-attempt hooks are available.',
    'gauge',
    [],
  ),
} as const;

/** Minimal process-local Prometheus registry; no network endpoint is opened here. */
export class PrometheusRegistry {
  private readonly samples = new Map<string, MetricSample>();

  constructor() {
    this.set(DEFINITIONS.retryAvailable, 0);
  }

  increment(
    definition: MetricDefinition,
    labels: Labels = {},
    value = 1,
  ): void {
    assertFiniteNonNegative(value);
    const sample = this.sample(definition, labels);
    sample.value += value;
  }

  set(definition: MetricDefinition, value: number, labels: Labels = {}): void {
    assertFiniteNonNegative(value);
    this.sample(definition, labels).value = value;
  }

  observe(
    definition: MetricDefinition,
    value: number,
    labels: Labels = {},
  ): void {
    assertFiniteNonNegative(value);
    const sample = this.sample(definition, labels);
    sample.count += 1;
    sample.sum += value;
    definition.buckets?.forEach((limit, index) => {
      if (value <= limit) sample.buckets[index] += 1;
    });
  }

  render(): string {
    const lines: string[] = [];
    for (const definition of Object.values(DEFINITIONS)) {
      lines.push(`# HELP ${definition.name} ${definition.help}`);
      lines.push(`# TYPE ${definition.name} ${definition.kind}`);
      const samples = [...this.samples.entries()].filter(([key]) =>
        key.startsWith(`${definition.name}\u0000`),
      );
      for (const [, sample] of samples) {
        if (definition.kind !== 'histogram') {
          lines.push(
            `${definition.name}${formatLabels(sample.labels)} ${sample.value}`,
          );
          continue;
        }
        definition.buckets?.forEach((limit, index) => {
          lines.push(
            `${definition.name}_bucket${formatLabels({ ...sample.labels, le: String(limit) })} ${sample.buckets[index]}`,
          );
        });
        lines.push(
          `${definition.name}_bucket${formatLabels({ ...sample.labels, le: '+Inf' })} ${sample.count}`,
        );
        lines.push(
          `${definition.name}_sum${formatLabels(sample.labels)} ${sample.sum}`,
        );
        lines.push(
          `${definition.name}_count${formatLabels(sample.labels)} ${sample.count}`,
        );
      }
    }
    return `${lines.join('\n')}\n`;
  }

  private sample(definition: MetricDefinition, labels: Labels): MetricSample {
    assertLabels(definition, labels);
    const normalized = Object.fromEntries(
      definition.labelNames.map((name) => [name, labels[name]]),
    );
    const key = `${definition.name}\u0000${JSON.stringify(normalized)}`;
    let sample = this.samples.get(key);
    if (!sample) {
      sample = {
        labels: normalized,
        value: 0,
        count: 0,
        sum: 0,
        buckets: definition.buckets?.map(() => 0) ?? [],
      };
      this.samples.set(key, sample);
    }
    return sample;
  }
}

@Injectable()
export class PrometheusMetricsSink extends ObservabilitySink {
  constructor(readonly registry = new PrometheusRegistry()) {
    super();
  }

  record(event: Readonly<ObservabilityEvent>): void {
    switch (event.kind) {
      case 'agent_run_finished':
        return this.registry.increment(DEFINITIONS.runs, {
          reason: event.reason,
        });
      case 'agent_first_token':
        return this.registry.observe(DEFINITIONS.firstToken, event.elapsedMs);
      case 'agent_tool_finished': {
        this.registry.increment(DEFINITIONS.toolCalls, {
          status: event.status,
        });
        if (event.durationMs !== undefined)
          this.registry.observe(DEFINITIONS.toolDuration, event.durationMs, {
            status: event.status,
          });
        return;
      }
      case 'model_first_response':
        return this.registry.observe(
          DEFINITIONS.modelFirstResponse,
          event.durationMs,
          { status: event.status },
        );
      case 'model_request_finished': {
        const labels = {
          status: event.status,
          failure_category: event.failureCategory ?? 'none',
        };
        this.registry.increment(DEFINITIONS.modelRequests, labels);
        this.registry.observe(
          DEFINITIONS.modelDuration,
          event.durationMs,
          labels,
        );
        return;
      }
      case 'chat_task_queue_depth':
        return this.registry.set(DEFINITIONS.queueDepth, event.depth);
      case 'chat_task_claim':
        return this.registry.increment(DEFINITIONS.claims, {
          result: event.result,
        });
      case 'chat_task_lease_expired':
        return this.registry.increment(
          DEFINITIONS.leaseExpiry,
          {},
          event.count,
        );
      case 'chat_task_fence_rejected':
        return this.registry.increment(DEFINITIONS.fenceReject, {
          operation: event.operation,
        });
      case 'listen_reconnect':
        return this.registry.increment(DEFINITIONS.listenReconnect);
      case 'ws_replay':
        return this.registry.increment(DEFINITIONS.replay, {}, event.count);
      case 'ws_catch_up':
        this.registry.increment(DEFINITIONS.catchUp, { result: event.result });
        return this.registry.increment(
          DEFINITIONS.catchUpEvents,
          { result: event.result },
          event.count,
        );
      case 'ws_recovery_required':
        return this.registry.increment(DEFINITIONS.recovery);
      default:
        return;
    }
  }
}

@Injectable()
export class PrometheusMetricsExporter {
  constructor(private readonly sink: PrometheusMetricsSink) {}

  render(): string {
    return this.sink.registry.render();
  }
}

function definition(
  name: string,
  help: string,
  kind: MetricKind,
  labelNames: readonly string[],
  buckets?: readonly number[],
): MetricDefinition {
  return { name, help, kind, labelNames, buckets };
}

function assertLabels(definition: MetricDefinition, labels: Labels): void {
  const names = Object.keys(labels).sort();
  const expected = [...definition.labelNames].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`${definition.name} labels 不符合固定 schema`);
  }
  for (const value of Object.values(labels)) {
    if (!/^[a-z0-9_]{1,64}$/u.test(value)) {
      throw new Error(`${definition.name} label 值不是低基数枚举`);
    }
  }
  for (const [name, value] of Object.entries(labels)) {
    if (!ALLOWED_LABEL_VALUES[name]?.includes(value)) {
      throw new Error(`${definition.name} label 值不在固定枚举中`);
    }
  }
}

function assertFiniteNonNegative(value: number): void {
  if (!Number.isFinite(value) || value < 0)
    throw new Error('指标值必须是非负有限数');
}

function formatLabels(labels: Labels): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return `{${entries.map(([name, value]) => `${name}="${value}"`).join(',')}}`;
}
