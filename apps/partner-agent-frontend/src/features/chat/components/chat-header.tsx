import { AppButton } from '@/components/ui/app-button';
import { AppHeader } from '@/components/ui/app-header';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import type { TaskTodoItemV1 } from '@partner-agent/contracts';
import { View } from 'react-native';
import { TaskTodoPopover } from './task-todo-popover';
import { HeaderNavigation } from '@/components/navigation/floating-menu';

interface ChatHeaderProps {
  title: string;
  disabled: boolean;
  onOpenSessions: () => void;
  onCreateSession: () => void;
  todos: TaskTodoItemV1[];
}

export function ChatHeader({ title, disabled, onOpenSessions, onCreateSession, todos }: ChatHeaderProps) {
  return <AppHeader title={title} titleStyle={{ fontSize: 16, lineHeight: 20, fontWeight: '400', transform: [{ translateY: -3 }] }} leadingAction={{ icon: 'history', accessibilityLabel: '历史对话', onPress: onOpenSessions }} trailing={<View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xxs }}><TaskTodoPopover key={todos.length ? todos.map((item) => item.id).join(':') : 'empty'} items={todos} /><AppButton icon="add" variant="icon" accessibilityLabel="新建对话" disabled={disabled} onPress={onCreateSession} style={{ backgroundColor: colors.infoSoft, borderColor: colors.border, borderWidth: 1, borderRadius: radius.medium, marginVertical: spacing.xxs }} /><HeaderNavigation /></View>} />;
}


