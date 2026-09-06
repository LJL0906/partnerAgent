import { FeedbackState } from '@/components/ui/feedback-state';

interface ChatSessionLoadingProps {
  opening: boolean;
  error?: string;
  onRetry: () => void;
}

export function ChatSessionLoading({ opening, error, onRetry }: ChatSessionLoadingProps) {
  const failed = Boolean(error && !opening);
  return <FeedbackState type={failed ? 'error' : 'loading'} title={failed ? '暂时无法恢复对话' : '正在恢复对话'} description={failed ? error : '正在读取历史消息和回复状态。'} actionLabel={failed ? '重试' : undefined} onAction={onRetry} />;
}
