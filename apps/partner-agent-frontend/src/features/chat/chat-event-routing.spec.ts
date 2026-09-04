import type { ServerPushEventV1 } from '@partner-agent/contracts';
import { describe, expect, it } from 'vitest';

import {
  dispatchApplicationEvent,
  type ApplicationEvent,
  PENDING_CHAT_TASK_ID,
  routeAgentEvent,
  subscribeApplicationEvents,
} from './chat-event-routing';

const context = {
  sessionId: 'session-1',
  currentTaskId: 'chat-task-1',
  activeOperationId: 'chat-operation-1',
};

describe('chat event routing', () => {
  it('routes owner-scoped candidate events independently of the current chat task', () => {
    const received: ApplicationEvent[] = [];
    const unsubscribe = subscribeApplicationEvents((receivedEvent) => received.push(receivedEvent));
    const candidate = event('candidate', 'user:self', 'analysis-task-1', 'session-2');
    expect(
      routeAgentEvent(candidate, context),
    ).toBe('application');
    dispatchApplicationEvent(candidate);
    unsubscribe();
    expect(received).toEqual([candidate]);
  });

  it('does not apply another chat task or session event to the current chat store', () => {
    expect(routeAgentEvent(event('done', 'user:self', 'chat-task-2', 'session-1'), context)).toBe(
      'ignore',
    );
    expect(
      routeAgentEvent(event('done', 'session:session-2', 'chat-task-1', 'session-2'), context),
    ).toBe('ignore');
  });

  it('accepts a pending task event only when it belongs to the submitted operation', () => {
    const pendingContext = {
      sessionId: 'session-1',
      currentTaskId: PENDING_CHAT_TASK_ID,
      previousTaskId: 'old-task',
      pendingOperationId: 'new-operation',
    };
    expect(
      routeAgentEvent(
        { ...event('done', 'user:self', 'new-task', 'session-1'), operation_id: 'new-operation' },
        pendingContext,
      ),
    ).toBe('chat');
    expect(
      routeAgentEvent(
        { ...event('done', 'user:self', 'other-task', 'session-1'), operation_id: 'other-operation' },
        pendingContext,
      ),
    ).toBe('ignore');
  });
});

function event(
  eventType: 'candidate' | 'done',
  channel: ServerPushEventV1['channel'],
  taskId: string,
  sessionId: string,
): ServerPushEventV1 {
  if (eventType === 'candidate') {
    return {
      schema_version: 1,
      event_id: 'candidate-event',
      channel,
      sequence: 1,
      session_id: sessionId,
      operation_id: 'analysis-operation-1',
      task_id: taskId,
      event_type: 'candidate',
      timestamp: 1,
      data: {
        analysis_ref: { kind: 'analysis_run', id: 'analysis-1' },
        batch_ref: { kind: 'confirmation_batch', id: 'batch-1' },
        candidate_refs: [{ kind: 'candidate', id: 'candidate-1' }],
        task_ref: {
          task_id: taskId,
          kind: 'analysis',
          analysis_run_id: 'analysis-1',
          analysis_types: ['action'],
        },
        candidate_count: 1,
        risk_level: 'normal',
        safe_summary: '发现 1 条行动候选',
        occurred_at: 1,
      },
    };
  }
  return {
    schema_version: 1,
    event_id: `done-${taskId}-${sessionId}`,
    channel,
    sequence: 1,
    session_id: sessionId,
    operation_id: 'chat-operation-1',
    task_id: taskId,
    event_type: 'done',
    timestamp: 1,
    data: {},
  };
}
