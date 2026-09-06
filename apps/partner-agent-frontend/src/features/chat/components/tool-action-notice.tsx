import { Text } from 'react-native';

import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import type { ToolActionFeedback } from '../chat-tool-action-state';

export function ToolActionNotice({ feedback }: { feedback?: ToolActionFeedback }) {
  if (!feedback) return null;
  const problem = feedback.phase === 'rejected' || feedback.phase === 'unknown';
  return <Text accessibilityLiveRegion="polite" style={[typography.caption, {
    color: problem ? colors.warning : colors.textSecondary, paddingTop: spacing.sm,
  }]}>{feedback.message}</Text>;
}
