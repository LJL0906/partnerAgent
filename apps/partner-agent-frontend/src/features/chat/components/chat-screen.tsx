import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { reconcileChatFromRest, useChat } from '@/features/chat/use-chat';
import { useChatToolActions } from '@/features/chat/use-chat-tool-actions';
import { getKeyboardAvoidingProps } from '@/features/chat/keyboard-avoiding';
import { createMessageScroll, shouldShowBackToLatest } from '@/features/chat/use-message-scroll';
import { modelSelectionPreferenceStorage } from '@/features/chat/model-selection-storage';
import type { ModelConfig, ReasoningLevel } from '@partner-agent/contracts';
import { createSession, retrySession, useConversationStore } from '@/features/chat/session-management';
import { useChatStore } from '@/store/chat-store';
import { useAuthStore } from '@/features/auth';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

import { ChatInput, isCurrentModelRequest, resolveModelSelection } from './chat-input';
import { ChatHeader } from './chat-header';
import { ChatMessageList } from './chat-message-list';
import { ChatSessionLoading } from './chat-session-loading';
import { ChatSessionsDrawer } from './chat-sessions-drawer';

export function getModelReconciliationError(
  results: readonly [PromiseSettledResult<unknown>, PromiseSettledResult<unknown>],
): string | undefined {
  const sessionResult = results[1];
  return sessionResult.status === 'rejected' || sessionResult.value === undefined
    ? '模型已切换，但无法读取服务端权威会话；当前显示可能不是最新状态，请稍后重试。'
    : undefined;
}

function persistModelSelection(
  ownerId: string | undefined,
  selection: { modelConfigId: string; reasoningLevel: ReasoningLevel | undefined },
): void {
  if (!ownerId || !selection.modelConfigId || !selection.reasoningLevel) return;
  void modelSelectionPreferenceStorage.set(ownerId, {
    modelConfigId: selection.modelConfigId,
    reasoningLevel: selection.reasoningLevel,
  }).catch(() => undefined);
}

export function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const items = useChatStore((state) => state.items);
  const isThinking = useChatStore((state) => state.isThinking);
  const toolViews = useChatStore((state) => state.toolViews);
  const taskTodos = useChatStore((state) => state.taskTodos);
  const sessionId = useChatStore((state) => state.sessionId);
  const sessionRevision = useChatStore((state) => state.sessionRevision);
  const ownerId = useAuthStore((state) => state.user?.id);
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
  const [modelSelection, setModelSelection] = useState<{
    modelConfigId: string;
    reasoningLevel: ReasoningLevel | undefined;
  }>({ modelConfigId: '', reasoningLevel: undefined });
  const [modelSelectionError, setModelSelectionError] = useState<string>();
  const modelListRequestRef = useRef(0);
  const modelSwitchRequestRef = useRef(0);
  const modelListAbortRef = useRef<AbortController | undefined>(undefined);
  const modelSwitchAbortRef = useRef<AbortController | undefined>(undefined);
  const { modelConfigId, reasoningLevel } = modelSelection;
  const horizontalPadding = width <= 340 ? spacing.md : spacing.page;
  const keyboardAvoidingProps = getKeyboardAvoidingProps(Platform.OS, insets.top);
  const loadModels = useCallback(async () => {
    const requestId = ++modelListRequestRef.current;
    const expectedOwnerId = ownerId;
    const expectedSessionRevision = sessionRevision;
    modelListAbortRef.current?.abort();
    const controller = new AbortController();
    modelListAbortRef.current = controller;
    const isCurrent = () => isCurrentModelRequest(
      { requestId, ownerId: expectedOwnerId, sessionRevision: expectedSessionRevision },
      {
        requestId: modelListRequestRef.current,
        ownerId: useAuthStore.getState().user?.id,
        sessionRevision: useChatStore.getState().sessionRevision,
      },
    );
    setModelsLoading(true);
    setModelsLoadError(false);
    try {
      const [{ items }, storedPreference] = await Promise.all([
        listModelConfigs({ signal: controller.signal }),
        expectedOwnerId
          ? modelSelectionPreferenceStorage.get(expectedOwnerId).catch(() => undefined)
          : Promise.resolve(undefined),
      ]);
      if (!isCurrent()) return;
      setModels(items);
      setModelSelection((current) => {
        const preferred = storedPreference ?? current;
        const resolved = resolveModelSelection(
          items,
          preferred.modelConfigId,
          preferred.reasoningLevel,
        );
        return resolved;
      });
    } catch {
      if (isCurrent() && !controller.signal.aborted) setModelsLoadError(true);
    } finally {
      if (isCurrent()) setModelsLoading(false);
    }
  }, [ownerId, sessionRevision]);

  useEffect(() => {
    // 模型列表是外部 REST 数据源，首次挂载时必须主动同步。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadModels();
    return () => modelListAbortRef.current?.abort();
  }, [loadModels]);
  const currentSessionTitle = sessions.find((session) => session.id === sessionId)?.title?.trim();
  const firstUserItem = items.find(
    (item) => item.type === 'message' && item.payload.role === 'user',
  );
  const firstUserMessage = firstUserItem?.type === 'message' ? firstUserItem.payload.content : undefined;
  const chatTitle = currentSessionTitle || firstUserMessage?.replace(/\s+/g, ' ').trim().slice(0, 48) || '新对话';

  const [sessionsMounted, setSessionsMounted] = useState(false);
  const [drawerProgress] = useState(() => new Animated.Value(0));
  const drawerAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const drawerOpenFrame = useRef<number | null>(null);
  const drawerWidth = Math.min(width * 0.78, 360);
  const [scrollUiState, setScrollUiState] = useState({
    sessionRevision,
    pinned: true,
    hasOverflow: false,
  });
  // 控制器是纯闭包:所有滚动状态在闭包内,setPinned/setHasOverflow 只用来驱动
  // 渲染。切换会话时消息区以 key 重挂+sessioinRevision 重建控制器,闭包归零。
  const scroll = useMemo(
    () =>
      createMessageScroll({
        sessionRevision,
        onPinnedChange: (pinned) => setScrollUiState((current) => {
          if (current.sessionRevision > sessionRevision) return current;
          return {
            sessionRevision,
            pinned,
            hasOverflow: current.sessionRevision === sessionRevision ? current.hasOverflow : false,
          };
        }),
        onOverflowChange: (hasOverflow) => setScrollUiState((current) => {
          if (current.sessionRevision > sessionRevision) return current;
          return {
            sessionRevision,
            pinned: current.sessionRevision === sessionRevision ? current.pinned : true,
            hasOverflow,
          };
        }),
      }),
    [sessionRevision],
  );
  // 只在“未贴底且内容溢出视口”时显示“回到最新”,单一状态来源。
  const showBackToLatest = shouldShowBackToLatest(sessionRevision, scrollUiState);

  async function handleModelConfigChange(nextModelConfigId: string) {
    const previous = modelSelection;
    const next = resolveModelSelection(models, nextModelConfigId, reasoningLevel);
    if (!next.modelConfigId || !next.reasoningLevel) return;
    setModelSelection(next);
    setModelSelectionError(undefined);
    if (!useChatStore.getState().sessionPersisted || !sessionId
      || !previous.modelConfigId || previous.modelConfigId === next.modelConfigId) {
      persistModelSelection(ownerId, next);
      return;
    }
    const requestId = ++modelSwitchRequestRef.current;
    const expectedOwnerId = ownerId;
    const expectedSessionId = sessionId;
    const expectedSessionRevision = sessionRevision;
    modelSwitchAbortRef.current?.abort();
    const controller = new AbortController();
    modelSwitchAbortRef.current = controller;
    const isCurrent = () => isCurrentModelRequest(
      { requestId, ownerId: expectedOwnerId, sessionRevision: expectedSessionRevision },
      {
        requestId: modelSwitchRequestRef.current,
        ownerId: useAuthStore.getState().user?.id,
        sessionRevision: useChatStore.getState().sessionRevision,
      },
    ) && expectedSessionId === useChatStore.getState().sessionId;
    try {
      const result = await setMessageModelSelection({
        sessionId: expectedSessionId,
        previousModelConfigId: previous.modelConfigId,
        modelConfigId: next.modelConfigId,
        reasoningLevel: next.reasoningLevel,
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      if (result.status === 'rejected') {
        throw new Error(result.validation_errors?.[0]?.message ?? '模型切换被拒绝。');
      }
      if (!result.data || result.data.session_id !== expectedSessionId) {
        throw new Error('模型切换响应格式无效。');
      }
      const resolved = resolveModelSelection(
        models,
        result.data.resolved_model.model_config_id,
        result.data.resolved_model.reasoning_level,
      );
      if (resolved.modelConfigId !== result.data.resolved_model.model_config_id
        || resolved.reasoningLevel !== result.data.resolved_model.reasoning_level) {
        throw new Error('服务端返回了不可用的模型能力。');
      }
      setModelSelection(resolved);
      persistModelSelection(ownerId, resolved);
      try {
        const reconciliation = await reconcileChatFromRest(undefined, expectedSessionId);
        const reconciliationError = getModelReconciliationError(reconciliation);
        if (isCurrent() && reconciliationError) setModelSelectionError(reconciliationError);
      } catch {
        if (isCurrent()) setModelSelectionError('模型已切换，但会话刷新失败，请稍后重试。');
      }
    } catch (error) {
      if (!isCurrent() || controller.signal.aborted) return;
      setModelSelection(previous);
      setModelSelectionError(error instanceof Error ? error.message : '模型切换失败，请稍后重试。');
    }
  }

  useEffect(() => () => {
    modelSwitchRequestRef.current += 1;
    modelSwitchAbortRef.current?.abort();
  }, [ownerId, sessionRevision]);

  function handleReasoningLevelChange(level: ReasoningLevel) {
    setModelSelection((current) => {
      const next = { ...current, reasoningLevel: level };
      persistModelSelection(ownerId, next);
      return next;
    });
    setModelSelectionError(undefined);
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
          todos={taskTodos}
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
                items={items}
                toolViews={toolViews}
                isThinking={isThinking}
                privacyDecision={privacyDecision}
                horizontalPadding={horizontalPadding}
                scroll={scroll}
                onPrivacyPress={() => router.push('/privacy-decision')}
                onCandidateAnswers={(message) => reasoningLevel
                  ? sendMessage(message, modelConfigId, reasoningLevel)
                  : Promise.resolve(false)}
                itemActions={{
                  toolFeedback: toolActions.feedback,
                  onConfirmTool: (id) => { void toolActions.run('confirm', id); },
                  onDismissTool: (id) => { void toolActions.run('dismiss', id); },
                  onUndoTool: (id) => { void toolActions.run('undo', id); },
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
                gap: spacing.sm,
              }}>
              <ChatInput key={sessionId} connectionStatus={connectionStatus} isStreaming={isStreaming} models={models} modelsLoading={modelsLoading} modelsLoadError={modelsLoadError} modelSelectionError={modelSelectionError} onRetryModels={() => void loadModels()} modelConfigId={modelConfigId} reasoningLevel={reasoningLevel} onModelConfigChange={handleModelConfigChange} onReasoningLevelChange={handleReasoningLevelChange} onSend={sendMessage} onCancel={stopStreaming} />
            </View>
          </>
        )}
      </View>
      <ChatSessionsDrawer visible={sessionsMounted} width={drawerWidth} progress={drawerProgress} onClose={closeSessions} />
    </KeyboardAvoidingView>
  );
}



