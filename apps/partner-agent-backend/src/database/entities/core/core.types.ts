export type CandidateStatus =
  'pending' | 'confirmed' | 'confirmed_after_edit' | 'cancelled' | 'expired';

export type BusinessObjectKind =
  'goal' | 'action' | 'fact' | 'memory' | 'decision' | 'situation' | 'reminder';

export type BusinessObjectAction =
  | 'create'
  | 'update'
  | 'status_change'
  | 'archive'
  | 'soft_delete'
  | 'permanent_delete'
  | 'restore'
  | 'undo';

export type LifecycleStatus = 'active' | 'archived' | 'soft_deleted' | 'purged';

export type GoalStatus =
  'planning' | 'active' | 'paused' | 'completed' | 'abandoned' | 'expired';

export type ActionExecutionStatus =
  'todo' | 'in_progress' | 'paused' | 'done' | 'cancelled';

export type ActionPlanStatus = 'normal' | 'rescheduled';

export type ActionTimelinessStatus =
  'no_deadline' | 'not_due' | 'overdue' | 'not_applicable';
