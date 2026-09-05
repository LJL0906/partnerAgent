import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { apiConfig } from '@/api/config';
import { AppButton } from '@/components/ui/app-button';
import { FeedbackState } from '@/components/ui/feedback-state';
import { AppHeader } from '@/components/ui/app-header';
import { useChat } from '@/features/chat/use-chat';
import { createBottomFollowPolicy } from '@/features/chat/消息贴底策略';
import { new会话, retry会话, useConversationStore } from '@/features/chat/会话管理';
import { useChatStore } from '@/store/chat-store';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

import { ChatInput } from './chat-input';
import { ConnectionStatus } from './connection-status';
import { MessageBubble } from './message-bubble';

export function ChatScreen() {
  const listRef = useRef<FlatList>(null);
  const scrollFrameRef = useRef<number | undefined>(undefined);
  const [scrollNotice, setScrollNotice] = useState({ revision: -1, visible: false });
  const openedPrivacyIdRef = useRef<string | undefined>(undefined);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const messages = useChatStore((state) => state.messages);
  const sessionId = useChatStore((state) => state.sessionId);
  const sessionRevision = useChatStore((state) => state.sessionRevision);
  const scrollPolicy = useMemo(createBottomFollowPolicy, [sessionRevision]);
  const ready = useConversationStore((state) => state.ready);
  const opening = useConversationStore((state) => state.opening);
  const error = useConversationStore((state) => state.error);
  const isThinking = useChatStore((state) => state.isThinking);
  const connectionStatus = useChatStore((state) => state.connectionStatus);
  const privacyDecision = useChatStore((state) => state.privacyDecision);
  const { sendMessage, stopStreaming, isStreaming } = useChat();
  const horizontalPadding = width <= 340 ? spacing.md : spacing.page;
  const showLatest = scrollNotice.revision === sessionRevision && scrollNotice.visible;

  useEffect(() => {
    openedPrivacyIdRef.current = undefined;
    return () => {
      if (scrollFrameRef.current !== undefined) cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = undefined;
    };
  }, [sessionRevision]);

  function scrollToLatest() {
    scrollPolicy.follow();
    setScrollNotice({ revision: sessionRevision, visible: false });
    scheduleFollow();
  }

  function scheduleFollow() {
    if (!scrollPolicy.needsFollow || scrollFrameRef.current !== undefined) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = undefined;
      if (scrollPolicy.needsFollow) listRef.current?.scrollToOffset({ offset: scrollPolicy.bottomOffset, animated: false });
    });
  }

  useEffect(() => {
    if (!privacyDecision || openedPrivacyIdRef.current === privacyDecision.egress_id) return;
    openedPrivacyIdRef.current = privacyDecision.egress_id;
    router.push('/privacy-decision');
  }, [privacyDecision, router]);

  return (
    <KeyboardAvoidingView
      enabled={Platform.OS === 'ios'}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
      style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <AppHeader
          brand title="伙伴"
          leadingAction={{ icon: 'history', accessibilityLabel: '历史对话', onPress: () => router.push('/sessions') }}
          trailing={<AppButton icon="add" variant="icon" accessibilityLabel="新建对话" disabled={opening || !ready} onPress={() => void new会话()} />}
        />
        <View style={{ paddingHorizontal: horizontalPadding, paddingBottom: spacing.xs }}><ConnectionStatus /></View>
        {!ready || opening ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <FeedbackState
              type={error && !opening ? 'error' : 'loading'}
              title={error && !opening ? '暂时无法恢复对话' : '正在恢复对话'}
              description={error && !opening ? error : '正在读取历史消息和回复状态。'}
              actionLabel={error && !opening ? '重试' : undefined}
              onAction={() => void retry会话()}
            />
          </View>
        ) : (
        <>
        <View style={{ flex: 1, minHeight: 0 }}>
        <FlatList
          key={sessionRevision}
          ref={listRef}
          style={{ flex: 1 }}
          contentInsetAdjustmentBehavior="automatic"
          data={messages}
          keyExtractor={(item) => item.id}
          keyboardDismissMode={process.env.EXPO_OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            gap: spacing.md,
            paddingHorizontal: horizontalPadding,
            paddingTop: spacing.lg,
            paddingBottom: spacing.lg,
          }}
          scrollEventThrottle={16}
          onScrollBeginDrag={() => scrollPolicy.pause()}
          onScrollEndDrag={() => { scrollPolicy.finishGesture(); scheduleFollow(); }}
          onTouchMove={() => scrollPolicy.pause()}
          onTouchEnd={() => { scrollPolicy.finishGesture(); scheduleFollow(); }}
          {...(Platform.OS === 'web' ? {
            onWheel: (event: { deltaY: number }) => scrollPolicy.onWheel(event.deltaY),
            onKeyDown: (event: { key: string }) => {
              if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) scrollPolicy.pause();
            },
            onKeyUp: () => { scrollPolicy.finishGesture(); scheduleFollow(); },
          } : {})}
          onLayout={({ nativeEvent }) => { scrollPolicy.onViewport(nativeEvent.layout.height); scheduleFollow(); }}
          onScroll={({ nativeEvent }) => {
            const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
            scrollPolicy.onScroll({ offset: contentOffset.y, contentHeight: contentSize.height, viewportHeight: layoutMeasurement.height });
            if (scrollPolicy.following) setScrollNotice((current) => current.visible ? { revision: sessionRevision, visible: false } : current);
          }}
          onContentSizeChange={(_width, height) => {
            scrollPolicy.onContentSize(height);
            if (scrollPolicy.following) scheduleFollow();
            else setScrollNotice({ revision: sessionRevision, visible: true });
          }}
          renderItem={({ item }) => <MessageBubble message={item} />}
          ListHeaderComponent={
            privacyDecision || (__DEV__ && connectionStatus !== 'connected') ? (
              <View style={{ gap: spacing.xs }}>
                {privacyDecision ? (
                  <View
                    style={{
                      alignItems: 'center',
                      backgroundColor: colors.warningSoft,
                      borderRadius: radius.medium,
                      flexDirection: 'row',
                      gap: spacing.sm,
                      padding: spacing.md,
                    }}>
                    <Text maxFontSizeMultiplier={2} style={[typography.body, { color: colors.warning, flex: 1 }]}>
                      回复正在等待发送前隐私检查。
                    </Text>
                    <AppButton onPress={() => router.push('/privacy-decision')} size="sm" title="去处理" variant="secondary" />
                  </View>
                ) : null}
                {__DEV__ && connectionStatus !== 'connected' ? (
                  <Text maxFontSizeMultiplier={2} selectable style={[typography.caption, { color: colors.textSecondary }]}>
                    服务地址：{apiConfig.serverUrlDisplay ?? '未配置'}
                  </Text>
                ) : null}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={{ flex: 1, justifyContent: 'center', paddingBottom: 56 }}>
              <FeedbackState
                description={null}
                title="输入一件想梳理或推进的事。"
                type="empty"
              />
            </View>
          }
          ListFooterComponent={
            isThinking ? (
              <View
                accessibilityLiveRegion="polite"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.xs,
                  paddingVertical: spacing.xs,
                }}>
                <ActivityIndicator color={colors.brand500} size="small" />
                <Text selectable style={{ color: colors.textSecondary, ...typography.label }}>
                  伙伴正在思考
                </Text>
              </View>
            ) : null
          }
        />
        {showLatest ? <View pointerEvents="box-none" style={{ position: 'absolute', bottom: spacing.sm, left: 0, right: 0, alignItems: 'center' }}><AppButton title="回到最新消息" size="sm" variant="secondary" style={{ alignSelf: 'center' }} onPress={scrollToLatest} /></View> : null}
        </View>
        <View
          style={{
            paddingHorizontal: horizontalPadding,
            paddingTop: 4,
            paddingBottom: Math.max(insets.bottom, spacing.sm),
          }}>
          <ChatInput key={sessionId} isStreaming={isStreaming} onSend={sendMessage} onCancel={stopStreaming} />
        </View>
        </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
