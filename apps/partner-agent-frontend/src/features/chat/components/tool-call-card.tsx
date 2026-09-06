import type { ChatItemStatus } from '@partner-agent/contracts';
import { Text, View } from 'react-native';

import { ChatItemCard } from './chat-item-card';
import type { ToolCallDisplay } from './chat-item-types';
import { ToolActionNotice } from './tool-action-notice';
import { isToolActionBlocked, type ToolActionFeedback } from '../chat-tool-action-state';

const stateLabels = {
  queued: '排队中',
  pending: '待处理',
  streaming: '执行中',
  running: '执行中',
  completed: '已完成',
  cancelled: '已取消',
  dismissed: '已拒绝',
  expired: '已过期',
  paused: '已暂停',
  succeeded: '已完成',
  failed: '失败',
} as const;

export type ToolCallCardProps = Omit<ToolCallDisplay, 'state'> & {
  state?: ToolCallDisplay['state'] | ChatItemStatus;
  undoAvailable?: boolean;
  feedback?: ToolActionFeedback;
  onOpen?: () => void;
  onUndo?: () => void;
};

export function ToolCallCard({ toolName, state = 'queued', inputPreview, outputPreview, previewOnly = false, undoAvailable = false, feedback, onOpen, onUndo }: ToolCallCardProps) {
  const canUndo = undoAvailable && !isToolActionBlocked(feedback) && (state === 'pending' || state === 'completed' || state === 'succeeded');

  return (
    <ChatItemCard accessory={onOpen ? <Text accessibilityRole="button" onPress={onOpen} style={{ color: '#8A5CF6', fontSize: 12, fontWeight: '600' }}>查看</Text> : null} previewOnly={previewOnly} subtitle={toolName} title="工具调用" tone="tool" notice={undoAvailable ? <ToolActionNotice feedback={feedback} /> : undefined}>
      <View style={{ gap: 8 }}>
        <Text style={{ color: '#8A5CF6', fontSize: 12, fontWeight: '600' }}>{state === 'pending' && canUndo ? '可撤销' : stateLabels[state]}</Text>
        {inputPreview ? <Text selectable style={{ color: '#676C7E', fontSize: 13, lineHeight: 18 }}>输入预览：{inputPreview}</Text> : null}
        {canUndo && onUndo ? <Text accessibilityRole="button" onPress={onUndo} style={{ color: '#8A5CF6', fontSize: 12, fontWeight: '600' }}>撤销</Text> : null}
        {outputPreview ? <Text selectable style={{ color: '#171821', fontSize: 13, lineHeight: 18 }}>输出预览：{outputPreview}</Text> : null}
      </View>
    </ChatItemCard>
  );
}
