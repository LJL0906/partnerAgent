import { View } from 'react-native';
import { StatusBadge } from '@/components/ui/status-badge';
import type { ChatMessage } from '@/store/chat-store';

export function ToolMessage({ message }: { message: ChatMessage }) {
  const finished = message.toolSuccess !== undefined;
  const succeeded = message.toolSuccess === true;
  const label = finished ? `${message.tool ?? '工具'}执行${succeeded ? '完成' : '失败'}` : message.content;
  return <View style={{ alignSelf: 'stretch', alignItems: 'flex-start' }}><StatusBadge label={label} tone={!finished ? 'ai' : succeeded ? 'success' : 'danger'} /></View>;
}
