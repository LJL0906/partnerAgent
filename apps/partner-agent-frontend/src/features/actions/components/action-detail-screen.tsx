import { useEffect } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { useActionStore } from '../store/action-store';

export function ActionDetailScreen() {
  const { actionId } = useLocalSearchParams<{ actionId: string }>();
  const router = useRouter();
  const detail = useActionStore((state) => state.actionDetails[actionId]);
  const history = useActionStore((state) => state.actionHistory[actionId]);
  const eligibility = useActionStore((state) => state.undoEligibility[actionId]);
  const undoMutation = useActionStore((state) => state.undoMutation);
  const loadAction = useActionStore((state) => state.loadAction);
  const loadHistory = useActionStore((state) => state.loadActionHistory);
  const loadEligibility = useActionStore((state) => state.loadUndoEligibility);
  const createUndo = useActionStore((state) => state.createUndoCandidate);
  useEffect(() => { if (actionId) void Promise.all([loadAction(actionId), loadHistory(actionId), loadEligibility(actionId)]); }, [actionId, loadAction, loadEligibility, loadHistory]);
  if (!detail?.data || detail.phase === 'loading') return <ActivityIndicator color={colors.brand500} style={{ flex: 1 }} />;
  const action = detail.data;
  return <ScrollView contentContainerStyle={{ gap: spacing.md, padding: spacing.lg, paddingBottom: 120 }}>
    <View style={{ gap: spacing.xs }}><Text style={typography.pageTitle}>{action.title}</Text>{action.description ? <Text style={[typography.body, { color: colors.textSecondary }]}>{action.description}</Text> : null}</View>
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.medium, gap: spacing.sm, padding: spacing.md }}>
      <Field label="执行状态" value={action.execution_status} /><Field label="计划状态" value={action.plan_status} /><Field label="时效状态" value={action.timeliness_status} /><Field label="版本" value={action.version} />
      {action.deadline_at ? <Field label="截止时间" value={new Date(action.deadline_at).toLocaleString('zh-CN', { hour12: false })} /> : null}
      {action.priority ? <Field label="优先级" value={action.priority} /> : null}{action.timezone ? <Field label="时区" value={action.timezone} /> : null}
    </View>
    <View style={{ gap: spacing.sm }}><Text style={typography.sectionTitle}>来源</Text>{action.source_refs.map((ref) => <Text key={`${ref.kind}:${ref.id}`} style={[typography.caption, { color: colors.textSecondary }]}>{ref.kind} · {ref.id}</Text>)}</View>
    <View style={{ gap: spacing.sm }}><Text style={typography.sectionTitle}>变更历史</Text>{history?.data?.map((item) => <Text key={item.change_id} style={[typography.caption, { color: colors.textSecondary }]}>v{item.object_version} · {item.change_type} · {new Date(item.created_at).toLocaleString('zh-CN', { hour12: false })}</Text>)}</View>
    {eligibility?.data?.eligible ? <AppButton loading={undoMutation.phase === 'submitting'} title="生成整批撤销候选" variant="danger" onPress={async () => { const batchId = await createUndo(eligibility.data!); if (batchId) router.push(`/confirmations/${batchId}` as never); }} /> : <Text style={[typography.caption, { color: colors.textTertiary }]}>当前不可撤销{eligibility?.data?.blocking_reasons[0]?.message ? `：${eligibility.data.blocking_reasons[0].message}` : ''}</Text>}
  </ScrollView>;
}

function Field({ label, value }: { label: string; value: string }) { return <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={[typography.body, { color: colors.textSecondary }]}>{label}</Text><Text style={typography.body}>{value}</Text></View>; }
