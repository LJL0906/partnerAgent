import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/ui/app-button';
import { AppHeader } from '@/components/ui/app-header';
import { AppIcon } from '@/components/ui/app-icon';
import { StatusBadge } from '@/components/ui/status-badge';
import { logout, useAuthStore } from '@/features/auth';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export default function ProfileRoute() {
  const insets = useSafeAreaInsets();
  const expiresAt = useAuthStore((state) => state.expiresAt);

  return (
    <View style={{ backgroundColor: colors.canvas, flex: 1 }}>
      <AppHeader title="设置" />
      <ScrollView
        contentContainerStyle={{
          gap: spacing.xl,
          paddingBottom: Math.max(insets.bottom, spacing.xl),
          paddingHorizontal: spacing.page,
          paddingTop: spacing.xl,
        }}
        contentInsetAdjustmentBehavior="automatic">
        <View
          style={{
            alignItems: 'center',
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderCurve: 'continuous',
            borderRadius: radius.large,
            borderWidth: 1,
            flexDirection: 'row',
            gap: spacing.md,
            padding: spacing.lg,
          }}>
          <View style={{ alignItems: 'center', backgroundColor: colors.aiCore, borderRadius: radius.medium, height: 52, justifyContent: 'center', width: 52 }}>
            <AppIcon accessibilityLabel="安全会话" color={colors.brand400} name="shield" size={24} />
          </View>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text maxFontSizeMultiplier={2} style={[typography.sectionTitle, { color: colors.ink }]}>安全会话</Text>
            <StatusBadge label="已连接" tone="success" />
          </View>
        </View>

        <View style={{ gap: spacing.xs }}>
          <Text maxFontSizeMultiplier={2} style={[typography.label, { color: colors.textSecondary }]}>令牌有效期</Text>
          <Text maxFontSizeMultiplier={2} selectable style={[typography.body, { color: colors.ink }]}>
            {expiresAt ? new Date(expiresAt).toLocaleString() : '未提供有效期'}
          </Text>
          <Text maxFontSizeMultiplier={2} style={[typography.caption, { color: colors.textSecondary }]}>
            退出后会关闭实时连接，并清除本机令牌、会话消息和任务恢复状态。
          </Text>
        </View>

        <AppButton fullWidth icon="logout" onPress={() => void logout()} size="lg" title="退出登录" variant="danger" />
      </ScrollView>
    </View>
  );
}
