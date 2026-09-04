import { ActivityIndicator, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

import { AppButton } from './app-button';
import { AppIcon } from './app-icon';
import type { AppIconName } from './app-icon';

export type FeedbackStateType = 'loading' | 'empty' | 'error' | 'offline';
export type FeedbackStateProps = {
  type: FeedbackStateType;
  title?: string;
  description?: string | null;
  actionLabel?: string;
  onAction?: () => void;
};

const defaults: Record<FeedbackStateType, { title: string; description: string; icon: AppIconName; color: string }> = {
  loading: { title: '正在加载', description: '请稍候。', icon: 'sparkle', color: colors.violet500 },
  empty: { title: '这里还没有内容', description: '开始一次对话，让伙伴帮你整理。', icon: 'sparkle', color: colors.brand500 },
  error: { title: '暂时无法加载', description: '请重试，已有内容不会丢失。', icon: 'error', color: colors.danger },
  offline: { title: '当前处于离线状态', description: '检查网络后再试一次。', icon: 'offline', color: colors.warning },
};

export function FeedbackState({ type, title, description, actionLabel, onAction }: FeedbackStateProps) {
  const feedback = defaults[type];
  const resolvedDescription = description === undefined ? feedback.description : description;
  return (
    <View
      accessibilityLiveRegion={type === 'error' || type === 'offline' ? 'assertive' : 'polite'}
      style={{ alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.page, paddingVertical: spacing.huge }}>
      {type === 'loading' ? (
        <ActivityIndicator accessibilityLabel="正在加载" color={feedback.color} size="small" />
      ) : (
        <AppIcon accessibilityLabel={feedback.title} color={feedback.color} name={feedback.icon} size={28} />
      )}
      <View style={{ alignItems: 'center', gap: spacing.xs }}>
        <Text maxFontSizeMultiplier={2} selectable style={[typography.sectionTitle, { color: colors.ink, textAlign: 'center' }]}>
          {title ?? feedback.title}
        </Text>
        {resolvedDescription ? (
          <Text maxFontSizeMultiplier={2} selectable style={[typography.body, { color: colors.textSecondary, maxWidth: 320, textAlign: 'center' }]}>
            {resolvedDescription}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <AppButton onPress={onAction} title={actionLabel} variant={type === 'error' ? 'secondary' : 'primary'} />
      ) : null}
    </View>
  );
}
