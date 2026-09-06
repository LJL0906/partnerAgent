import type { ChatItem } from '@partner-agent/contracts';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { shadows } from '@/theme/shadows';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { compactCandidateText, formatCandidateDateTime } from './candidate-card';

export interface CandidateChoice {
  id: string;
  label: string;
  description?: string;
}

export interface CandidateQuestionPage {
  id: string;
  anchorItemId: string;
  itemIds: string[];
  question: string;
  choices: CandidateChoice[];
}

function previewText(preview: object, key: string): string | undefined {
  const value = (preview as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readableQuestion(value: string): string | undefined {
  const normalized = value.replace(/[`*_>#-]/g, '').replace(/\s+/g, ' ').trim();
  const questions = normalized.match(/[^。！？?]*[？?]/g)
    ?.map((question) => question.trim()).filter(Boolean);
  const question = questions?.at(-1);
  return question && question.length <= 80 ? question : undefined;
}

export function buildCandidateQuestionPages(items: readonly ChatItem[]): CandidateQuestionPage[] {
  type ChoiceItem = Extract<ChatItem, { type: 'candidate' | 'structured_preview' }>;
  const formalTaskIds = new Set(items.flatMap((item) =>
    item.type === 'candidate' && item.task_id ? [item.task_id] : []));
  const groups = new Map<string, { items: ChoiceItem[]; firstIndex: number }>();
  items.forEach((item, index) => {
    if (item.type !== 'candidate' && item.type !== 'structured_preview') return;
    if (item.type === 'structured_preview' && item.task_id && formalTaskIds.has(item.task_id)) return;
    const groupId = item.type === 'candidate'
      ? item.payload.batch_ref?.id ?? item.task_id ?? item.id
      : item.task_id ?? item.operation_id ?? item.id;
    const group = groups.get(groupId) ?? { items: [], firstIndex: index };
    group.items.push(item);
    groups.set(groupId, group);
  });
  return [...groups.entries()]
    .filter(([, group]) => group.items[0]?.type === 'candidate' || group.items.length > 1)
    .sort((left, right) => left[1].firstIndex - right[1].firstIndex)
    .map(([id, group]) => {
    const first = group.items[0]!;
    const assistant = items.slice(0, group.firstIndex).findLast((item) =>
      item.type === 'message' && item.payload.role === 'assistant');
    const firstPreview = first.type === 'candidate' ? first.payload.preview : first.payload.content;
    const explicitQuestion = previewText(firstPreview, 'question');
    const assistantQuestion = assistant?.type === 'message'
      ? readableQuestion(assistant.payload.content) : undefined;
    return {
      id,
      anchorItemId: first.id,
      itemIds: group.items.map((item) => item.id),
      question: explicitQuestion ?? assistantQuestion ?? '请选择一个更符合你想法的方案',
      choices: group.items.map((choice, index) => {
        const preview = choice.type === 'candidate' ? choice.payload.preview : choice.payload.content;
        const summary = compactCandidateText(previewText(preview, 'description')
          ?? previewText(preview, 'details'));
        const time = formatCandidateDateTime(
          previewText(preview, 'planned_at'),
          previewText(preview, 'timezone'),
        );
        const description = [summary, time ? `时间：${time}` : undefined]
          .filter((value): value is string => Boolean(value)).join('\n');
        return {
          id: choice.type === 'candidate'
            ? choice.candidate_id ?? choice.payload.candidate_id
            : choice.payload.preview_id,
          label: previewText(preview, 'title')
            ?? previewText(preview, 'summary')
            ?? `方案 ${index + 1}`,
          ...(description ? { description } : {}),
        };
      }),
    };
  });
}

export function formatCandidateAnswers(
  pages: readonly CandidateQuestionPage[],
  selections: Readonly<Record<string, string>>,
): string {
  const answers = pages.map((page, index) => {
    const selected = page.choices.find((choice) => choice.id === selections[page.id]);
    return `问题 ${index + 1}：${page.question}\n选择：${selected?.label ?? '未选择'}`;
  });
  return `我对候选问题的选择如下：\n\n${answers.join('\n\n')}\n\n这些选择即为最终授权，无需再次询问或确认，请立即按正式流程执行。`;
}

export function applyCandidateChoice(
  pages: readonly CandidateQuestionPage[],
  selections: Readonly<Record<string, string>>,
  pageIndex: number,
  choiceId: string,
) {
  const page = pages[pageIndex];
  const nextSelections = page ? { ...selections, [page.id]: choiceId } : { ...selections };
  const shouldSubmit = pages.length > 0 && pages.every((entry) => Boolean(nextSelections[entry.id]));
  return {
    selections: nextSelections,
    nextPageIndex: shouldSubmit ? pageIndex : Math.min(pageIndex + 1, pages.length - 1),
    shouldSubmit,
  };
}

export async function submitCandidateAnswers(
  pages: readonly CandidateQuestionPage[],
  selections: Readonly<Record<string, string>>,
  onSubmit: (message: string) => Promise<boolean>,
  lifecycle: { onStart: () => void; onRejected: () => void },
): Promise<boolean> {
  lifecycle.onStart();
  const accepted = await onSubmit(formatCandidateAnswers(pages, selections));
  if (!accepted) lifecycle.onRejected();
  return accepted;
}

export function resolveCandidateSelectionInitialOpen(initiallyOpen?: boolean): boolean {
  return initiallyOpen === true;
}

export function CandidateSelectionFlow({
  pages,
  onSubmit,
  initiallyOpen,
}: {
  pages: CandidateQuestionPage[];
  onSubmit: (message: string) => Promise<boolean>;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(() => resolveCandidateSelectionInitialOpen(initiallyOpen));
  const [pageIndex, setPageIndex] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string>();
  const [submitted, setSubmitted] = useState(false);
  const page = pages[pageIndex];
  if (!page || submitted) return null;

  const submit = async (nextSelections = selections) => {
    if (!pages.every((entry) => Boolean(nextSelections[entry.id])) || submitting) return;
    setSubmitting(true);
    setFeedback(undefined);
    const accepted = await submitCandidateAnswers(pages, nextSelections, onSubmit, {
      onStart: () => {
        setOpen(false);
        setSubmitted(true);
      },
      onRejected: () => {
        setSubmitted(false);
        setOpen(true);
      },
    });
    setSubmitting(false);
    if (!accepted) {
      setFeedback('答案暂未发送，请检查连接后重试。');
    }
  };
  const select = (choiceId: string) => {
    if (submitting) return;
    const result = applyCandidateChoice(pages, selections, pageIndex, choiceId);
    setSelections(result.selections);
    setFeedback(undefined);
    if (result.shouldSubmit) {
      void submit(result.selections);
    } else {
      setPageIndex(result.nextPageIndex);
    }
  };

  return (
    <>
      <View style={{ alignItems: 'center', backgroundColor: colors.surface,
        borderColor: colors.floatingMenuBorder, borderRadius: radius.large,
        borderCurve: 'continuous', borderWidth: 1, flexDirection: 'row', gap: spacing.sm,
        padding: spacing.md }}>
        <AppIcon decorative color={colors.brand500} name="todo" size={22} />
        <View style={{ flex: 1, gap: spacing.xxs }}>
          <Text style={[typography.bodyStrong, { color: colors.ink }]}>需要你的选择</Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {pages.length} 个问题，答案会汇总后继续交给模型
          </Text>
        </View>
        <AppButton onPress={() => setOpen(true)} size="sm" title="开始选择" variant="secondary" />
      </View>

      <Modal animationType="fade" onRequestClose={() => setOpen(false)} transparent visible={open}>
        <View style={{ backgroundColor: colors.overlay, flex: 1, justifyContent: 'flex-end' }}>
          <Pressable accessibilityLabel="关闭候选选择浮层" onPress={() => setOpen(false)}
            style={{ flex: 1 }} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.large,
            borderTopRightRadius: radius.large, borderCurve: 'continuous', boxShadow: shadows.float,
            gap: spacing.md, maxHeight: '78%', padding: spacing.lg }}>
            <View style={{ alignItems: 'center', flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1, gap: spacing.xxs }}>
                <Text style={[typography.bodyStrong, { color: colors.ink }]}>请补充你的选择</Text>
                <Text style={[typography.caption, { color: colors.textSecondary,
                  fontVariant: ['tabular-nums'] }]}>第 {pageIndex + 1} / {pages.length} 题</Text>
              </View>
              <AppButton accessibilityLabel="收起候选选择浮层" icon="close"
                onPress={() => setOpen(false)} size="sm" variant="icon" />
            </View>

            <ScrollView contentContainerStyle={{ gap: spacing.md }}
              contentInsetAdjustmentBehavior="automatic" nestedScrollEnabled>
              <Text selectable style={[typography.body, { color: colors.ink }]}>{page.question}</Text>
              <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
                {page.choices.map((choice) => {
                  const selected = selections[page.id] === choice.id;
                  return (
                    <Pressable key={choice.id} accessibilityLabel={choice.label}
                      accessibilityRole="radio" accessibilityState={{ checked: selected }}
                      disabled={submitting} onPress={() => select(choice.id)}
                      style={({ pressed }) => ({ backgroundColor: selected ? colors.infoSoft : colors.surface,
                        borderColor: selected ? colors.brand500 : colors.border,
                        borderCurve: 'continuous', borderRadius: radius.medium, borderWidth: 1,
                        flexDirection: 'row', gap: spacing.sm, opacity: pressed ? 0.72 : 1,
                        padding: spacing.md })}>
                      <View style={{ alignItems: 'center', borderColor: selected ? colors.brand500 : colors.textTertiary,
                        borderRadius: radius.pill, borderWidth: 2, height: 20, justifyContent: 'center', width: 20 }}>
                        {selected ? <View style={{ backgroundColor: colors.brand500,
                          borderRadius: radius.pill, height: 10, width: 10 }} /> : null}
                      </View>
                      <View style={{ flex: 1, gap: spacing.xxs }}>
                        <Text style={[typography.bodyStrong, { color: colors.ink }]}>{choice.label}</Text>
                        {choice.description ? <Text selectable style={[typography.caption,
                          { color: colors.textSecondary }]}>{choice.description}</Text> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            {feedback ? <Text accessibilityRole="alert" style={[typography.caption,
              { color: colors.danger }]}>{feedback}</Text> : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' }}>
              <AppButton disabled={pageIndex === 0} onPress={() => setPageIndex((value) => value - 1)}
                size="sm" title="上一页" variant="secondary" />
              {pageIndex < pages.length - 1 ? (
                <AppButton onPress={() => setPageIndex((value) => value + 1)}
                  size="sm" title="下一页" variant="secondary" />
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
