import { Text, View } from 'react-native';

import { useChatStore } from '@/store/chat-store';
import { colors } from '@/theme/colors';

const statusCopy = {
  idle: '等待连接',
  connecting: '连接中',
  connected: '已连接',
  disconnected: '已断开',
  error: '连接失败',
  auth_required: '等待登录',
} as const;

const taskStatusCopy = {
  idle: '',
  queued: '任务排队中',
  running: '任务执行中',
  cancelling: '正在取消',
  waiting_privacy_decision: '等待隐私决定',
  recovering: '正在恢复状态',
  completed: '任务已完成',
  cancelled: '任务已取消',
  failed: '任务失败',
} as const;

export function ConnectionStatus() {
  const status = useChatStore((state) => state.connectionStatus);
  const taskStatus = useChatStore((state) => state.taskStatus);
  const active = status === 'connected';
  return (
    <View style={{ alignItems: 'flex-end', gap: 5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: active ? colors.primary : colors.warn,
          }}
        />
        <Text
          selectable
          style={{ color: active ? colors.primary : colors.textSecondary, fontSize: 13 }}>
          {statusCopy[status]}
        </Text>
      </View>
      {taskStatus !== 'idle' ? (
        <Text
          accessibilityLiveRegion="polite"
          selectable
          style={{
            color:
              taskStatus === 'failed'
                ? colors.error
                : taskStatus === 'waiting_privacy_decision'
                  ? colors.warn
                  : colors.textSecondary,
            fontSize: 13,
          }}>
          {taskStatusCopy[taskStatus]}
        </Text>
      ) : null}
    </View>
  );
}
