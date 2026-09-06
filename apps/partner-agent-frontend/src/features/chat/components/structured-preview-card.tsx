import type { ChatPreviewV1 } from '@partner-agent/contracts';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

import { ChatItemCard } from './chat-item-card';
import { compactCandidateText, formatCandidateDateTime } from './candidate-card';

type ClipboardWriter = (value: string) => Promise<unknown>;

export function buildStructuredPreviewCopyText(
  preview: ChatPreviewV1,
  _createdAt: number,
): string {
  const { content } = preview;
  const summary = compactCandidateText(content.description);
  const plannedTime = formatCandidateDateTime(content.planned_at, content.timezone);
  const deadlineTime = formatCandidateDateTime(content.deadline_at, content.timezone);
  const notices = [...new Set([
    content.uncertainty,
    content.risk_summary,
    ...preview.warnings.map((warning) => warning.message),
  ].filter((value): value is string => Boolean(value)))];
  const lines = [
    '待确认，尚未生效',
    `标题：${content.title}`,
    ...(summary ? [`说明：${summary}`] : []),
    ...(plannedTime ? [`计划时间：${plannedTime}`] : []),
    ...(deadlineTime && deadlineTime !== plannedTime ? [`截止时间：${deadlineTime}`] : []),
    ...(notices.length ? [`需要确认：${notices.join('；')}`] : []),
  ];
  return lines.join('\n');
}

export async function copyStructuredPreview(
  preview: ChatPreviewV1,
  createdAt: number,
  writeText: ClipboardWriter = Clipboard.setStringAsync,
): Promise<string> {
  try {
    const copied = await writeText(buildStructuredPreviewCopyText(preview, createdAt));
    if (copied === false) return '复制失败，请重试。';
    return '已复制预览内容。';
  } catch {
    return '复制失败，请重试。';
  }
}

function PreviewNotice({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ backgroundColor: colors.warningSoft, borderCurve: 'continuous',
      borderRadius: radius.medium, gap: spacing.xxs, padding: spacing.sm }}>
      <Text style={[typography.label, { color: colors.warning }]}>{label}</Text>
      <Text selectable style={[typography.caption, { color: colors.ink }]}>{value}</Text>
    </View>
  );
}

export function StructuredPreviewCard({
  preview,
  createdAt,
}: {
  preview: ChatPreviewV1;
  createdAt: number;
}) {
  const [copying, setCopying] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string>();
  const { content } = preview;
  const summary = compactCandidateText(content.description);
  const plannedTime = formatCandidateDateTime(content.planned_at, content.timezone);
  const deadlineTime = formatCandidateDateTime(content.deadline_at, content.timezone);
  const distinctDeadline = deadlineTime && deadlineTime !== plannedTime ? deadlineTime : undefined;
  const notices = [...new Set([
    content.uncertainty,
    content.risk_summary,
    ...preview.warnings.map((warning) => warning.message),
  ].filter((value): value is string => Boolean(value)))];

  const handleCopy = async () => {
    setCopying(true);
    setCopyFeedback(undefined);
    const feedback = await copyStructuredPreview(preview, createdAt);
    setCopyFeedback(feedback);
    setCopying(false);
  };

  return (
    <ChatItemCard
      defaultExpanded
      previewOnly={false}
      subtitle="行动建议"
      title={content.title}
      tone="candidate">
      {summary ? <Text numberOfLines={3} selectable style={[typography.body,
        { color: colors.textSecondary }]}>{summary}</Text> : null}
      {plannedTime || distinctDeadline ? (
        <View style={{ alignItems: 'flex-start', backgroundColor: colors.surfaceSubtle,
          borderCurve: 'continuous', borderRadius: radius.medium, flexDirection: 'row',
          gap: spacing.sm, padding: spacing.sm }}>
          <AppIcon decorative color={colors.brand500} name="clock" size={17} />
          <View style={{ flex: 1, gap: spacing.xxs }}>
            {plannedTime ? <Text selectable style={[typography.bodyStrong,
              { color: colors.ink }]}>{plannedTime}</Text> : null}
            {distinctDeadline ? <Text selectable style={[typography.caption,
              { color: colors.textSecondary }]}>截止 {distinctDeadline}</Text> : null}
          </View>
        </View>
      ) : null}
      <Text style={[typography.caption, { color: colors.brand600 }]}>待确认 · 尚未生效</Text>
      {notices.length ? <PreviewNotice label="需要确认" value={notices.join('\n')} /> : null}
      <Pressable
        accessibilityLabel="复制预览"
        accessibilityRole="button"
        disabled={copying}
        onPress={() => { void handleCopy(); }}
        style={{ alignItems: 'center', alignSelf: 'flex-end', justifyContent: 'center', opacity: copying ? 0.5 : 1, padding: spacing.xs }}>
        <AppIcon decorative color={colors.brand600} name={copying ? 'clock' : 'copy'} size={18} />
      </Pressable>
      {copyFeedback ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.caption, {
            color: copyFeedback.startsWith('已复制') ? colors.success : colors.danger,
          }]}>
          {copyFeedback}
        </Text>
      ) : null}
    </ChatItemCard>
  );
}
