import { DataSource } from 'typeorm';
import { CORE_ENTITIES } from './core-entities.js';
import { ChatSessionEntity } from './entities/chat-session.entity.js';
import { SessionMessageEntity } from './entities/session-message.entity.js';
import { ToolAuditEntity } from './entities/tool-audit.entity.js';
import { ToolConfirmationEntity } from './entities/tool-confirmation.entity.js';
import { ToolExecutionReceiptEntity } from './entities/tool-execution-receipt.entity.js';
import { ToolReconciliationAuditEntity } from './entities/tool-reconciliation-audit.entity.js';
import { ChatTaskLifecycleOutboxEntity } from './entities/chat-task-outbox.entity.js';
import { AgentRunTraceEntity } from './entities/agent-run-trace.entity.js';
import { ToolControlOutboxEntity } from './entities/tool-control-outbox.entity.js';
import { OutboxRemediationAuditEntity } from './entities/outbox-remediation-audit.entity.js';
import { CreateSessionTables1788498000000 } from './migrations/1788498000000-create-session-tables.js';
import { CreateToolConfirmationTables1788499000000 } from './migrations/1788499000000-create-tool-confirmation-tables.js';
import { CreateLocalCoreSchema1788500000000 } from './migrations/1788500000000-create-local-core-schema.js';
import { CreateChatTaskTables1788501000000 } from './migrations/1788501000000-create-chat-task-tables.js';
import { CreateEgressAuditLogs1788502000000 } from './migrations/1788502000000-create-egress-audit-logs.js';
import { CreateEgressDecisionRequests1788503000000 } from './migrations/1788503000000-create-egress-decision-requests.js';
import { StrengthenEgressAuditLogs1788504000000 } from './migrations/1788504000000-strengthen-egress-audit-logs.js';
import { CreateAnalysisTables1788505000000 } from './migrations/1788505000000-create-analysis-tables.js';
import { AddChatTaskLeases1788506000000 } from './migrations/1788506000000-add-chat-task-leases.js';
import { CreateWsV1Events1788507000000 } from './migrations/1788507000000-create-ws-v1-events.js';
import { AddWsV1RetentionIndex1788508000000 } from './migrations/1788508000000-add-ws-v1-retention-index.js';
import { CreateChatTaskOutbox1788509000000 } from './migrations/1788509000000-create-chat-task-outbox.js';
import { CreateAgentRunTraces1788511000000 } from './migrations/1788511000000-create-agent-run-traces.js';
import { AddToolReconciliation1788512000000 } from './migrations/1788512000000-add-tool-reconciliation.js';
import { AddToolControlOutboxRemediation1788513000000 } from './migrations/1788513000000-add-tool-control-outbox-remediation.js';
import { WsV1EventEntity } from './entities/ws-v1-event.entity.js';

export const DATABASE_ENTITIES = [
  ChatSessionEntity,
  SessionMessageEntity,
  ToolConfirmationEntity,
  ToolAuditEntity,
  ToolExecutionReceiptEntity,
  ToolReconciliationAuditEntity,
  WsV1EventEntity,
  ChatTaskLifecycleOutboxEntity,
  AgentRunTraceEntity,
  ToolControlOutboxEntity,
  OutboxRemediationAuditEntity,
  ...CORE_ENTITIES,
] as const;

export const DATABASE_MIGRATIONS = [
  CreateSessionTables1788498000000,
  CreateToolConfirmationTables1788499000000,
  CreateLocalCoreSchema1788500000000,
  CreateChatTaskTables1788501000000,
  CreateEgressAuditLogs1788502000000,
  CreateEgressDecisionRequests1788503000000,
  StrengthenEgressAuditLogs1788504000000,
  CreateAnalysisTables1788505000000,
  AddChatTaskLeases1788506000000,
  CreateWsV1Events1788507000000,
  AddWsV1RetentionIndex1788508000000,
  CreateChatTaskOutbox1788509000000,
  CreateAgentRunTraces1788511000000,
  AddToolReconciliation1788512000000,
  AddToolControlOutboxRemediation1788513000000,
] as const;

export function createDatabaseDataSource(url: string): DataSource {
  return new DataSource({
    type: 'postgres',
    url,
    entities: [...DATABASE_ENTITIES],
    migrations: [...DATABASE_MIGRATIONS],
    synchronize: false,
  });
}
