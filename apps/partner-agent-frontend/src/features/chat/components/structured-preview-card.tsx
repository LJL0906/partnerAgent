import type { ChatPreviewSourceRef, ChatPreviewV1 } from '@partner-agent/contracts';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

import { ChatItemCard } from './chat-item-card';

type ClipboardWriter = (value: string) => Promise<unknown>;

const priorityLabels = { low: '低', medium: '中', high: '高' } as const;
const sourceKindLabels: Record<ChatPreviewSourceRef['kind'], string> = {
  original_record: '原始记录',
  chat_message: '聊天消息',
};

function formatDateTime(value: number | string, timeZone?: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间未知';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function sourceText(source: ChatPreviewSourceRef): string {
  return `${sourceKindLabels[source.kind]}：${source.id}`;
}

export function buildStructuredPreviewCopyText(
  preview: ChatPreviewV1,
  createdAt: number,
): string {
  const { content } = preview;
  const lines = [
    '未确认预览，未创建行动',
    `标题：${content.title}`,
    ...(content.description ? [`说明：${content.description}`] : []),
    `来源：${preview.source_refs.map(sourceText).join('；')}`,
    `生成时间：${formatDateTime(createdAt)}`,
    ...(content.planned_at
      ? [`计划时间：${formatDateTime(content.planned_at, content.timezone)}`]
      : []),
    ...(content.deadline_at
      ? [`截止时间：${formatDateTime(content.deadline_at, content.timezone)}`]
      : []),
    ...(content.timezone ? [`时区：${content.timezone}`] : []),
    ...(content.priority ? [`优先级：${priorityLabels[content.priority]}`] : []),
    `可信度：${Math.round(content.confidence * 100)}%`,
    `不确定性：${content.uncertainty || '未提供额外不确定性说明'}`,
    ...(content.risk_summary ? [`风险提示：${content.risk_summary}`] : []),
    ...preview.warnings.map((warning) => `校验提示：${warning.message}`),
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

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: spacing.xxs }}>
      <Text style={[typography.label, { color: colors.textSecondary }]}>{label}</Text>
      <Text selectable style={[typography.body, { color: colors.ink }]}>{value}</Text>
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
      notice={(
        <Text
          accessibilityRole="alert"
          style={[typography.label, { color: colors.success, paddingTop: spacing.xs }]}>
          未确认预览，未创建行动
        </Text>
      )}
      previewOnly
      subtitle="行动预览"
      title={content.title}
      tone="candidate">
      {content.description ? <PreviewField label="说明" value={content.description} /> : null}
      <PreviewField label="来源" value={preview.source_refs.map(sourceText).join('；')} />
      <PreviewField label="生成时间" value={formatDateTime(createdAt)} />
      {content.planned_at ? (
        <PreviewField label="计划时间" value={formatDateTime(content.planned_at, content.timezone)} />
      ) : null}
      {content.deadline_at ? (
        <PreviewField label="截止时间" value={formatDateTime(content.deadline_at, content.timezone)} />
      ) : null}
      {content.timezone ? <PreviewField label="时区" value={content.timezone} /> : null}
      {content.priority ? <PreviewField label="优先级" value={priorityLabels[content.priority]} /> : null}
      <PreviewField label="可信度" value={`${Math.round(content.confidence * 100)}%`} />
      <PreviewField label="不确定性" value={content.uncertainty || '未提供额外不确定性说明'} />
      {content.risk_summary ? <PreviewField label="风险提示" value={content.risk_summary} /> : null}
      {preview.warnings.map((warning) => (
        <PreviewField key={`${warning.code}:${warning.path ?? ''}`} label="校验提示" value={warning.message} />
      ))}
      <AppButton
        accessibilityLabel="复制预览"
        loading={copying}
        onPress={() => { void handleCopy(); }}
        size="sm"
        title="复制预览"
        variant="secondary"
      />
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
