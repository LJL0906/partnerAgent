import type { ToolControlAckV1 } from '@partner-agent/contracts';

const TOOL_CONTROL_ACK_TIMEOUT_MS = 15_000;

interface PendingToolControl {
  action: ToolControlAckV1['action'];
  timer: ReturnType<typeof setTimeout>;
  resolve: (ack: ToolControlAckV1) => void;
  reject: (error: Error) => void;
}

export class ToolControlTimeoutError extends Error {
  constructor() {
    super('工具操作确认超时，执行状态尚未确认，请刷新会话核对；请勿重复提交。');
    this.name = 'ToolControlTimeoutError';
  }
}

export class ToolControlAckError extends Error {
  constructor() {
    super('工具操作确认响应无效，执行状态尚未确认，请刷新会话核对。');
    this.name = 'ToolControlAckError';
  }
}

/** 只管理当前连接内的 ACK 等待；副作用请求不得排队或自动重放。 */
export class ToolControlRequests {
  private readonly pending = new Map<string, PendingToolControl>();

  send(requestId: string, action: ToolControlAckV1['action'], emit: () => void): Promise<ToolControlAckV1> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.take(requestId)?.reject(new ToolControlTimeoutError());
      }, TOOL_CONTROL_ACK_TIMEOUT_MS);
      this.pending.set(requestId, { action, timer, resolve, reject });
      try {
        emit();
      } catch {
        this.take(requestId)?.reject(new Error('工具操作请求发送失败，执行状态尚未确认，请刷新会话核对。'));
      }
    });
  }

  acknowledge(value: unknown): void {
    if (!isRecord(value) || typeof value.request_id !== 'string') return;
    const pending = this.take(value.request_id);
    if (!pending) return;
    if (!isToolControlAck(value) || value.action !== pending.action) {
      pending.reject(new ToolControlAckError());
      return;
    }
    pending.resolve(value);
  }

  rejectAll(error: Error): void {
    for (const requestId of this.pending.keys()) this.take(requestId)?.reject(error);
  }

  private take(requestId: string): PendingToolControl | undefined {
    const pending = this.pending.get(requestId);
    if (!pending) return undefined;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    return pending;
  }
}

function isToolControlAck(value: Record<string, unknown>): value is Record<string, unknown> & ToolControlAckV1 {
  return typeof value.request_id === 'string'
    && (value.action === 'confirm' || value.action === 'dismiss' || value.action === 'undo')
    && (value.status === 'completed' || value.status === 'rejected')
    && (value.error === undefined || (isRecord(value.error)
      && typeof value.error.code === 'string' && typeof value.error.message === 'string'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
