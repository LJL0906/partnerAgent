import type { ChatItem, SessionToolView } from '@partner-agent/contracts';
import { Text, View } from 'react-native';

import { UserMessage } from './messages/user-message';
import { AssistantMessage } from './messages/assistant-message';
import { SystemMessage } from './messages/system-message';
import { ToolMessage } from './messages/tool-message';
import { ApprovalCard } from './approval-card';
import { CandidateCard } from './candidate-card';
import { StructuredPreviewCard } from './structured-preview-card';
import { SystemCard } from './system-card';
import { ThinkingCard } from './thinking-card';
import { ToolCallCard } from './tool-call-card';
import { ReminderCard } from './reminder-card';
import { SummaryCard } from './summary-card';
import type { ChatMessage } from '@/store/chat-store';
import { toolActionKey, type ToolActionFeedbackMap } from '../chat-tool-action-state';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

const reasoningLabels = {
  off: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高',
} as const;

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
};

export function ChatItemBubble({ item, actions = {}, toolView }: { item: ChatItem; actions?: ChatItemBubbleActions; toolView?: SessionToolView }) {
  switch (item.type) {
    case 'message': {
      const bubble = <MessageBubble message={{ id: item.id, role: item.payload.role, content: item.payload.content, createdAt: new Date(item.created_at).toISOString() }} />;
      if (item.payload.role !== 'assistant' || !item.payload.model_config_id) return bubble;
      return (
        <View style={{ gap: spacing.xxs }}>
          {bubble}
          <Text selectable style={[typography.caption, { color: colors.textTertiary, marginLeft: 44 }]}>
            模型：{item.payload.model_config_id}
            {item.payload.reasoning_level ? ` · 推理：${reasoningLabels[item.payload.reasoning_level]}` : ''}
          </Text>
        </View>
      );
    }
    case 'thinking':
      return <ThinkingCard content={item.payload.text ?? '正在整理信息…'} />;
    case 'tool': {
      if (!toolView) {
        return <SystemCard title="工具状态待同步" content="尚未收到该工具调用的权威状态，请刷新会话后重试。" />;
      }
      const executionId = item.execution_id;
      const undoAllowed = toolView.allowed_actions.includes('undo');
      return <ToolCallCard toolName={toolView.tool_name} state={toolView.status}
        undoAvailable={undoAllowed}
        riskLevel={toolView.risk_level}
        undoExpiresAt={toolView.undo_expires_at}
        inputPreview={toolView.request_summary} outputPreview={toolView.result_summary}
        feedback={executionId ? actions.toolFeedback?.[toolActionKey('undo', executionId)] : undefined}
        onUndo={undoAllowed && executionId && actions.onUndoTool
          ? () => actions.onUndoTool?.(executionId) : undefined} />;
    }
    case 'candidate':
      return <CandidateCard candidateId={item.candidate_id} title={`${item.payload.kind} 候选`} candidateType={item.payload.kind} summary={typeof item.payload.preview.summary === 'string' ? item.payload.preview.summary : undefined} previewOnly />;
    case 'structured_preview':
      return <StructuredPreviewCard createdAt={item.created_at} preview={item.payload} />;
    case 'approval': {
      if (!toolView) {
        return <SystemCard title="工具状态待同步" content="尚未收到该审批的权威状态，不会提供操作按钮。" />;
      }
      const confirmationId = item.approval_id ?? item.payload.approval_id;
      const actionsAllowed = toolView.allowed_actions;
      return <ApprovalCard title="工具需要确认" status={toolView.status}
        summary={toolView.request_summary} previewOnly={false}
        riskLevel={toolView.risk_level}
        expiresAt={toolView.expires_at}
        feedback={actions.toolFeedback?.[toolActionKey('confirm', confirmationId)]}
        onApprove={actionsAllowed.includes('confirm') && actions.onConfirmTool ? () => actions.onConfirmTool?.(confirmationId) : undefined}
        onReject={actionsAllowed.includes('dismiss') && actions.onDismissTool ? () => actions.onDismissTool?.(confirmationId) : undefined} />;
    }
    case 'runtime':
      return null;
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
