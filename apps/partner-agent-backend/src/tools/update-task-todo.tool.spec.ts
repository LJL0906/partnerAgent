import { describe, expect, it } from 'vitest';
import { createUpdateTaskTodoTool } from './update-task-todo.tool.js';

describe('update_task_todo', () => {
  it('returns a complete transient snapshot without exposing it as assistant text', async () => {
    const tool = createUpdateTaskTodoTool();
    const items = [
      { id: 'step-1', content: '分析需求', status: 'completed' as const },
      { id: 'step-2', content: '实现功能', status: 'in_progress' as const },
    ];
    expect(tool.prepareArguments?.({ items })).toEqual({ items });
    expect(await tool.execute('call-1', { items })).toEqual({
      content: [{ type: 'text', text: '任务待办已更新。' }],
      details: { status: 'todo_updated', items },
    });
  });

  it('rejects duplicate ids and multiple active items', () => {
    const tool = createUpdateTaskTodoTool();
    expect(() => tool.prepareArguments?.({ items: [
      { id: 'same', content: '一', status: 'in_progress' },
      { id: 'same', content: '二', status: 'in_progress' },
    ] })).toThrow('待办 ID 必须唯一');
  });
});
