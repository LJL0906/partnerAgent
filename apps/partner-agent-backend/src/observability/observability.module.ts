import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { SessionStore } from '../database/session-store.js';
import { TypeOrmSessionStore } from '../database/typeorm-session.store.js';
import { ModelGatewayObserver } from '../model-gateway/model-gateway-reliability.js';
import {
  AgentRunTraceStore,
  MemoryAgentRunTraceStore,
} from './agent-run-trace.store.js';
import {
  AgentRunTraceQueryService,
  AgentRunTraceRetentionWorker,
  AgentRunTraceSink,
} from './agent-run-trace.service.js';
import { ObservabilityModelGatewayObserver } from './model-gateway-observer.js';
import {
  CompositeObservabilitySink,
  ObservabilitySink,
} from './observability.types.js';
import {
  PrometheusMetricsExporter,
  PrometheusMetricsSink,
} from './prometheus-metrics.js';
import { TypeOrmAgentRunTraceStore } from './typeorm-agent-run-trace.store.js';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: AgentRunTraceStore,
      inject: [SessionStore],
      useFactory: (sessionStore: SessionStore): AgentRunTraceStore =>
        sessionStore instanceof TypeOrmSessionStore
          ? new TypeOrmAgentRunTraceStore(sessionStore.getDataSource())
          : new MemoryAgentRunTraceStore(),
    },
    {
      provide: PrometheusMetricsSink,
      useFactory: (): PrometheusMetricsSink => new PrometheusMetricsSink(),
    },
    AgentRunTraceSink,
    AgentRunTraceRetentionWorker,
    {
      provide: ObservabilitySink,
      inject: [PrometheusMetricsSink, AgentRunTraceSink],
      useFactory: (
        metrics: PrometheusMetricsSink,
        traces: AgentRunTraceSink,
      ): ObservabilitySink => new CompositeObservabilitySink([metrics, traces]),
    },
    PrometheusMetricsExporter,
    AgentRunTraceQueryService,
    ObservabilityModelGatewayObserver,
    {
      provide: ModelGatewayObserver,
      useExisting: ObservabilityModelGatewayObserver,
    },
  ],
  exports: [
    ObservabilitySink,
    ModelGatewayObserver,
    PrometheusMetricsExporter,
    AgentRunTraceQueryService,
  ],
})
export class ObservabilityModule {}
