import type { AgentEvent } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';
import { mapPiAgentEvent } from './pi-agent-events.js';

const options = {
  isApprovalRequired: () => false,
  riskLevelFor: () => 'read_only' as const,
  markFailed: vi.fn(),
};

describe('task todo agent events', () => {
  it('hides the internal tool start and maps its result to a todo update', () => {
    const start = { type: 'tool_execution_start', toolName: 'update_task_todo', toolCallId: 'call-1' } as AgentEvent;
    const end = { type: 'tool_execution_end', toolName: 'update_task_todo', toolCallId: 'call-1', isError: false,
      result: { details: { status: 'todo_updated', items: [
        { id: 'step-1', content: '分析', status: 'in_progress' },
        { id: 'step-2', content: '验证', status: 'pending' },
      ] } } } as unknown as AgentEvent;

    expect(mapPiAgentEvent(start, options)).toBeUndefined();
    expect(mapPiAgentEvent(end, options)).toMatchObject({
      type: 'todo_update',
      data: { items: expect.arrayContaining([expect.objectContaining({ id: 'step-1' })]) },
    });
  });
});
