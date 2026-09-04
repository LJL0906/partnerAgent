import { Check, Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';
import type {
  ActionExecutionStatus,
  ActionPlanStatus,
  ActionTimelinessStatus,
  GoalStatus,
} from './core.types.js';

@Entity({ name: 'goals' })
@Unique('goals_user_id_id_key', ['userId', 'id'])
@Index(
  'goals_active_status_deadline_idx',
  ['userId', 'goalStatus', 'deadlineAt'],
  {
    where: "goal_status not in ('completed','abandoned','expired')",
  },
)
@Check(
  'goals_status_check',
  "goal_status in ('planning','active','paused','completed','abandoned','expired')",
)
@Check(
  'goals_deadline_observation_check',
  "deadline_observation in ('not_due','due')",
)
export class GoalEntity {
  @PrimaryColumn({ type: 'uuid' }) id: string;
  @Column({ name: 'user_id', type: 'text' }) userId: string;
  @Column({ type: 'text' }) title: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ name: 'goal_status', type: 'text', default: 'planning' })
  goalStatus: GoalStatus;
  @Column({ name: 'deadline_at', type: 'timestamptz', nullable: true })
  deadlineAt: Date | null;
  @Column({ name: 'deadline_observation', type: 'text', default: 'not_due' })
  deadlineObservation: 'not_due' | 'due';
  @Column({ name: 'confirmed_at', type: 'timestamptz' }) confirmedAt: Date;
}

@Entity({ name: 'actions' })
@Unique('actions_user_id_id_key', ['userId', 'id'])
@Index(
  'actions_open_deadline_idx',
  ['userId', 'executionStatus', 'deadlineAt'],
  {
    where: "execution_status not in ('done','cancelled')",
  },
)
@Index('actions_overdue_idx', ['userId', 'deadlineAt'], {
  where: "timeliness_status = 'overdue'",
})
@Check(
  'actions_execution_check',
  "execution_status in ('todo','in_progress','paused','done','cancelled')",
)
@Check('actions_plan_check', "plan_status in ('normal','rescheduled')")
@Check(
  'actions_timeliness_check',
  "timeliness_status in ('no_deadline','not_due','overdue','not_applicable')",
)
@Check(
  'actions_timeliness_deadline_check',
  "deadline_at is not null or timeliness_status in ('no_deadline','not_applicable')",
)
@Check(
  'actions_completed_at_check',
  "execution_status <> 'done' or completed_at is not null",
)
export class ActionEntity {
  @PrimaryColumn({ type: 'uuid' }) id: string;
  @Column({ name: 'user_id', type: 'text' }) userId: string;
  @Column({ type: 'text' }) title: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ name: 'execution_status', type: 'text', default: 'todo' })
  executionStatus: ActionExecutionStatus;
  @Column({ name: 'plan_status', type: 'text', default: 'normal' })
  planStatus: ActionPlanStatus;
  @Column({ name: 'timeliness_status', type: 'text', default: 'no_deadline' })
  timelinessStatus: ActionTimelinessStatus;
  @Column({ name: 'deadline_at', type: 'timestamptz', nullable: true })
  deadlineAt: Date | null;
  @Column({ name: 'planned_at', type: 'timestamptz', nullable: true })
  plannedAt: Date | null;
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}

@Entity({ name: 'goal_action_relations' })
@Index('goal_action_relations_action_idx', ['userId', 'actionId'])
export class GoalActionRelationEntity {
  @PrimaryColumn({ name: 'user_id', type: 'text' }) userId: string;
  @PrimaryColumn({ name: 'goal_id', type: 'uuid' }) goalId: string;
  @PrimaryColumn({ name: 'action_id', type: 'uuid' }) actionId: string;
  @Column({ name: 'relation_type', type: 'text', default: 'supports' })
  relationType: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
