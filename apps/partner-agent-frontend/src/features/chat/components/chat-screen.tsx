import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listModelConfigs, setMessageModelSelection } from '@/api/chat-api';
import { AmbientBackground } from '@/components/ui/ambient-background';
import { AppButton } from '@/components/ui/app-button';
import { useChat } from '@/features/chat/use-chat';
import { useChatToolActions } from '@/features/chat/use-chat-tool-actions';
import { getKeyboardAvoidingProps } from '@/features/chat/keyboard-avoiding';
import { createMessageScroll } from '@/features/chat/use-message-scroll';
import type { ModelConfig, ReasoningLevel } from '@partner-agent/contracts';
import { createSession, retrySession, useConversationStore } from '@/features/chat/session-management';
import { useChatStore } from '@/store/chat-store';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

import { ChatInput } from './chat-input';
import { ChatHeader } from './chat-header';
import { ChatMessageList } from './chat-message-list';
import { ChatSessionLoading } from './chat-session-loading';
import { ChatSessionsDrawer } from './chat-sessions-drawer';

export function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const messages = useChatStore((state) => state.messages);
  const items = useChatStore((state) => state.items);
  const sessionId = useChatStore((state) => state.sessionId);
  const sessionRevision = useChatStore((state) => state.sessionRevision);
  const sessions = useConversationStore((state) => state.sessions);
  const ready = useConversationStore((state) => state.ready);
  const opening = useConversationStore((state) => state.opening);
  const error = useConversationStore((state) => state.error);
  const connectionStatus = useChatStore((state) => state.connectionStatus);
  const privacyDecision = useChatStore((state) => state.privacyDecision);
  const { sendMessage, stopStreaming, isStreaming, toolControls } = useChat();
  const toolActions = useChatToolActions(toolControls, sessionRevision);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsLoadError, setModelsLoadError] = useState(false);
  const [modelConfigId, setModelConfigId] = useState('');
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>();
  const horizontalPadding = width <= 340 ? spacing.md : spacing.page;
  const keyboardAvoidingProps = getKeyboardAvoidingProps(Platform.OS, insets.top);
  const loadModels = useMemo(() => async () => {
    setModelsLoading(true);
    setModelsLoadError(false);
    try {
      const { items } = await listModelConfigs();
      setModels(items);
      const initialModel = items.find((item) => item.is_default) ?? items[0];
      setModelConfigId((current) => current || initialModel?.id || '');
      setReasoningLevel((current) => current ?? initialModel?.reasoning_levels?.[0]);
    } catch {
      setModelsLoadError(true);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    // 模型列表是外部 REST 数据源，首次挂载时必须主动同步。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadModels();
  }, [loadModels]);
  const currentSessionTitle = sessions.find((session) => session.id === sessionId)?.title?.trim();
  const firstUserMessage = messages.find((message) => message.role === 'user')?.content;
  const chatTitle = currentSessionTitle || firstUserMessage?.replace(/\s+/g, ' ').trim().slice(0, 48) || '新对话';

  const [sessionsMounted, setSessionsMounted] = useState(false);
  const [drawerProgress] = useState(() => new Animated.Value(0));
  const drawerAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const drawerOpenFrame = useRef<number | null>(null);
  const drawerWidth = Math.min(width * 0.78, 360);
  const [pinned, setPinned] = useState(true);
  const [hasOverflow, setHasOverflow] = useState(false);
  // 控制器是纯闭包:所有滚动状态在闭包内,setPinned/setHasOverflow 只用来驱动
  // 渲染。切换会话时消息区以 key 重挂+sessioinRevision 重建控制器,闭包归零。
  const scroll = useMemo(
    () =>
      createMessageScroll({
        sessionRevision,
        onPinnedChange: setPinned,
        onOverflowChange: setHasOverflow,
      }),
    [sessionRevision],
  );
  // 只在“未贴底且内容溢出视口”时显示“回到最新”,单一状态来源。
  const showBackToLatest = !pinned && hasOverflow;


  async function handleModelConfigChange(nextModelConfigId: string) {
    const previous = modelConfigId;
    setModelConfigId(nextModelConfigId);
    if (!useChatStore.getState().sessionPersisted || !sessionId || !previous || previous === nextModelConfigId) return;
    try {
      const nextModel = models.find((model) => model.id === nextModelConfigId);
      const nextReasoningLevel = nextModel?.reasoning_levels?.[0] ?? reasoningLevel ?? 'medium';
      setReasoningLevel(nextModel?.reasoning_levels?.[0]);
      await setMessageModelSelection({ sessionId, previousModelConfigId: previous, modelConfigId: nextModelConfigId, reasoningLevel: nextReasoningLevel });
      const from = models.find((model) => model.id === previous)?.model_id ?? previous;
      const to = models.find((model) => model.id === nextModelConfigId)?.model_id ?? nextModelConfigId;
      useChatStore.getState().addMessage({ id: `model-switch-${Date.now()}`, role: 'system', content: `模型由 ${from} 切换成 ${to}` });
    } catch (error) {
      setModelConfigId(previous);
      useChatStore.getState().addMessage({ id: `model-switch-error-${Date.now()}`, role: 'system', content: error instanceof Error ? error.message : '模型切换失败，请稍后重试。' });
    }
  }

  function stopDrawerAnimation() {
    if (drawerOpenFrame.current !== null) {
      cancelAnimationFrame(drawerOpenFrame.current);
      drawerOpenFrame.current = null;
    }
    drawerAnimation.current?.stop();
    drawerAnimation.current = null;
  }

  useEffect(() => () => stopDrawerAnimation(), []);

  function openSessions() {
    stopDrawerAnimation();
    setSessionsMounted(true);
    drawerOpenFrame.current = requestAnimationFrame(() => {
      drawerOpenFrame.current = null;
      drawerAnimation.current = Animated.spring(drawerProgress, {
        toValue: 1,
        damping: 24,
        stiffness: 260,
        mass: 0.8,
        overshootClamping: true,
        isInteraction: false,
        useNativeDriver: true,
      });
      drawerAnimation.current.start(() => { drawerAnimation.current = null; });
    });
  }

  function closeSessions() {
    stopDrawerAnimation();
    drawerAnimation.current = Animated.spring(drawerProgress, {
      toValue: 0,
      damping: 28,
      stiffness: 300,
      mass: 0.8,
      overshootClamping: true,
      isInteraction: false,
      useNativeDriver: true,
    });
    drawerAnimation.current.start(({ finished }) => {
      drawerAnimation.current = null;
      if (finished) setSessionsMounted(false);
    });
  }

  return (
    <KeyboardAvoidingView
      enabled={keyboardAvoidingProps.enabled}
      behavior={keyboardAvoidingProps.behavior}
      keyboardVerticalOffset={keyboardAvoidingProps.keyboardVerticalOffset}
      style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <AmbientBackground />
        <ChatHeader
          title={chatTitle}
          disabled={opening || !ready}
          onOpenSessions={openSessions}
          onCreateSession={() => void createSession()}
        />
        {!ready || opening ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <ChatSessionLoading opening={opening} error={error} onRetry={() => void retrySession()} />
          </View>
        ) : (
          <>
            <View style={{ flex: 1, minHeight: 0 }}>
              {/* key=sessionRevision:切换会话时重挂,重置贴底状态,避免串线。 */}
              <ChatMessageList
                key={sessionRevision}
                messages={messages}
                items={items}
                privacyDecision={privacyDecision}
                horizontalPadding={horizontalPadding}
                scroll={scroll}
                onPrivacyPress={() => router.push('/privacy-decision')}
                itemActions={{
                  toolFeedback: toolActions.feedback,
                  onConfirmTool: (id) => { void toolActions.run('confirm', id); },
                  onDismissTool: (id) => { void toolActions.run('dismiss', id); },
                  onUndoTool: (id) => { void toolActions.run('undo', id); },
                  onCandidateDecision: (decision) => { console.info('[ChatPreviewDecision]', decision); },
                }}
              />

              {showBackToLatest ? (
                <View
                  pointerEvents="box-none"
                  style={{
                    position: 'absolute',
                    bottom: spacing.sm,
                    left: 0,
                    right: 0,
                    alignItems: 'center',
                  }}>
                  <AppButton
                    title="回到最新消息"
                    size="sm"
                    variant="secondary"
                    style={{ alignSelf: 'center' }}
                    onPress={() => scroll.scrollToLatest()}
                  />
                </View>
              ) : null}
            </View>

            <View
              style={{
                paddingHorizontal: horizontalPadding,
                paddingTop: 4,
                paddingBottom: Math.max(insets.bottom, spacing.sm),
              }}>
              <ChatInput key={sessionId} connectionStatus={connectionStatus} isStreaming={isStreaming} models={models} modelsLoading={modelsLoading} modelsLoadError={modelsLoadError} onRetryModels={() => void loadModels()} modelConfigId={modelConfigId} reasoningLevel={reasoningLevel} onModelConfigChange={handleModelConfigChange} onReasoningLevelChange={setReasoningLevel} onSend={sendMessage} onCancel={stopStreaming} />
            </View>
          </>
        )}
      </View>
      <ChatSessionsDrawer visible={sessionsMounted} width={drawerWidth} progress={drawerProgress} onClose={closeSessions} />
    </KeyboardAvoidingView>
  );
}



