import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import type { TaskTodoItemV1 } from '@partner-agent/contracts';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export function TaskTodoPopover({ items }: { items: TaskTodoItemV1[] }) {
  const [visible, setVisible] = useState(false);
  if (items.length === 0) return null;
  const completed = items.filter((item) => item.status === 'completed').length;
  return <>
    <AppButton icon="todo" size="sm" variant="icon"
      accessibilityLabel={`查看任务待办，已完成 ${completed}/${items.length}`}
      onPress={() => setVisible(true)} />
    <Modal animationType="fade" onRequestClose={() => setVisible(false)} transparent visible={visible}>
      <Pressable accessibilityLabel="关闭任务待办" onPress={() => setVisible(false)}
        style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-start', alignItems: 'flex-end', paddingHorizontal: spacing.lg, paddingTop: 72 }}>
        <Pressable accessibilityLabel="任务待办列表" onPress={(event) => event.stopPropagation()}
          style={{ width: '100%', maxWidth: 360, backgroundColor: colors.surface, borderRadius: radius.large, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View><Text style={[typography.body, { color: colors.ink, fontWeight: '700' }]}>任务待办</Text><Text style={[typography.caption, { color: colors.textSecondary }]}>{completed}/{items.length} 已完成</Text></View>
            <AppButton icon="close" size="sm" variant="icon" accessibilityLabel="关闭待办列表" onPress={() => setVisible(false)} />
          </View>
          {items.map((item) => <View key={item.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
            <AppIcon decorative name={item.status === 'completed' ? 'check' : item.status === 'in_progress' ? 'clock' : 'info'} size={18}
              color={item.status === 'completed' ? colors.success : item.status === 'in_progress' ? colors.brand500 : colors.textTertiary} />
            <Text style={[typography.body, { flex: 1, color: item.status === 'completed' ? colors.textTertiary : colors.ink, textDecorationLine: item.status === 'completed' ? 'line-through' : 'none' }]}>{item.content}</Text>
          </View>)}
        </Pressable>
      </Pressable>
    </Modal>
  </>;
}
