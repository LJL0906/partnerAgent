import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Static } from 'typebox';

const statusSchema = Type.Union([
  Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed'),
]);

export const updateTaskTodoParameters = Type.Object({
  items: Type.Array(Type.Object({
    id: Type.String({ minLength: 1, maxLength: 64 }),
    content: Type.String({ minLength: 1, maxLength: 160 }),
    status: statusSchema,
  }, { additionalProperties: false }), { minItems: 2, maxItems: 8 }),
}, { additionalProperties: false });

type Params = Static<typeof updateTaskTodoParameters>;
type Details = { status: 'todo_updated'; items: Params['items'] };

export function createUpdateTaskTodoTool(): AgentTool<typeof updateTaskTodoParameters, Details> {
  return {
    name: 'update_task_todo',
    label: '更新任务待办',
    description: '仅用于复杂任务：提交完整的 2 到 8 项临时待办快照。每次进度变化都提交全部条目，最多一个 in_progress；简单问答不要调用。',
    parameters: updateTaskTodoParameters,
    executionMode: 'sequential',
    prepareArguments: (raw) => {
      const params = raw as Params;
      const ids = params.items.map((item) => item.id);
      const active = params.items.filter((item) => item.status === 'in_progress');
      if (new Set(ids).size !== ids.length || active.length > 1) {
        throw new Error('待办 ID 必须唯一，且最多一个条目处于进行中。');
      }
      return params;
    },
    execute: async (_toolCallId, params, signal) => {
      if (signal?.aborted) throw new Error('任务待办更新已取消。');
      return {
        content: [{ type: 'text', text: '任务待办已更新。' }],
        details: { status: 'todo_updated', items: structuredClone(params.items) },
      };
    },
  };
}
