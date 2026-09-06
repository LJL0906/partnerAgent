import React from 'react';
import { Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';

import { ChatItemCard } from './chat-item-card';
import type { CandidateDisplay, CandidatePreviewAction, CandidatePreviewDecision } from './chat-item-types';

export type CandidateCardProps = CandidateDisplay & {
  candidateId?: string;
  onOpen?: () => void;
  onDecision?: (decision: CandidatePreviewDecision) => void;
};

type CandidatePreview = { title: string; candidateType?: string; summary?: string; details?: string };

export function createCandidatePreview({ title, candidateType, summary, details }: CandidateDisplay): CandidatePreview {
  return { title, ...(candidateType ? { candidateType } : {}), ...(summary ? { summary } : {}), ...(details ? { details } : {}) };
}

function CandidatePreviewEditor({ preview, candidateId, onDecision }: { preview: CandidatePreview; candidateId?: string; onDecision?: CandidateCardProps['onDecision'] }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(preview);

  const update = (field: keyof CandidatePreview, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const apply = () => {
    if (candidateId && onDecision) onDecision({ candidateId, action: 'modify', applied: false, preview: draft });
    setEditing(false);
  };

  return editing ? (
    <View accessibilityLabel="候选预览编辑器" style={{ gap: 8 }}>
      <Text style={{ color: '#168A63', fontSize: 12, lineHeight: 16 }}>仅修改本地草稿，不会直接入库。</Text>
      <TextInput accessibilityLabel="预览标题" value={draft.title} onChangeText={(value) => update('title', value)} style={{ borderColor: '#C9D1DC', borderRadius: 8, borderWidth: 1, minHeight: 40, paddingHorizontal: 10 }} />
      <TextInput accessibilityLabel="预览摘要" value={draft.summary ?? ''} onChangeText={(value) => update('summary', value)} multiline style={{ borderColor: '#C9D1DC', borderRadius: 8, borderWidth: 1, minHeight: 64, padding: 10 }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <AppButton accessibilityLabel="取消预览编辑" onPress={() => { setDraft(preview); setEditing(false); }} size="sm" title="取消" variant="secondary" />
        <AppButton accessibilityLabel="应用预览草稿" onPress={apply} size="sm" title="应用预览" variant="primary" />
      </View>
    </View>
  ) : (
    <AppButton accessibilityLabel="编辑预览" onPress={() => setEditing(true)} size="sm" title="编辑预览" variant="secondary" />
  );
}

export function CandidateCard({ title, summary, details, candidateType, candidateId, previewOnly = true, onOpen, onDecision }: CandidateCardProps) {
  const preview = createCandidatePreview({ title, summary, details, candidateType });
  const emitDecision = (action: CandidatePreviewAction) => {
    if (!candidateId || !onDecision) return;
    onDecision({ candidateId, action, applied: false, preview });
  };

  return (
    <ChatItemCard accessory={onOpen ? <Text accessibilityRole="button" onPress={onOpen} style={{ color: '#168A63', fontSize: 12, fontWeight: '600' }}>查看</Text> : null} previewOnly={previewOnly} subtitle={candidateType} title={title} tone="candidate">
      <View style={{ gap: 8 }}>
        {summary ? <Text selectable style={{ color: '#171821', fontSize: 14, lineHeight: 20 }}>{summary}</Text> : null}
        {details ? <Text selectable style={{ color: '#676C7E', fontSize: 13, lineHeight: 18 }}>{details}</Text> : null}
        <Text style={{ color: '#168A63', fontSize: 12, lineHeight: 16 }}>仅为候选预览，所有决策均为 preview，applied:false，尚未入库。</Text>
        <Text style={{ color: '#168A63', fontSize: 12, lineHeight: 16 }}>仅修改本地草稿，不会直接入库。</Text>
        <CandidatePreviewEditor candidateId={candidateId} onDecision={onDecision} preview={preview} />
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

