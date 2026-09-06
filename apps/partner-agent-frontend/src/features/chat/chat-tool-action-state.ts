import type { ToolControlActionV1 } from '@partner-agent/contracts';

import type { ChatToolControls } from './chat-tool-controls';

export interface ToolActionFeedback {
  phase: 'pending' | 'acknowledged' | 'rejected' | 'unknown';
  message: string;
}
export type ToolActionFeedbackMap = Readonly<Record<string, ToolActionFeedback>>;

export function toolActionKey(action: ToolControlActionV1, resourceId: string): string {
  // Confirm and dismiss target the same resource and must share their in-flight lock.
  return `${action === 'undo' ? 'execution' : 'confirmation'}:${resourceId}`;
}

export function isToolActionBlocked(feedback?: ToolActionFeedback): boolean {
  return feedback !== undefined && feedback.phase !== 'rejected';
}

/** UI request state only: ACKs never mutate authoritative ChatItem/task/business state. */
export function createToolActionState(controls: ChatToolControls) {
  let snapshot: ToolActionFeedbackMap = {};
  const listeners = new Set<() => void>();
  const update = (key: string, feedback: ToolActionFeedback) => {
    snapshot = { ...snapshot, [key]: feedback };
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    run: async (action: ToolControlActionV1, resourceId: string): Promise<void> => {
      const key = toolActionKey(action, resourceId);
      if (isToolActionBlocked(snapshot[key])) return;
      update(key, { phase: 'pending', message: '正在提交工具操作…' });
      try {
        const ack = await (action === 'confirm' ? controls.confirmTool(resourceId)
          : action === 'dismiss' ? controls.dismissTool(resourceId) : controls.undoTool(resourceId));
        if (!ack || ack.action !== action || !['completed', 'rejected'].includes(ack.status)) {
          throw new Error('Invalid acknowledgement');
        }
        update(key, ack.status === 'completed'
          ? { phase: 'acknowledged', message: '请求已受理，等待服务端状态更新。' }
          : { phase: 'rejected', message: '服务端拒绝了此操作，请核对最新状态后重试。' });
      } catch {
        // A missing ACK cannot prove that a side effect did not happen. Never replay it.
        update(key, { phase: 'unknown', message: '未能确认操作结果，请重新打开会话查看状态；不会自动重复执行。' });
      }
    },
  };
}
