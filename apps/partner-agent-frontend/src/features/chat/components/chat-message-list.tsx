import { useMemo, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { ScrollView, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { EmptyChatState } from './empty-chat-state';
import type { ChatItem, PrivacyDecisionStatus, SessionToolView } from '@partner-agent/contracts';
import { findSessionToolViewForItem } from '@/store/chat-store';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

import { ChatItemBubble, type ChatItemBubbleActions } from './message-bubble';
import { ThinkingCard } from './thinking-card';
import type { MessageScrollController } from '../use-message-scroll';
import { buildQuestionAnchors } from './question-anchor-model';
import { QuestionAnchorNavigator } from './question-anchor-navigator';
import { CandidateSelectionFlow, buildCandidateQuestionPages } from './candidate-selection-flow';

interface ChatMessageListProps {
  items: ChatItem[];
  toolViews: SessionToolView[];
  isThinking?: boolean;
  privacyDecision?: PrivacyDecisionStatus;
  horizontalPadding: number;
  scroll: MessageScrollController;
  onPrivacyPress: () => void;
  itemActions?: ChatItemBubbleActions;
  onCandidateAnswers?: (message: string) => Promise<boolean>;
}

export function ChatMessageList({ items, toolViews, isThinking = false, privacyDecision, horizontalPadding, scroll, onPrivacyPress, itemActions, onCandidateAnswers }: ChatMessageListProps) {
  const anchors = useMemo(() => buildQuestionAnchors(items), [items]);
  const candidatePages = useMemo(() => buildCandidateQuestionPages(items), [items]);
  const candidateChoiceIds = useMemo(() => new Set(candidatePages.flatMap((page) =>
    page.itemIds)), [candidatePages]);
  const candidateAnchorId = candidatePages[0]?.anchorItemId;
  const [anchorPositions, setAnchorPositions] = useState<Record<string, number>>({});
  const [activeAnchorId, setActiveAnchorId] = useState<string>();
  const hasThinkingItem = items.some((item) => item.type === 'thinking');
  const showThinkingPlaceholder = isThinking && !hasThinkingItem;
  const activeAssistantIndex = showThinkingPlaceholder
    ? items.findIndex((item) => item.type === 'message'
      && item.payload.role === 'assistant' && item.status === 'streaming')
    : -1;
  const thinkingPlaceholderIndex = activeAssistantIndex >= 0 ? activeAssistantIndex : items.length;
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scroll.handleScroll(event);
    const readingLine = event.nativeEvent.contentOffset.y + 64;
    let current = anchors[0]?.id;
    for (const anchor of anchors) {
      const position = anchorPositions[anchor.id];
      if (position !== undefined && position <= readingLine) current = anchor.id;
    }
    if (current) setActiveAnchorId((value) => value === current ? value : current);
  };
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
      ref={(node) => scroll.attachScrollView(node)}
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1, gap: spacing.md, paddingLeft: horizontalPadding + (anchors.length > 1 ? 12 : 0), paddingRight: horizontalPadding, paddingTop: spacing.lg, paddingBottom: spacing.lg }}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={scroll.handleContentSizeChange}
      onLayout={scroll.handleLayout}
      onScroll={handleScroll}
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

      {items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', paddingBottom: 56 }}>
          <EmptyChatState />
        </View>
      ) : null}

      {items.map((item, index) => candidateChoiceIds.has(item.id) ? (
        item.id === candidateAnchorId && onCandidateAnswers ? (
          <CandidateSelectionFlow key={candidatePages.map((page) => page.id).join(':')}
            pages={candidatePages} onSubmit={onCandidateAnswers} />
        ) : null
      ) : (
        <View key={item.id} onLayout={item.type === 'message' && item.payload.role === 'user'
          ? (event) => {
              const y = event.nativeEvent.layout.y;
              setAnchorPositions((current) => current[item.id] === y
                ? current : { ...current, [item.id]: y });
            }
          : undefined}>
          {showThinkingPlaceholder && index === thinkingPlaceholderIndex ? (
            <ThinkingCard content="正在理解你的问题…" streaming />
          ) : null}
          <ChatItemBubble
            item={item}
            actions={{ ...itemActions, onCardLayoutChange: scroll.preserveNextContentResize }}
            toolView={findSessionToolViewForItem(toolViews, item)}
          />
        </View>
      ))}

      {showThinkingPlaceholder && thinkingPlaceholderIndex === items.length ? (
        <ThinkingCard content="正在理解你的问题…" streaming />
      ) : null}

      </ScrollView>
      <QuestionAnchorNavigator anchors={anchors} activeId={activeAnchorId ?? anchors[0]?.id}
        onSelect={(id) => {
          const position = anchorPositions[id];
          if (position !== undefined) scroll.scrollToOffset(position - spacing.sm);
          setActiveAnchorId(id);
        }} />
    </View>
  );
}


