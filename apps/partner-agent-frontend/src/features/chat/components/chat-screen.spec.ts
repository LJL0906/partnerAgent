import { describe, expect, it, vi } from 'vitest';

import { getModelReconciliationError } from './chat-screen';

vi.mock('react-native', () => ({
  Animated: {}, KeyboardAvoidingView: vi.fn(), Platform: { OS: 'web' },
  useWindowDimensions: () => ({ width: 400 }), View: vi.fn(),
}));
vi.mock('expo-router', () => ({ useRouter: vi.fn() }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: vi.fn() }));
vi.mock('@/api/chat-api', () => ({ listModelConfigs: vi.fn(), setMessageModelSelection: vi.fn() }));
vi.mock('@/features/chat/use-chat', () => ({ reconcileChatFromRest: vi.fn(), useChat: vi.fn() }));
vi.mock('@/features/chat/use-chat-tool-actions', () => ({ useChatToolActions: vi.fn() }));
vi.mock('@/features/chat/keyboard-avoiding', () => ({ getKeyboardAvoidingProps: vi.fn() }));
vi.mock('@/features/chat/use-message-scroll', () => ({ createMessageScroll: vi.fn() }));
vi.mock('@/features/chat/session-management', () => ({ createSession: vi.fn(), retrySession: vi.fn(), useConversationStore: vi.fn() }));
vi.mock('@/store/chat-store', () => ({ useChatStore: Object.assign(vi.fn(), { getState: vi.fn() }) }));
vi.mock('@/features/auth', () => ({ useAuthStore: Object.assign(vi.fn(), { getState: vi.fn() }) }));
vi.mock('./chat-input', () => ({ ChatInput: vi.fn(), isCurrentModelRequest: vi.fn(), resolveModelSelection: vi.fn() }));
vi.mock('./chat-header', () => ({ ChatHeader: vi.fn() }));
vi.mock('./chat-message-list', () => ({ ChatMessageList: vi.fn() }));
vi.mock('./chat-session-loading', () => ({ ChatSessionLoading: vi.fn() }));
vi.mock('./chat-sessions-drawer', () => ({ ChatSessionsDrawer: vi.fn() }));
vi.mock('@/components/ui/ambient-background', () => ({ AmbientBackground: vi.fn() }));
vi.mock('@/components/ui/app-button', () => ({ AppButton: vi.fn() }));

describe('model selection reconciliation', () => {
  it('reports a failed authoritative session GET from allSettled results', () => {
    const results: [PromiseSettledResult<undefined>, PromiseSettledResult<undefined>] = [
      { status: 'fulfilled', value: undefined },
      { status: 'rejected', reason: new Error('offline') },
    ];
    expect(getModelReconciliationError(results)).toContain('权威会话');
  });

  it('does not report an error when the authoritative session GET succeeds', () => {
    const results: [PromiseSettledResult<undefined>, PromiseSettledResult<{ id: string }>] = [
      { status: 'fulfilled', value: undefined },
      { status: 'fulfilled', value: { id: 'session-1' } },
    ];
    expect(getModelReconciliationError(results)).toBeUndefined();
  });
});
