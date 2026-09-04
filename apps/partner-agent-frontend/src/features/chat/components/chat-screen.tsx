import { useRef } from 'react';
import { FlatList, KeyboardAvoidingView, Text, View } from 'react-native';

import { useChat } from '@/features/chat/use-chat';
import { useChatStore } from '@/store/chat-store';
import { colors } from '@/theme/colors';

import { ChatInput } from './chat-input';
import { ConnectionStatus } from './connection-status';
import { MessageBubble } from './message-bubble';

export function ChatScreen() {
  const listRef = useRef<FlatList>(null);
  const messages = useChatStore((state) => state.messages);
  const isThinking = useChatStore((state) => state.isThinking);
  const { sendMessage, stopStreaming, isStreaming } = useChat();

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={92}
      style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1 }}>
        <View style={{ alignItems: 'flex-end', paddingHorizontal: 20, paddingTop: 8 }}>
          <ConnectionStatus />
        </View>
        <FlatList
          ref={listRef}
          contentInsetAdjustmentBehavior="automatic"
          data={messages}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            gap: 14,
            paddingHorizontal: 20,
            paddingTop: 22,
            paddingBottom: 18,
          }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => <MessageBubble message={item} />}
          ListEmptyComponent={
            <View style={{ flex: 1, justifyContent: 'center', gap: 12, paddingBottom: 80 }}>
              <Text
                selectable
                style={{ color: colors.text, fontSize: 28, fontWeight: '700', textAlign: 'center' }}>
                今天想从哪里开始？
              </Text>
              <Text
                selectable
                style={{ color: colors.textSecondary, fontSize: 16, lineHeight: 24, textAlign: 'center' }}>
                我可以陪你梳理想法，也可以一起推进具体行动。
              </Text>
            </View>
          }
          ListFooterComponent={
            isThinking ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ai }} />
                <Text selectable style={{ color: colors.ai, fontSize: 14 }}>
                  正在思考
                </Text>
              </View>
            ) : null
          }
        />
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <ChatInput isStreaming={isStreaming} onSend={sendMessage} onCancel={stopStreaming} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
