import { useCallback } from 'react';
import { Alert, BackHandler, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmbientBackground } from '@/components/ui/ambient-background';
import { AppButton } from '@/components/ui/app-button';
import { AppHeader } from '@/components/ui/app-header';
import { AppIcon } from '@/components/ui/app-icon';
import { StatusBadge } from '@/components/ui/status-badge';
import { logout, useAuthStore } from '@/features/auth';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { shadows } from '@/theme/shadows';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

import { getSessionStatus, settingsSections, type SettingsItem } from '@/features/settings/settings-model';
import { resolveSettingsReturnTarget, returnFromSettings } from '@/features/navigation/settings-return';

function SettingsRow({ item, onPress }: { item: SettingsItem; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={item.title}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        flexDirection: 'row',
        gap: spacing.md,
        minHeight: 68,
        opacity: pressed ? 0.72 : 1,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
      })}>
      <View style={{ alignItems: 'center', backgroundColor: colors.infoSoft, borderRadius: radius.medium, height: 38, justifyContent: 'center', width: 38 }}>
        <AppIcon decorative color={colors.brand500} name={item.icon} size={20} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text maxFontSizeMultiplier={2} style={[typography.bodyStrong, { color: colors.ink }]}>{item.title}</Text>
        <Text maxFontSizeMultiplier={2} numberOfLines={2} style={[typography.caption, { color: colors.textSecondary }]}>{item.subtitle}</Text>
      </View>
      <AppIcon decorative color={colors.textTertiary} name="more" size={18} style={{ transform: [{ rotate: '90deg' }] }} />
    </Pressable>
  );
}

export default function ProfileRoute() {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnTarget = resolveSettingsReturnTarget(returnTo);
  const insets = useSafeAreaInsets();
  const status = useAuthStore((state) => state.status);
  const username = useAuthStore((state) => state.username);
  const expiresAt = useAuthStore((state) => state.expiresAt);
  const errorMessage = useAuthStore((state) => state.errorMessage);
  const session = getSessionStatus(status);
  const displayName = username?.trim() || '紫灵用户';
  const accountLabel = username ? '账户登录' : '个人助手账户';
  const handleBack = useCallback(() => {
    returnFromSettings(router, returnTarget);
  }, [returnTarget, router]);

  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'android' || !returnTarget) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [handleBack, returnTarget]));

  const showPlaceholder = (item: SettingsItem) => {
    if (item.title === '安全会话') return;
    Alert.alert(item.title, '这个功能正在准备中，敬请期待。');
  };

  return (
    <View style={{ backgroundColor: colors.canvas, flex: 1 }}>
      <AmbientBackground />
      <View style={{ flex: 1 }}>
        <AppHeader title="设置" leadingAction={returnTarget ? { icon: 'back', accessibilityLabel: '返回聊天', onPress: handleBack } : undefined} />
        <ScrollView
          contentContainerStyle={{ gap: spacing.xl, paddingBottom: Math.max(insets.bottom, spacing.xl) + 82, paddingHorizontal: spacing.page, paddingTop: spacing.lg }}
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}>
          <Pressable
            accessibilityLabel="个人资料"
            accessibilityRole="button"
            onPress={() => Alert.alert('个人资料', '个人资料编辑功能正在准备中，敬请期待。')}
            style={({ pressed }) => ({
              alignItems: 'center',
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderCurve: 'continuous',
              borderRadius: radius.large,
              borderWidth: 1,
              flexDirection: 'row',
              gap: spacing.md,
              opacity: pressed ? 0.78 : 1,
              padding: spacing.lg,
              boxShadow: shadows.float,
            })}>
            <View style={{ alignItems: 'center', backgroundColor: colors.aiCore, borderRadius: radius.pill, height: 62, justifyContent: 'center', width: 62 }}>
              <AppIcon accessibilityLabel="默认头像" color={colors.brand400} name="profile" size={30} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text maxFontSizeMultiplier={2} style={[typography.display, { color: colors.ink }]}>{displayName}</Text>
              <Text maxFontSizeMultiplier={2} style={[typography.caption, { color: colors.textSecondary }]}>{accountLabel}</Text>
            </View>
            <AppIcon decorative color={colors.textTertiary} name="more" size={20} style={{ transform: [{ rotate: '90deg' }] }} />
          </Pressable>

          {settingsSections.map((section) => (
            <View key={section.title} style={{ gap: spacing.sm }}>
              <Text maxFontSizeMultiplier={2} style={[typography.label, { color: colors.textSecondary, paddingHorizontal: spacing.xs }]}>{section.title}</Text>
              <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderCurve: 'continuous', borderRadius: radius.large, borderWidth: 1, overflow: 'hidden', boxShadow: shadows.float }}>
                {section.items.map((item, index) => (
                  <View key={item.title}>
                    <SettingsRow item={item} onPress={() => showPlaceholder(item)} />
                    {index < section.items.length - 1 ? <View style={{ backgroundColor: colors.divider, height: 1, marginLeft: 72 }} /> : null}
                  </View>
                ))}
              </View>
            </View>
          ))}

          <View style={{ gap: spacing.sm }}>
            <Text maxFontSizeMultiplier={2} style={[typography.label, { color: colors.textSecondary, paddingHorizontal: spacing.xs }]}>安全会话</Text>
            <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderCurve: 'continuous', borderRadius: radius.large, borderWidth: 1, gap: spacing.sm, padding: spacing.lg, boxShadow: shadows.float }}>
              <View style={{ alignItems: 'center', flexDirection: 'row', gap: spacing.sm }}>
                <AppIcon decorative color={colors.brand500} name="shield" size={20} />
                <Text maxFontSizeMultiplier={2} style={[typography.bodyStrong, { color: colors.ink, flex: 1 }]}>当前会话</Text>
                <StatusBadge label={session.label} tone={session.tone} />
              </View>
              <Text maxFontSizeMultiplier={2} style={[typography.caption, { color: colors.textSecondary }]}>
                {expiresAt ? `令牌有效期至 ${new Date(expiresAt).toLocaleString()}` : '未提供令牌有效期'}
              </Text>
              {errorMessage ? <Text accessibilityRole="alert" maxFontSizeMultiplier={2} style={[typography.caption, { color: colors.danger }]}>{errorMessage}</Text> : null}
            </View>
          </View>

          <AppButton fullWidth icon="logout" onPress={() => void logout()} size="lg" title="退出登录" variant="danger" />
          <Text style={[typography.caption, { color: colors.textTertiary, textAlign: 'center' }]}>紫灵 AI · v1.0.0</Text>
        </ScrollView>
      </View>
    </View>
  );
}

