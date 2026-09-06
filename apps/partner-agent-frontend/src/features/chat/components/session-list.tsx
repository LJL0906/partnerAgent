import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useEffect, useState } from 'react';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { FeedbackState } from '@/components/ui/feedback-state';
import { archiveSession, createSession, openSession, refreshSessionList, renameSession, useConversationStore } from '@/features/chat/session-management';
import { useToast } from '@/components/ui/toast';
import { useChatStore } from '@/store/chat-store';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { shadows } from '@/theme/shadows';
import type { ChatSessionListItem } from '@partner-agent/contracts';

interface ConversationListProps { onClose: () => void; }

function formatSessionCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '创建时间未知';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function ConversationList({ onClose }: ConversationListProps) {
  const sessions = useConversationStore((state) => state.sessions);
  const loading = useConversationStore((state) => state.loading);
  const opening = useConversationStore((state) => state.opening);
  const listError = useConversationStore((state) => state.listError);
  const lastRefreshedAt = useConversationStore((state) => state.lastRefreshedAt);
  const selectedId = useChatStore((state) => state.sessionId);
  const [editing, setEditing] = useState<{ id: string; title: string }>();
  const [actionSession, setActionSession] = useState<ChatSessionListItem>();
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const { showToast } = useToast();

  useEffect(() => { void refreshSessionList(); }, []);

  async function saveTitle() {
    if (!editing) return;
    setSaving(true);
    if (await renameSession(editing.id, editing.title)) setEditing(undefined);
    setSaving(false);
  }

  function showSessionActions(session: ChatSessionListItem) {
    setActionSession(session);
    setConfirmingArchive(false);
  }

  function closeActions() {
    if (archiving) return;
    setActionSession(undefined);
    setConfirmingArchive(false);
  }

  async function confirmArchive() {
    if (!actionSession) return;
    const archivedId = actionSession.id;
    const shouldSwitch = selectedId === archivedId;
    setArchiving(true);
    const ok = await archiveSession(archivedId);
    setArchiving(false);
    closeActions();
    if (!ok) {
      showToast({ message: '归档会话失败，请稍后重试。', type: 'error' });
      return;
    }

    if (shouldSwitch) {
      const nextSession = useConversationStore.getState().sessions[0];
      if (nextSession) {
        await openSession(nextSession.id);
      } else {
        await createSession();
      }
    }
    showToast({ message: '会话已归档，已从历史列表隐藏。', type: 'success' });
  }

  return <>
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: spacing.lg }}>
      <View style={{ paddingHorizontal: spacing.page, gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[typography.pageTitle, { color: colors.ink }]}>历史对话</Text>
          <AppButton icon="close" variant="icon" accessibilityLabel="关闭会话列表" onPress={onClose} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <AppButton fullWidth icon="add" title="新建对话" variant="secondary" style={{ flex: 1 }} disabled={opening} onPress={() => { void createSession(); onClose(); }} />
          <AppButton icon="refresh" variant="icon" accessibilityLabel="刷新历史对话" loading={loading} disabled={opening} onPress={() => void refreshSessionList()} />
        </View>
        {lastRefreshedAt ? <Text style={[typography.caption, { color: colors.textSecondary }]}>列表已更新 · {new Date(lastRefreshedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</Text> : null}
      </View>
      {listError ? <View accessibilityRole="alert" style={{ padding: spacing.page, gap: spacing.xs }}><Text style={[typography.body, { color: colors.danger }]}>{listError}</Text><AppButton title="重新加载列表" variant="secondary" size="sm" onPress={() => void refreshSessionList()} /></View> : null}
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        refreshing={loading}
        onRefresh={() => void refreshSessionList()}
        contentContainerStyle={{ flexGrow: 1, padding: spacing.page, gap: spacing.xs }}
        ListEmptyComponent={loading ? <FeedbackState type="loading" title="正在加载对话" description={null} /> : !listError ? <FeedbackState type="empty" title="还没有历史对话" description="发送第一条消息后，对话会保存在这里。" /> : null}
        renderItem={({ item }) => {
          const selected = item.id === selectedId;
          const title = item.title || '新对话';
          const statusIcon = item.active_task ? 'clock' : item.latest_task?.state === 'failed' ? 'error' : undefined;
          return <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, padding: spacing.sm, borderRadius: radius.medium, backgroundColor: selected ? colors.infoSoft : colors.canvas }}>
            <Pressable accessibilityRole="button" accessibilityLabel={`打开会话：${title}`} disabled={opening} onPress={() => { void openSession(item.id).then((ok) => { if (ok) onClose(); }); }} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <AppIcon decorative name="assistant" color={selected ? colors.brand500 : colors.textSecondary} size={20} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={[typography.body, { color: colors.ink }]}>{title}</Text>
                <Text numberOfLines={1} ellipsizeMode="tail" style={[typography.caption, { color: colors.textSecondary }]}>{formatSessionCreatedAt(item.created_at)}</Text>
              </View>
              {statusIcon ? <AppIcon decorative name={statusIcon} color={statusIcon === 'error' ? colors.danger : colors.brand500} size={18} /> : null}
            </Pressable>
            <AppButton icon="more" variant="icon" size="sm" accessibilityLabel={`会话操作：${title}`} onPress={() => showSessionActions(item)} />
          </View>;
        }}
      />
    </View>
    <Modal visible={Boolean(actionSession)} transparent animationType="slide" onRequestClose={closeActions}>
      <Pressable style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }} onPress={closeActions}>
        <Pressable style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.large, borderTopRightRadius: radius.large, padding: spacing.lg, gap: spacing.md, boxShadow: shadows.overlay }} onPress={(event) => event.stopPropagation()}>
          {actionSession ? (
            confirmingArchive ? (
              <>
                <View style={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm }}>
                  <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.warningSoft }}>
                    <AppIcon decorative name="archive" color={colors.warning} size={24} />
                  </View>
                  <Text style={[typography.sectionTitle, { color: colors.ink, textAlign: 'center' }]}>归档这个会话？</Text>
                  <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>归档后会从历史列表隐藏，但不会删除聊天内容。</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <AppButton title="取消" variant="tertiary" style={{ flex: 1 }} disabled={archiving} onPress={() => setConfirmingArchive(false)} />
                  <AppButton title="确认归档" variant="danger" style={{ flex: 1 }} loading={archiving} onPress={() => void confirmArchive()} />
                </View>
              </>
            ) : (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <View style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.medium, backgroundColor: colors.infoSoft }}>
                    <AppIcon decorative name="assistant" color={colors.brand500} size={21} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text numberOfLines={1} style={[typography.sectionTitle, { color: colors.ink }]}>{actionSession.title || '新对话'}</Text>
                    <Text numberOfLines={1} style={[typography.caption, { color: colors.textSecondary }]}>{formatSessionCreatedAt(actionSession.created_at)}</Text>
                  </View>
                  <AppButton icon="close" variant="icon" accessibilityLabel="关闭会话操作" onPress={closeActions} />
                </View>
                {actionSession.last_message_preview ? <Text numberOfLines={2} style={[typography.body, { color: colors.textSecondary, backgroundColor: colors.canvas, borderRadius: radius.medium, padding: spacing.sm }]}>{actionSession.last_message_preview}</Text> : null}
                <View style={{ gap: spacing.xs }}>
                  <Pressable accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: spacing.minTouchTarget, paddingHorizontal: spacing.sm, borderRadius: radius.medium, backgroundColor: pressed ? colors.infoSoft : 'transparent', opacity: pressed ? 0.84 : 1 })} onPress={() => { setEditing({ id: actionSession.id, title: actionSession.title || '新对话' }); closeActions(); }}>
                    <AppIcon decorative name="edit" color={colors.brand500} size={21} />
                    <View style={{ flex: 1 }}><Text style={[typography.control, { color: colors.ink }]}>重命名会话</Text><Text style={[typography.caption, { color: colors.textSecondary }]}>修改列表中显示的名称</Text></View>
                  </Pressable>
                  <Pressable accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: spacing.minTouchTarget, paddingHorizontal: spacing.sm, borderRadius: radius.medium, backgroundColor: pressed ? colors.warningSoft : 'transparent', opacity: pressed ? 0.84 : 1 })} onPress={() => setConfirmingArchive(true)}>
                    <AppIcon decorative name="archive" color={colors.warning} size={21} />
                    <View style={{ flex: 1 }}><Text style={[typography.control, { color: colors.ink }]}>归档会话</Text><Text style={[typography.caption, { color: colors.textSecondary }]}>从历史列表隐藏，不删除内容</Text></View>
                  </Pressable>
                </View>
              </>
            )
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
    <Modal visible={Boolean(editing)} transparent animationType="fade" onRequestClose={() => setEditing(undefined)}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: spacing.page }} onPress={() => setEditing(undefined)}>
        <Pressable style={{ backgroundColor: colors.surface, borderRadius: radius.large, padding: spacing.lg, gap: spacing.md }} onPress={(event) => event.stopPropagation()}>
          <Text style={[typography.sectionTitle, { color: colors.ink }]}>修改会话名称</Text>
          <TextInput autoFocus value={editing?.title ?? ''} onChangeText={(title) => setEditing((current) => current ? { ...current, title } : current)} maxLength={48} placeholder="输入会话名称" style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium, padding: spacing.md, color: colors.ink, outlineWidth: 0, ...typography.body }} />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }}><AppButton title="取消" variant="tertiary" onPress={() => setEditing(undefined)} /><AppButton title="保存" disabled={saving || !editing?.title.trim()} onPress={() => void saveTitle()} /></View>
        </Pressable>
      </Pressable>
    </Modal>
  </>;
}
