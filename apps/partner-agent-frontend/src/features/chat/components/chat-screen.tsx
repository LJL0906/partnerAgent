import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
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
  const openedPrivacyIdRef = useRef<string | undefined>(undefined);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const messages = useChatStore((state) => state.messages);
  const isThinking = useChatStore((state) => state.isThinking);
  const connectionStatus = useChatStore((state) => state.connectionStatus);
  const privacyDecision = useChatStore((state) => state.privacyDecision);
  const { sendMessage, stopStreaming, isStreaming } = useChat();
  const horizontalPadding = width <= 340 ? spacing.md : spacing.page;

  useEffect(() => {
    if (!privacyDecision || openedPrivacyIdRef.current === privacyDecision.egress_id) return;
    openedPrivacyIdRef.current = privacyDecision.egress_id;
    router.push('/privacy-decision');
  }, [privacyDecision, router]);

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
      style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{ flex: 1 }}>
        <AppHeader brand title="伙伴" trailing={<ConnectionStatus />} />
        <FlatList
          ref={listRef}
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
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
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
        <View
          style={{
            paddingHorizontal: horizontalPadding,
            paddingTop: 4,
            paddingBottom: Math.max(insets.bottom, spacing.sm),
          }}>
          <ChatInput isStreaming={isStreaming} onSend={sendMessage} onCancel={stopStreaming} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
