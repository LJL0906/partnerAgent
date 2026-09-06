import type {
  ToolConfirmationControlRequestV1,
  ToolControlAckV1,
  ToolUndoControlRequestV1,
} from '@partner-agent/contracts';

export interface ChatToolControlTransport {
  confirmTool: (request: Omit<ToolConfirmationControlRequestV1, 'request_id'>) => Promise<ToolControlAckV1>;
  dismissTool: (request: Omit<ToolConfirmationControlRequestV1, 'request_id'>) => Promise<ToolControlAckV1>;
  undoTool: (request: Omit<ToolUndoControlRequestV1, 'request_id'>) => Promise<ToolControlAckV1>;
}

export interface ChatToolControls {
  confirmTool: (confirmationId: string) => Promise<ToolControlAckV1>;
  dismissTool: (confirmationId: string) => Promise<ToolControlAckV1>;
  undoTool: (executionId: string) => Promise<ToolControlAckV1>;
}

export function createChatToolControls(
  getSessionId: () => string | undefined,
  getTransport: () => ChatToolControlTransport | undefined,
): ChatToolControls {
  const run = async (
    operation: 'confirm' | 'dismiss' | 'undo',
    resourceId: string,
  ): Promise<ToolControlAckV1> => {
    const sessionId = getSessionId();
    if (!sessionId) throw new Error('聊天会话尚未就绪。');
    if (!resourceId.trim()) throw new Error('工具控制标识不能为空。');
    const transport = getTransport();
    if (!transport) throw new Error('实时连接尚未就绪。');

    if (operation === 'undo') {
      return transport.undoTool({ session_id: sessionId, execution_id: resourceId });
    }
    const request = { session_id: sessionId, confirmation_id: resourceId };
    return operation === 'confirm'
      ? transport.confirmTool(request)
      : transport.dismissTool(request);
  };

  return {
    confirmTool: (confirmationId) => run('confirm', confirmationId),
    dismissTool: (confirmationId) => run('dismiss', confirmationId),
    undoTool: (executionId) => run('undo', executionId),
  };
}
