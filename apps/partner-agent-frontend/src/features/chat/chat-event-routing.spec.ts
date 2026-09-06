import type { CandidateEventV1, ServerPushEventV1 } from '@partner-agent/contracts';
import { describe, expect, it } from 'vitest';

import {
  mapServerPushEventToChatItems, PENDING_CHAT_TASK_ID, routeAgentEvent,
} from './chat-event-routing';

const operationId = '11111111-1111-4111-8111-111111111111';
const context = { sessionId: 'session-1', currentTaskId: 'chat-task-1', activeOperationId: operationId };

function candidate(channel: ServerPushEventV1['channel'], taskId: string, sessionId: string): CandidateEventV1 {
  return {
    schema_version: 1, event_id: 'candidate-event', channel, sequence: 1,
    session_id: sessionId, operation_id: operationId, task_id: taskId,
    event_type: 'candidate', timestamp: 1, item_id: 'candidate:candidate-1', item_revision: 1,
    data: { analysis_ref: { kind: 'analysis_run', id: 'analysis-1' },
      batch_ref: { kind: 'confirmation_batch', id: 'batch-1' },
      candidate_refs: [{ kind: 'candidate', id: 'candidate-1' }],
      task_ref: { task_id: taskId, kind: 'analysis', analysis_run_id: 'analysis-1', analysis_types: ['action'] },
      candidate_count: 1, risk_level: 'normal', safe_summary: '候选摘要', occurred_at: 1 },
  };
}

function done(taskId: string, sessionId: string): ServerPushEventV1 {
  return { schema_version: 1, event_id: `done-${taskId}`, channel: 'user:self', sequence: 1,
    session_id: sessionId, operation_id: operationId, task_id: taskId,
    event_type: 'done', timestamp: 1, data: {} };
}

describe('chat event routing', () => {
  it('keeps candidates in their matching chat timeline', () => {
    expect(routeAgentEvent(candidate('task:chat-task-1', 'chat-task-1', 'session-1'), context)).toBe('chat');
    expect(routeAgentEvent(candidate('user:self', 'analysis-task-1', 'session-2'), context)).toBe('ignore');
  });

  it('projects a formal candidate with the canonical identity', () => {
    expect(mapServerPushEventToChatItems(candidate(
      'task:chat-task-1', 'chat-task-1', 'session-1',
    ))).toEqual([
      expect.objectContaining({
        id: 'candidate:candidate-1',
        type: 'candidate',
        task_id: 'chat-task-1',
        candidate_id: 'candidate-1',
      }),
    ]);
  });

  it('isolates sessions and accepts a pending task only for its operation', () => {
    expect(routeAgentEvent(done('chat-task-1', 'session-2'), context)).toBe('ignore');
    const pending = { sessionId: 'session-1', currentTaskId: PENDING_CHAT_TASK_ID,
      previousTaskId: 'old-task', pendingOperationId: operationId };
    expect(routeAgentEvent(done('new-task', 'session-1'), pending)).toBe('chat');
    expect(routeAgentEvent({ ...done('other-task', 'session-1'),
      operation_id: '22222222-2222-4222-8222-222222222222' }, pending)).toBe('ignore');
  });

  it('accepts a new authoritative session only for the pending owner-scoped operation', () => {
    const pending = { sessionId: 'local-session', sessionPersisted: false,
      currentTaskId: PENDING_CHAT_TASK_ID, pendingOperationId: operationId };
    expect(routeAgentEvent(done('new-task', 'server-session'), pending)).toBe('chat');
    expect(routeAgentEvent({ ...done('new-task', 'server-session'),
      operation_id: '22222222-2222-4222-8222-222222222222' }, pending)).toBe('ignore');
    expect(routeAgentEvent(done('new-task', 'server-session'),
      { ...pending, sessionPersisted: true })).toBe('ignore');
  });

  it('uses the shared item identity, revision, and task status mapping', () => {
    const event: ServerPushEventV1 = { schema_version: 1, event_id: 'state', channel: 'task:task-1',
      sequence: 1, session_id: 'session-1', operation_id: operationId, task_id: 'task-1',
      event_type: 'task_state', timestamp: 1, item_id: 'task:task-1:runtime', item_revision: 2,
      data: { state: 'waiting_tool_approval' } };
    expect(mapServerPushEventToChatItems(event)).toEqual([
      expect.objectContaining({ id: 'task:task-1:runtime', revision: 2, status: 'pending',
        payload: { state: 'waiting_tool_approval', detail: undefined } }),
    ]);
  });

  it('does not invent items for control-only completion events', () => {
    expect(mapServerPushEventToChatItems(done('task-1', 'session-1'))).toEqual([]);
  });
});
