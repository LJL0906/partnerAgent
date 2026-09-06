import { Text, View } from 'react-native';

import { ChatItemCard } from './chat-item-card';
import type { ToolCallDisplay } from './chat-item-types';
import { ToolActionNotice } from './tool-action-notice';
import { isToolActionBlocked, type ToolActionFeedback } from '../chat-tool-action-state';

const stateLabels = {
  pending: '待处理',
  executing: '执行中',
  succeeded: '已完成',
  failed: '失败',
  dismissed: '已拒绝',
  expired: '已过期',
  indeterminate: '结果待核对',
  undone: '已撤销',
} as const;

const riskLabels = { read_only: '只读', low: '低风险', medium: '中风险', high: '高风险' } as const;

export type ToolCallCardProps = Omit<ToolCallDisplay, 'state'> & {
  state?: ToolCallDisplay['state'];
  undoAvailable?: boolean;
  riskLevel?: keyof typeof riskLabels;
  undoExpiresAt?: string;
  feedback?: ToolActionFeedback;
  onOpen?: () => void;
  onUndo?: () => void;
};

export function ToolCallCard({ toolName, state = 'pending', inputPreview, outputPreview, previewOnly = false, undoAvailable = false, riskLevel, undoExpiresAt, feedback, onOpen, onUndo }: ToolCallCardProps) {
  const canUndo = undoAvailable && !isToolActionBlocked(feedback) && state === 'succeeded';

  return (
    <ChatItemCard accessory={onOpen ? <Text accessibilityRole="button" onPress={onOpen} style={{ color: '#8A5CF6', fontSize: 12, fontWeight: '600' }}>查看</Text> : null} previewOnly={previewOnly} subtitle={toolName} title="工具调用" tone="tool" notice={undoAvailable ? <ToolActionNotice feedback={feedback} /> : undefined}>
      <View style={{ gap: 8 }}>
        <Text style={{ color: '#8A5CF6', fontSize: 12, fontWeight: '600' }}>{canUndo ? '可撤销' : stateLabels[state]}</Text>
        {riskLevel ? <Text style={{ color: '#676C7E', fontSize: 12 }}>风险：{riskLabels[riskLevel]}</Text> : null}
        {undoExpiresAt ? <Text style={{ color: '#676C7E', fontSize: 12 }}>撤销有效期至：{new Date(undoExpiresAt).toLocaleString()}</Text> : null}
        {inputPreview ? <Text selectable style={{ color: '#676C7E', fontSize: 13, lineHeight: 18 }}>输入预览：{inputPreview}</Text> : null}
        {canUndo && onUndo ? <Text accessibilityRole="button" onPress={onUndo} style={{ color: '#8A5CF6', fontSize: 12, fontWeight: '600' }}>撤销</Text> : null}
        {outputPreview ? <Text selectable style={{ color: '#171821', fontSize: 13, lineHeight: 18 }}>输出预览：{outputPreview}</Text> : null}
      </View>
    </ChatItemCard>
  );
}
