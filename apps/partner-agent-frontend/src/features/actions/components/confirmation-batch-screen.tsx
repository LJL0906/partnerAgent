import type { CandidateDetail, ConfirmationItem } from '@partner-agent/contracts';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { useActionStore } from '../store/action-store';

export function ConfirmationBatchScreen() {
  const { batchId } = useLocalSearchParams<{ batchId: string }>();
  const router = useRouter();
  const state = useActionStore((store) => store.batches[batchId]);
  const drafts = useActionStore((store) => store.candidateDrafts);
  const mutation = useActionStore((store) => store.confirmationMutation);
  const loadBatch = useActionStore((store) => store.loadBatch);
  const setDraft = useActionStore((store) => store.setCandidateDraft);
  const submit = useActionStore((store) => store.submitConfirmation);
  const [highRiskArmed, setHighRiskArmed] = useState(false);
  useEffect(() => { if (batchId) void loadBatch(batchId); }, [batchId, loadBatch]);
  const batch = state?.data;
  const active = useMemo(() => batch?.candidates.filter((item) => item.status === 'pending') ?? [], [batch]);

  async function submitDecision(decision: 'confirm' | 'cancel') {
    if (!batch) return;
    if (decision === 'confirm' && batch.risk === 'high' && !highRiskArmed) { setHighRiskArmed(true); return; }
    const items: ConfirmationItem[] = active.map((candidate) => decisionItem(candidate, drafts[candidate.candidate_ref.id], decision, batch.risk === 'high'));
    if (await submit({ confirmation_batch_id: batch.batch_ref.id, batch_version: batch.batch_version, items })) {
      router.replace(decision === 'confirm' ? '/execute' as never : '/confirmations' as never);
    }
  }

  if (!batch || state?.phase === 'loading') return <ActivityIndicator color={colors.brand500} style={{ flex: 1 }} />;
  if (state.phase === 'error') return <View style={{ gap: spacing.md, padding: spacing.lg }}><Text style={{ color: colors.danger }}>{state.errorMessage}</Text><AppButton title="重试" onPress={() => { void loadBatch(batchId); }} /></View>;
  return (
    <ScrollView contentContainerStyle={{ gap: spacing.md, padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: spacing.xs }}><Text style={typography.pageTitle}>确认行动</Text><Text style={[typography.body, { color: colors.textSecondary }]}>确认前可以修改允许编辑的字段。提交后才会成为正式行动。</Text></View>
      {batch.risk === 'high' ? <View style={{ backgroundColor: colors.warningSoft, borderRadius: radius.medium, padding: spacing.md }}><Text style={[typography.label, { color: colors.warning }]}>高风险批次</Text><Text style={[typography.caption, { color: colors.textSecondary }]}>需要再次点击确认，明确知晓该批次的影响。</Text></View> : null}
      {active.map((candidate) => <CandidateEditor key={candidate.candidate_ref.id} candidate={candidate} draft={drafts[candidate.candidate_ref.id]} onChange={(draft) => setDraft(candidate.candidate_ref.id, draft)} />)}
      {mutation.errorMessage ? <Text style={{ color: mutation.phase === 'conflict' ? colors.warning : colors.danger }}>{mutation.errorMessage}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <AppButton loading={mutation.phase === 'submitting'} title={batch.risk === 'high' && highRiskArmed ? '再次确认并生效' : '全部确认'} onPress={() => { void submitDecision('confirm'); }} />
        <AppButton disabled={mutation.phase === 'submitting'} title="取消整批" variant="danger" onPress={() => { void submitDecision('cancel'); }} />
      </View>
    </ScrollView>
  );
}

function CandidateEditor({ candidate, draft, onChange }: { candidate: CandidateDetail; draft?: Record<string, unknown>; onChange: (draft: Record<string, unknown>) => void }) {
  const content = { ...candidate.content, ...draft };
  const canEdit = (field: string) => candidate.editable_fields.includes(field);
  return <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.medium, borderWidth: 1, gap: spacing.sm, padding: spacing.md }}>
    <Text style={[typography.caption, { color: colors.brand600 }]}>行动候选 · 置信度 {Math.round(candidate.confidence * 100)}%</Text>
    <TextInput editable={canEdit('title')} onChangeText={(title) => onChange({ ...draft, title })} placeholder="行动标题" style={{ borderBottomColor: colors.divider, borderBottomWidth: 1, color: colors.ink, fontSize: 18, paddingVertical: spacing.sm }} value={String(content.title ?? '')} />
    <TextInput editable={canEdit('description')} multiline onChangeText={(description) => onChange({ ...draft, description })} placeholder="补充说明（可选）" style={{ color: colors.ink, minHeight: 72, textAlignVertical: 'top' }} value={String(content.description ?? '')} />
    <Text style={[typography.caption, { color: colors.textTertiary }]}>版本 {candidate.candidate_version} · {candidate.risk === 'high' ? '高风险' : '普通风险'}</Text>
  </View>;
}

function decisionItem(candidate: CandidateDetail, draft: Record<string, unknown> | undefined, decision: 'confirm' | 'cancel', highRisk: boolean): ConfirmationItem {
  const changed = draft !== undefined && Object.keys(draft).length > 0;
  return {
    candidate_id: candidate.candidate_ref.id,
    candidate_version: candidate.candidate_version,
    decision: decision === 'confirm' && changed ? 'modify_confirm' : decision,
    ...(decision === 'confirm' && changed ? { modified_payload: draft } : {}),
    ...(candidate.target_object_ref ? { target_object_id: candidate.target_object_ref.id } : {}),
    ...(candidate.expected_target_version ? { expected_target_version: candidate.expected_target_version } : {}),
    ...(highRisk ? { risk_acknowledged: true } : {}),
  };
}
