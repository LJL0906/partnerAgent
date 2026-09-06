import { useEffect } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { useActionStore } from '../store/action-store';

export function ActionListScreen() {
  const router = useRouter();
  const actions = useActionStore((state) => state.actions);
  const pending = useActionStore((state) => state.pendingBatches);
  const refreshActions = useActionStore((state) => state.refreshActions);
  const refreshPending = useActionStore((state) => state.refreshPendingBatches);

  useEffect(() => { void Promise.all([refreshActions(), refreshPending()]); }, [refreshActions, refreshPending]);
  const refreshing = actions.phase === 'loading' || pending.phase === 'loading';

  return (
    <ScrollView
      contentContainerStyle={{ gap: spacing.md, padding: spacing.lg, paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void Promise.all([refreshActions(), refreshPending()]); }} />}>
      <View style={{ gap: spacing.xs }}>
        <Text style={typography.pageTitle}>行动</Text>
        <Text style={[typography.body, { color: colors.textSecondary }]}>只有确认过的内容才会出现在这里。</Text>
      </View>
      {(pending.data?.length ?? 0) > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/confirmations' as never)}
          style={{ backgroundColor: colors.warningSoft, borderRadius: radius.medium, gap: spacing.xs, padding: spacing.md }}>
          <Text style={[typography.label, { color: colors.warning }]}>有 {pending.data!.length} 个确认批次待处理</Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>查看、编辑并确认后才会写入正式行动 →</Text>
        </Pressable>
      ) : null}
      {actions.phase === 'loading' && !actions.data ? <ActivityIndicator color={colors.brand500} /> : null}
      {actions.phase === 'error' ? <ErrorState message={actions.errorMessage} retry={refreshActions} /> : null}
      {actions.phase === 'ready' && actions.data?.length === 0 ? (
        <View style={{ alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.medium, gap: spacing.sm, padding: spacing.lg }}>
          <Text style={typography.sectionTitle}>还没有正式行动</Text>
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>在聊天中描述你要做的事，再到确认中心完成确认。</Text>
          <AppButton title="打开确认中心" variant="secondary" onPress={() => router.push('/confirmations' as never)} />
        </View>
      ) : null}
      {actions.data?.map((item) => (
        <Pressable
          key={item.action_ref.id}
          accessibilityRole="button"
          onPress={() => router.push(`/actions/${item.action_ref.id}` as never)}
          style={{ backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.medium, borderWidth: 1, gap: spacing.xs, padding: spacing.md }}>
          <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text numberOfLines={2} style={[typography.sectionTitle, { flex: 1 }]}>{item.title}</Text>
            <Text style={[typography.caption, { color: colors.brand600 }]}>{statusLabel(item.execution_status)}</Text>
          </View>
          {item.description ? <Text numberOfLines={3} style={[typography.body, { color: colors.textSecondary }]}>{item.description}</Text> : null}
          <Text style={[typography.caption, { color: colors.textTertiary }]}>{item.deadline_at ? `截止 ${formatDate(item.deadline_at)}` : '无截止时间'} · v{item.version}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function ErrorState({ message, retry }: { message?: string; retry: () => Promise<boolean> }) {
  return <View style={{ gap: spacing.sm }}><Text style={{ color: colors.danger }}>{message}</Text><AppButton title="重试" onPress={() => { void retry(); }} /></View>;
}
function statusLabel(value: string) { return ({ todo: '待办', in_progress: '进行中', paused: '已暂停', done: '已完成', cancelled: '已取消' } as Record<string, string>)[value] ?? value; }
function formatDate(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }); }
