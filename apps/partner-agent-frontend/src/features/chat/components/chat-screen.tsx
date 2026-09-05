import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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
import { getKeyboardAvoidingProps } from '@/features/chat/keyboard-avoiding';
import { createMessageScroll } from '@/features/chat/use-message-scroll';
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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const messages = useChatStore((state) => state.messages);
  const sessionId = useChatStore((state) => state.sessionId);
  const sessionRevision = useChatStore((state) => state.sessionRevision);
  const ready = useConversationStore((state) => state.ready);
  const opening = useConversationStore((state) => state.opening);
  const error = useConversationStore((state) => state.error);
  const isThinking = useChatStore((state) => state.isThinking);
  const connectionStatus = useChatStore((state) => state.connectionStatus);
  const privacyDecision = useChatStore((state) => state.privacyDecision);
  const { sendMessage, stopStreaming, isStreaming } = useChat();
  const horizontalPadding = width <= 340 ? spacing.md : spacing.page;
  const keyboardAvoidingProps = getKeyboardAvoidingProps(Platform.OS, insets.top);

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

  return (
    <KeyboardAvoidingView
      enabled={keyboardAvoidingProps.enabled}
      behavior={keyboardAvoidingProps.behavior}
      keyboardVerticalOffset={keyboardAvoidingProps.keyboardVerticalOffset}
      style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <AppHeader
          brand
          title="伙伴"
          leadingAction={{ icon: 'history', accessibilityLabel: '历史对话', onPress: () => router.push('/sessions') }}
          trailing={<AppButton icon="add" variant="icon" accessibilityLabel="新建对话" disabled={opening || !ready} onPress={() => void new会话()} />}
        />
        <View style={{ paddingHorizontal: horizontalPadding, paddingBottom: spacing.xs }}>
          <ConnectionStatus />
        </View>
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
              {/* key=sessionRevision:切换会话时重挂,重置贴底状态,避免串线。 */}
              <ScrollView
                ref={(node) => scroll.attachScrollView(node)}
                key={sessionRevision}
                style={{ flex: 1 }}
                contentContainerStyle={{
                  flexGrow: 1,
                  gap: spacing.md,
                  paddingHorizontal: horizontalPadding,
                  paddingTop: spacing.lg,
                  paddingBottom: spacing.lg,
                }}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                onContentSizeChange={scroll.handleContentSizeChange}
                onLayout={scroll.handleLayout}
                onScroll={scroll.handleScroll}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator
              >
                <View style={{ gap: spacing.md }}>
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

                {messages.length === 0 ? (
                  <View style={{ flex: 1, justifyContent: 'center', paddingBottom: 56 }}>
                    <FeedbackState
                      description={null}
                      title="输入一件想梳理或推进的事。"
                      type="empty"
                    />
                  </View>
                ) : null}

                {messages.map((item) => (
                  <MessageBubble key={item.id} message={item} />
                ))}

                {isThinking ? (
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
                ) : null}
              </ScrollView>

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
              <ChatInput key={sessionId} isStreaming={isStreaming} onSend={sendMessage} onCancel={stopStreaming} />
            </View>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}



