import type { ChatItem } from '@partner-agent/contracts';

import { UserMessage } from './messages/user-message';
import { AssistantMessage } from './messages/assistant-message';
import { SystemMessage } from './messages/system-message';
import { ToolMessage } from './messages/tool-message';
import { ApprovalCard } from './approval-card';
import { CandidateCard } from './candidate-card';
import { RuntimeStatusCard } from './runtime-status-card';
import { SystemCard } from './system-card';
import { ThinkingCard } from './thinking-card';
import { ToolCallCard } from './tool-call-card';
import { ReminderCard } from './reminder-card';
import { SummaryCard } from './summary-card';
import type { ChatMessage } from '@/store/chat-store';
import type { CandidatePreviewDecision } from './chat-item-types';
import { toolActionKey, type ToolActionFeedbackMap } from '../chat-tool-action-state';

export function MessageBubble({ message }: { message: ChatMessage }) {
  switch (message.role) {
    case 'user': return <UserMessage message={message} />;
    case 'assistant': return <AssistantMessage message={message} />;
    case 'system': return <SystemMessage message={message} />;
    case 'tool': return <ToolMessage message={message} />;
    default: return <AssistantMessage message={message} />;
  }
}

export type ChatItemBubbleActions = {
  toolFeedback?: ToolActionFeedbackMap;
  onConfirmTool?: (confirmationId: string) => void;
  onDismissTool?: (confirmationId: string) => void;
  onUndoTool?: (executionId: string) => void;
  onCandidateDecision?: (decision: CandidatePreviewDecision) => void;
};

export function ChatItemBubble({ item, actions = {} }: { item: ChatItem; actions?: ChatItemBubbleActions }) {
  switch (item.type) {
    case 'message':
      return <MessageBubble message={{ id: item.id, role: item.payload.role, content: item.payload.content, createdAt: new Date(item.created_at).toISOString() }} />;
    case 'thinking':
      return <ThinkingCard content={item.payload.text ?? '正在整理信息…'} />;
    case 'tool': {
      const executionId = item.execution_id;
      return <ToolCallCard toolName={item.payload.tool} state={item.status}
        undoAvailable={item.payload.undo_available === true}
        inputPreview={item.payload.input_summary} outputPreview={item.payload.output_summary}
        feedback={executionId ? actions.toolFeedback?.[toolActionKey('undo', executionId)] : undefined}
        onUndo={item.payload.undo_available && executionId && actions.onUndoTool
          ? () => actions.onUndoTool?.(executionId) : undefined} />;
    }
    case 'candidate':
      return <CandidateCard candidateId={item.candidate_id} title={`${item.payload.kind} 候选`} candidateType={item.payload.kind} summary={typeof item.payload.preview.summary === 'string' ? item.payload.preview.summary : undefined} previewOnly onDecision={actions.onCandidateDecision} />;
    case 'approval': {
      const confirmationId = item.approval_id ?? item.payload.approval_id;
      return <ApprovalCard title="工具需要确认" status={item.status}
        summary={item.payload.request_summary} previewOnly={false}
        feedback={actions.toolFeedback?.[toolActionKey('confirm', confirmationId)]}
        onApprove={actions.onConfirmTool ? () => actions.onConfirmTool?.(confirmationId) : undefined}
        onReject={actions.onDismissTool ? () => actions.onDismissTool?.(confirmationId) : undefined} />;
    }
    case 'runtime':
      return <RuntimeStatusCard state={item.payload.state === 'completed' ? 'completed' : item.payload.state === 'failed' ? 'failed' : item.payload.state === 'paused' ? 'paused' : 'running'} summary={item.payload.detail} />;
    case 'error':
      return <SystemCard title="处理失败" content={`${item.payload.code}：${item.payload.message}`} />;
    case 'system':
      return <SystemCard content={item.payload.message} />;
    case 'reminder':
      return <ReminderCard title={item.payload.title} dueAt={item.payload.due_at} />;
    case 'summary':
      return <SummaryCard content={item.payload.content} period={item.payload.period} />;
    default:
      return null;
  }
}
