import React from 'react';
import { Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

import { ChatItemCard } from './chat-item-card';
import type { CandidateDisplay, CandidatePreviewAction, CandidatePreviewDecision } from './chat-item-types';

export type CandidateCardProps = CandidateDisplay & {
  candidateId?: string;
  onOpen?: () => void;
  onDecision?: (decision: CandidatePreviewDecision) => void;
  onLayoutChangeIntent?: () => void;
  plannedAt?: string;
  deadlineAt?: string;
  timezone?: string;
};

type CandidatePreview = { title: string; candidateType?: string; summary?: string; details?: string };

export function createCandidatePreview({ title, candidateType, summary, details }: CandidateDisplay): CandidatePreview {
  return { title, ...(candidateType ? { candidateType } : {}), ...(summary ? { summary } : {}), ...(details ? { details } : {}) };
}

export function compactCandidateText(value?: string): string | undefined {
  if (!value) return undefined;
  const sanitized = value.replace(/[（(][^）)]*(?:待用户|候选|preview|applied:false)[^）)]*[）)]/gi, '');
  const useful = sanitized.split(/[。！？\n]/).map((part) => part.trim()).filter((part) => part
    && !/(?:默认时区|默认优先级|仅为|候选预览|applied:false|preview)/i.test(part));
  const text = useful[0] ?? sanitized.trim();
  return text ? `${text.slice(0, 96)}${text.length > 96 ? '…' : '。'}` : undefined;
}

export function formatCandidateDateTime(value?: string, timeZone?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
      hour12: false, ...(timeZone ? { timeZone } : {}),
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
    const month = part('month');
    const day = part('day');
    const weekday = part('weekday');
    const hour = part('hour');
    const minute = part('minute');
    return month && day && weekday && hour && minute
      ? `${month}月${day}日 ${weekday} ${hour}:${minute}` : undefined;
  } catch {
    return undefined;
  }
}

function CandidatePreviewEditor({ preview, candidateId, onDecision, onLayoutChangeIntent }: { preview: CandidatePreview; candidateId?: string; onDecision?: CandidateCardProps['onDecision']; onLayoutChangeIntent?: () => void }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(preview);

  const update = (field: keyof CandidatePreview, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const apply = () => {
    if (candidateId && onDecision) onDecision({ candidateId, action: 'modify', applied: false, preview: draft });
    onLayoutChangeIntent?.();
    setEditing(false);
  };

  const cancel = () => {
    onLayoutChangeIntent?.();
    setDraft(preview);
    setEditing(false);
  };

  const edit = () => {
    onLayoutChangeIntent?.();
    setEditing(true);
  };

  return editing ? (
    <View accessibilityLabel="候选预览编辑器" style={{ gap: 8 }}>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>调整后会作为你的补充意见继续处理。</Text>
      <TextInput accessibilityLabel="预览标题" value={draft.title} onChangeText={(value) => update('title', value)} style={{ backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.medium, borderWidth: 1, color: colors.ink, minHeight: 40, paddingHorizontal: spacing.md }} />
      <TextInput accessibilityLabel="预览摘要" value={draft.summary ?? ''} onChangeText={(value) => update('summary', value)} multiline style={{ backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.medium, borderWidth: 1, color: colors.ink, minHeight: 64, padding: spacing.md }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <AppButton accessibilityLabel="取消预览编辑" onPress={cancel} size="sm" title="取消" variant="secondary" />
        <AppButton accessibilityLabel="应用预览草稿" onPress={apply} size="sm" title="应用预览" variant="primary" />
      </View>
    </View>
  ) : (
    <AppButton accessibilityLabel="编辑候选内容" onPress={edit} size="sm" title="编辑" variant="secondary" />
  );
}

export function CandidateCard({ title, summary, details, candidateType, candidateId, onOpen, onDecision, onLayoutChangeIntent, plannedAt, deadlineAt, timezone }: CandidateCardProps) {
  const preview = createCandidatePreview({ title, summary, details, candidateType });
  const conciseSummary = compactCandidateText(summary ?? details);
  const plannedTime = formatCandidateDateTime(plannedAt, timezone);
  const deadlineTime = formatCandidateDateTime(deadlineAt, timezone);
  const distinctDeadline = deadlineTime && deadlineTime !== plannedTime ? deadlineTime : undefined;
  const emitDecision = (action: CandidatePreviewAction) => {
    if (!candidateId || !onDecision) return;
    onDecision({ candidateId, action, applied: false, preview });
  };

  return (
    <ChatItemCard accessory={onOpen ? <Text accessibilityRole="button" onPress={onOpen} style={[typography.label, { color: colors.brand600 }]}>查看</Text> : null} previewOnly={false} subtitle={candidateType} title={title} tone="candidate">
      <View style={{ gap: spacing.sm }}>
        {conciseSummary ? <Text numberOfLines={3} selectable style={[typography.body, { color: colors.textSecondary }]}>{conciseSummary}</Text> : null}
        {plannedTime || distinctDeadline ? (
          <View style={{ alignItems: 'flex-start', backgroundColor: colors.surfaceSubtle,
            borderCurve: 'continuous', borderRadius: radius.medium, flexDirection: 'row',
            gap: spacing.sm, padding: spacing.sm }}>
            <AppIcon decorative color={colors.brand500} name="clock" size={17} />
            <View style={{ flex: 1, gap: spacing.xxs }}>
              {plannedTime ? <Text selectable style={[typography.bodyStrong, { color: colors.ink }]}>{plannedTime}</Text> : null}
              {distinctDeadline ? <Text selectable style={[typography.caption, { color: colors.textSecondary }]}>截止 {distinctDeadline}</Text> : null}
            </View>
          </View>
        ) : null}
        <Text style={[typography.caption, { color: colors.brand600 }]}>待确认 · 尚未生效</Text>
        <CandidatePreviewEditor candidateId={candidateId} onDecision={onDecision} onLayoutChangeIntent={onLayoutChangeIntent} preview={preview} />
        {candidateId && onDecision ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <AppButton onPress={() => emitDecision('confirm')} size="sm" title="确认" variant="primary" />
          <AppButton onPress={() => emitDecision('modify')} size="sm" title="修改" variant="secondary" />
          <AppButton onPress={() => emitDecision('reject')} size="sm" title="拒绝" variant="danger" />
          <AppButton onPress={() => emitDecision('later')} size="sm" title="稍后处理" variant="secondary" />
        </View> : null}
      </View>
    </ChatItemCard>
  );
}

