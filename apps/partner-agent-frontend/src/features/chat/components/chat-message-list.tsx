import { ScrollView, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { EmptyChatState } from './empty-chat-state';
import type { ChatItem, PrivacyDecisionStatus } from '@partner-agent/contracts';
import type { ChatMessage } from '@/store/chat-store';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

import { ChatItemBubble, MessageBubble, type ChatItemBubbleActions } from './message-bubble';
import type { MessageScrollController } from '../use-message-scroll';

interface ChatMessageListProps {
  messages: ChatMessage[];
  items?: ChatItem[];
  privacyDecision?: PrivacyDecisionStatus;
  horizontalPadding: number;
  scroll: MessageScrollController;
  onPrivacyPress: () => void;
  itemActions?: ChatItemBubbleActions;
}

export function ChatMessageList({ messages, items, privacyDecision, horizontalPadding, scroll, onPrivacyPress, itemActions }: ChatMessageListProps) {
  return (
    <ScrollView
      ref={(node) => scroll.attachScrollView(node)}
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1, gap: spacing.md, paddingHorizontal: horizontalPadding, paddingTop: spacing.lg, paddingBottom: spacing.lg }}
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
          <View style={{ alignItems: 'center', backgroundColor: colors.warningSoft, borderRadius: radius.medium, flexDirection: 'row', gap: spacing.sm, padding: spacing.md }}>
            <Text maxFontSizeMultiplier={2} style={[typography.body, { color: colors.warning, flex: 1 }]}>回复正在等待发送前隐私检查。</Text>
            <AppButton onPress={onPrivacyPress} size="sm" title="去处理" variant="secondary" />
          </View>
        ) : null}
      </View>

      {(items?.length ?? messages.length) === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', paddingBottom: 56 }}>
          <EmptyChatState />
        </View>
      ) : null}

      {items !== undefined ? items.map((item) => <ChatItemBubble key={item.id} item={item} actions={itemActions} />) : messages.map((item) => <MessageBubble key={item.id} message={item} />)}

    </ScrollView>
  );
}


