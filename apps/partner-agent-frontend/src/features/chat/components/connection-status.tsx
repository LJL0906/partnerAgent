import { View } from 'react-native';

import { StatusBadge } from '@/components/ui/status-badge';
import { useChatStore } from '@/store/chat-store';
import { spacing } from '@/theme/spacing';

const statusCopy = {
  idle: '等待连接',
  connecting: '连接中',
  connected: '已连接',
  disconnected: '已断开',
  error: '连接失败',
  auth_required: '鉴权失败',
} as const;

const taskStatusCopy = {
  idle: '',
  queued: '任务排队中',
  running: '任务执行中',
  cancelling: '正在取消',
  waiting_privacy_decision: '等待隐私决定',
  waiting_tool_approval: '等待工具审批',
  recovering: '正在恢复状态',
  completed: '任务已完成',
  cancelled: '任务已取消',
  failed: '任务失败',
} as const;

export function ConnectionStatus() {
  const status = useChatStore((state) => state.connectionStatus);
  const taskStatus = useChatStore((state) => state.taskStatus);
  const active = status === 'connected';
  const hasConnectionProblem = status === 'disconnected' || status === 'error';
  const connectionTone = active ? 'success' : hasConnectionProblem ? 'danger' : 'warning';
  const taskTone =
    taskStatus === 'failed'
      ? 'danger'
      : taskStatus === 'waiting_privacy_decision' || taskStatus === 'waiting_tool_approval'
        ? 'warning'
        : taskStatus === 'completed'
          ? 'success'
          : 'info';
  return (
    <View accessibilityLiveRegion="polite" style={{ alignItems: 'flex-end', gap: spacing.xxs }}>
      <StatusBadge label={statusCopy[status]} tone={connectionTone} />
      {taskStatus !== 'idle' ? (
        <StatusBadge label={taskStatusCopy[taskStatus]} tone={taskTone} />
      ) : null}
    </View>
  );
}
