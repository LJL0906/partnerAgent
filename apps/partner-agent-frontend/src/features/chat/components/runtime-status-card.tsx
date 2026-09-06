import { Text, View } from 'react-native';

import { ChatItemCard } from './chat-item-card';
import type { RuntimeStatusDisplay } from './chat-item-types';

const stateLabels = {
  idle: '待处理',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
} as const;

export type RuntimeStatusCardProps = RuntimeStatusDisplay;

export function RuntimeStatusCard({ state = 'idle', summary, details }: RuntimeStatusCardProps) {
  return (
    <ChatItemCard subtitle={stateLabels[state]} title="运行状态" tone="runtime">
      <View style={{ gap: 8 }}>
        {summary ? <Text selectable style={{ color: '#171821', fontSize: 14, lineHeight: 20 }}>{summary}</Text> : null}
        {details ? <Text selectable style={{ color: '#676C7E', fontSize: 13, lineHeight: 18 }}>{details}</Text> : null}
      </View>
    </ChatItemCard>
  );
}
