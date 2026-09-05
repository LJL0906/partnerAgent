import { FlatList, Pressable, Text, View } from 'react-native';
import { useEffect } from 'react';
import { useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { FeedbackState } from '@/components/ui/feedback-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { open会话, new会话, refresh会话列表, useConversationStore } from '@/features/chat/会话管理';
import { useChatStore } from '@/store/chat-store';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export function ConversationList() {
  const router = useRouter();
  const sessions = useConversationStore((state) => state.sessions);
  const loading = useConversationStore((state) => state.loading);
  const opening = useConversationStore((state) => state.opening);
  const error = useConversationStore((state) => state.error);
  const selectedId = useChatStore((state) => state.sessionId);

  useEffect(() => { void refresh会话列表(); }, []);

  async function open(id: string) {
    if (await open会话(id)) router.back();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{ padding: spacing.page, gap: spacing.sm }}>
        <AppButton
          fullWidth icon="add" title="新建对话" disabled={opening}
          onPress={() => { void new会话(); router.back(); }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text style={[typography.caption, { color: colors.textSecondary, flex: 1 }]}>选择一段对话，接着上次的话题聊。</Text>
          <AppButton title="刷新" accessibilityLabel="刷新历史对话" icon="refresh" variant="tertiary" size="sm" disabled={loading || opening} onPress={() => void refresh会话列表()} />
        </View>
      </View>
      {error ? (
        <View accessibilityRole="alert" style={{ paddingHorizontal: spacing.page, paddingBottom: spacing.md, gap: spacing.xs }}>
          <Text style={[typography.body, { color: colors.danger }]}>{error}</Text>
          <AppButton title="重新加载列表" variant="secondary" size="sm" onPress={() => void refresh会话列表()} />
        </View>
      ) : null}
      {opening ? <Text accessibilityLiveRegion="polite" style={[typography.label, { color: colors.brand500, paddingHorizontal: spacing.page, paddingBottom: spacing.sm }]}>正在打开对话…</Text> : null}
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        refreshing={loading}
        onRefresh={() => void refresh会话列表()}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: spacing.page, paddingBottom: spacing.xl, gap: spacing.sm }}
        ListEmptyComponent={loading
          ? <FeedbackState type="loading" title="正在加载对话" description={null} />
          : !error ? <FeedbackState type="empty" title="还没有历史对话" description="发送第一条消息后，对话会保存在这里。" /> : null}
        renderItem={({ item }) => {
          const selected = item.id === selectedId;
          const title = item.title || '未命名对话';
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`打开对话：${title}`}
              accessibilityState={{ selected, disabled: opening }}
              disabled={opening}
              onPress={() => void open(item.id)}
              style={({ pressed }) => ({
                backgroundColor: selected ? colors.infoSoft : colors.surface,
                borderColor: selected ? colors.brand400 : colors.border,
                borderWidth: 1, borderRadius: radius.large,
                padding: spacing.md, gap: spacing.sm, opacity: pressed ? 0.75 : 1,
              })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <AppIcon decorative name="assistant" color={selected ? colors.brand500 : colors.textSecondary} size={20} />
                <Text numberOfLines={2} style={[typography.sectionTitle, { color: colors.ink, flex: 1 }]}>{title}</Text>
                {selected ? <StatusBadge label="当前" tone="info" /> : null}
              </View>
              {item.last_message_preview ? <Text numberOfLines={2} style={[typography.body, { color: colors.textSecondary }]}>{item.last_message_preview}</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' }}>
                <Text style={[typography.caption, { color: colors.textSecondary }]}>{new Date(item.updated_at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text>
                {item.active_task ? <StatusBadge label="有进行中的回复" tone="warning" /> : null}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
