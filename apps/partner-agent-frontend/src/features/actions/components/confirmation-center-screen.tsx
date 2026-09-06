import { useEffect } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { useActionStore } from '../store/action-store';

export function ConfirmationCenterScreen() {
  const router = useRouter();
  const pending = useActionStore((state) => state.pendingBatches);
  const history = useActionStore((state) => state.confirmationHistory);
  const refreshPending = useActionStore((state) => state.refreshPendingBatches);
  const loadHistory = useActionStore((state) => state.loadConfirmationHistory);
  useEffect(() => { void Promise.all([refreshPending(), loadHistory()]); }, [loadHistory, refreshPending]);

  const refresh = () => { void Promise.all([refreshPending(), loadHistory()]); };
  return (
    <ScrollView contentContainerStyle={{ gap: spacing.lg, padding: spacing.lg, paddingBottom: 120 }} refreshControl={<RefreshControl refreshing={pending.phase === 'loading'} onRefresh={refresh} />}>
      <View style={{ gap: spacing.xs }}><Text style={typography.pageTitle}>确认中心</Text><Text style={[typography.body, { color: colors.textSecondary }]}>候选内容尚未生效。你可以先检查和编辑，再整批提交。</Text></View>
      {pending.phase === 'loading' && !pending.data ? <ActivityIndicator color={colors.brand500} /> : null}
      {pending.phase === 'error' ? <View style={{ gap: spacing.sm }}><Text style={{ color: colors.danger }}>{pending.errorMessage}</Text><AppButton title="重试" onPress={() => { void refreshPending(); }} /></View> : null}
      {pending.phase === 'ready' && pending.data?.length === 0 ? <Text style={[typography.body, { color: colors.textSecondary }]}>当前没有待确认内容。</Text> : null}
      <View style={{ gap: spacing.sm }}>
        {pending.data?.map((batch) => <Pressable key={batch.batch_id} accessibilityRole="button" onPress={() => router.push(`/confirmations/${batch.batch_id}` as never)} style={{ backgroundColor: colors.surface, borderColor: batch.risk === 'high' ? colors.toastWarningBorder : colors.border, borderRadius: radius.medium, borderWidth: 1, gap: spacing.xs, padding: spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={typography.sectionTitle}>{batch.item_count} 个行动候选</Text><Text style={[typography.caption, { color: batch.risk === 'high' ? colors.warning : colors.success }]}>{batch.risk === 'high' ? '高风险' : '普通'}</Text></View>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>有效期至 {new Date(batch.expires_at).toLocaleString('zh-CN', { hour12: false })}</Text>
        </Pressable>)}
      </View>
      {(history.data?.length ?? 0) > 0 ? <View style={{ gap: spacing.sm }}><Text style={typography.sectionTitle}>最近确认</Text>{history.data!.slice(0, 5).map((item) => <Text key={item.confirmation_action_id} style={[typography.caption, { color: colors.textSecondary }]}>{new Date(item.created_at).toLocaleString('zh-CN', { hour12: false })} · {item.action_type} · {item.object_refs.length} 项</Text>)}</View> : null}
    </ScrollView>
  );
}
