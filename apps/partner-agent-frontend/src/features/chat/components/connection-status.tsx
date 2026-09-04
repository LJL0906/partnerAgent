import { Text, View } from 'react-native';

import { useChatStore } from '@/store/chat-store';
import { colors } from '@/theme/colors';

const statusCopy = {
  idle: '等待连接',
  connecting: '连接中',
  connected: '已连接',
  disconnected: '已断开',
  error: '连接失败',
} as const;

export function ConnectionStatus() {
  const status = useChatStore((state) => state.connectionStatus);
  const active = status === 'connected';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: active ? colors.primary : colors.warn,
        }}
      />
      <Text selectable style={{ color: active ? colors.primary : colors.textSecondary, fontSize: 13 }}>
        {statusCopy[status]}
      </Text>
    </View>
  );
}
