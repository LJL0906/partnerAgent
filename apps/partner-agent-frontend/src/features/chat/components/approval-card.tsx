import type { ChatItemStatus } from '@partner-agent/contracts';
import { Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';

import { ChatItemCard } from './chat-item-card';
import type { ApprovalDisplay } from './chat-item-types';
import { ToolActionNotice } from './tool-action-notice';
import { isToolActionBlocked, type ToolActionFeedback } from '../chat-tool-action-state';

const statusLabels: Record<ChatItemStatus, string> = {
  queued: '排队中',
  streaming: '处理中',
  pending: '待确认',
  running: '处理中',
  completed: '已确认',
  failed: '失败',
  cancelled: '已取消',
  dismissed: '已拒绝',
  expired: '已过期',
  paused: '已暂停',
};

export type ApprovalCardProps = ApprovalDisplay & {
  status?: ChatItemStatus;
  feedback?: ToolActionFeedback;
  decisionLabel?: string;
  onApprove?: () => void;
  onReject?: () => void;
};

export function ApprovalCard({ title, summary, details, status = 'pending', previewOnly = true, decisionLabel, feedback, onApprove, onReject }: ApprovalCardProps) {
  const blocked = isToolActionBlocked(feedback);
  const prompt = decisionLabel ?? (previewOnly ? '仅记录预览决定，不会写入正式对象。' : '允许执行此工具操作；这不是业务候选入库确认。');
  return (
    <ChatItemCard previewOnly={previewOnly} subtitle={statusLabels[status]} title={title} tone="approval" notice={status === 'pending' ? <ToolActionNotice feedback={feedback} /> : undefined}>
      <View style={{ gap: 8 }}>
        {summary ? <Text selectable style={{ color: '#171821', fontSize: 14, lineHeight: 20 }}>{summary}</Text> : null}
        {details ? <Text selectable style={{ color: '#676C7E', fontSize: 13, lineHeight: 18 }}>{details}</Text> : null}
        {status === 'pending' ? <Text style={{ color: '#B66D0C', fontSize: 12, lineHeight: 16 }}>{prompt}</Text> : null}
        {status === 'pending' && (onApprove || onReject) ? <View style={{ flexDirection: 'row', gap: 8 }}>
          {onApprove ? <AppButton disabled={blocked} onPress={() => { if (!blocked) onApprove?.(); }} size="sm" title="确认" variant="primary" /> : null}
          {onReject ? <AppButton disabled={blocked} onPress={() => { if (!blocked) onReject?.(); }} size="sm" title="拒绝" variant="danger" /> : null}
        </View> : null}
      </View>
    </ChatItemCard>
  );
}

