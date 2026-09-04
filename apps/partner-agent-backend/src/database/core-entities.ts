import { BusinessObjectEntity } from './entities/core/business-object.entity.js';
import {
  CandidateItemEntity,
  ConfirmationActionEntity,
  ConfirmationBatchEntity,
} from './entities/core/confirmation.entity.js';
import {
  ActionEntity,
  GoalActionRelationEntity,
  GoalEntity,
} from './entities/core/goal-action.entity.js';
import {
  FormalObjectDetailEntity,
  ObjectIndexJobEntity,
  ObjectVersionEntity,
  SourceRelationEntity,
} from './entities/core/object-history.entity.js';
import { UserEntity } from './entities/core/user.entity.js';
import { CHAT_TASK_ENTITIES } from './entities/chat-task.entity.js';
import { EgressAuditEntity } from './entities/egress-audit.entity.js';
import { EgressDecisionRequestEntity } from './entities/egress-decision-request.entity.js';

export * from './entities/core/core.types.js';
export * from './entities/core/user.entity.js';
export * from './entities/core/confirmation.entity.js';
export * from './entities/core/business-object.entity.js';
export * from './entities/core/goal-action.entity.js';
export * from './entities/core/object-history.entity.js';

/** 生产 DataSource 与测试共用的 Local Core 实体清单。 */
export const CORE_ENTITIES = [
  UserEntity,
  ConfirmationBatchEntity,
  CandidateItemEntity,
  ConfirmationActionEntity,
  BusinessObjectEntity,
  GoalEntity,
  ActionEntity,
  FormalObjectDetailEntity,
  GoalActionRelationEntity,
  ObjectVersionEntity,
  SourceRelationEntity,
  ObjectIndexJobEntity,
  ...CHAT_TASK_ENTITIES,
  EgressAuditEntity,
  EgressDecisionRequestEntity,
] as const;
