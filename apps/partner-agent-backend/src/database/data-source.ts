import 'dotenv/config';
import { DataSource } from 'typeorm';
import { ChatSessionEntity } from './entities/chat-session.entity.js';
import { SessionMessageEntity } from './entities/session-message.entity.js';
import { CreateSessionTables1788498000000 } from './migrations/1788498000000-create-session-tables.js';
import { ToolConfirmationEntity } from './entities/tool-confirmation.entity.js';
import { ToolAuditEntity } from './entities/tool-audit.entity.js';
import { ToolExecutionReceiptEntity } from './entities/tool-execution-receipt.entity.js';
import { CreateToolConfirmationTables1788499000000 } from './migrations/1788499000000-create-tool-confirmation-tables.js';
import { CORE_ENTITIES } from './core-entities.js';
import { CreateLocalCoreSchema1788500000000 } from './migrations/1788500000000-create-local-core-schema.js';
import { CreateChatTaskTables1788501000000 } from './migrations/1788501000000-create-chat-task-tables.js';
import { CreateEgressAuditLogs1788502000000 } from './migrations/1788502000000-create-egress-audit-logs.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL 未配置');

export default new DataSource({
  type: 'postgres',
  url,
  entities: [
    ChatSessionEntity,
    SessionMessageEntity,
    ToolConfirmationEntity,
    ToolAuditEntity,
    ToolExecutionReceiptEntity,
    ...CORE_ENTITIES,
  ],
  migrations: [
    CreateSessionTables1788498000000,
    CreateToolConfirmationTables1788499000000,
    CreateLocalCoreSchema1788500000000,
    CreateChatTaskTables1788501000000,
    CreateEgressAuditLogs1788502000000,
  ],
  synchronize: false,
});
