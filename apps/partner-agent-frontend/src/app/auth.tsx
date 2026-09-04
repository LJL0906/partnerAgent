import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { StatusBadge } from '@/components/ui/status-badge';
import { apiConfig } from '@/api/config';
import {
  signInWithDevelopmentToken,
  useAuthStore,
} from '@/features/auth';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export default function AuthRoute() {
  const insets = useSafeAreaInsets();
  const authError = useAuthStore((state) => state.errorMessage);
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string>();

  const submit = async () => {
    if (!token.trim() || submitting) return;
    setSubmitting(true);
    setLocalError(undefined);
    try {
      await signInWithDevelopmentToken(token);
      setToken('');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '令牌校验失败，请重试。');
    } finally {
      setSubmitting(false);
    }
  };

  const error = localError ?? authError;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingBottom: Math.max(insets.bottom, spacing.xl),
          paddingHorizontal: spacing.page,
          paddingTop: Math.max(insets.top, spacing.xl),
        }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled">
        <View style={{ alignSelf: 'center', maxWidth: 440, width: '100%', gap: spacing.xl }}>
          <View style={{ alignItems: 'center', gap: spacing.md }}>
            <View
              style={{
                alignItems: 'center',
                backgroundColor: colors.aiCore,
                borderCurve: 'continuous',
                borderRadius: radius.large,
                height: 64,
                justifyContent: 'center',
                width: 64,
              }}>
              <AppIcon accessibilityLabel="安全访问" color={colors.brand400} name="lock" size={28} />
            </View>
            <View style={{ alignItems: 'center', gap: spacing.xs }}>
              <Text maxFontSizeMultiplier={2} style={[typography.display, { color: colors.ink }]}>连接你的伙伴</Text>
              <Text maxFontSizeMultiplier={2} style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
                访问令牌只用于连接你的服务，不会显示在消息或错误中。
              </Text>
            </View>
          </View>

          {__DEV__ ? (
            <View
              style={{
                backgroundColor: colors.surface,
                borderColor: error ? colors.danger : colors.border,
                borderCurve: 'continuous',
                borderRadius: radius.large,
                borderWidth: 1,
                gap: spacing.md,
                padding: spacing.lg,
              }}>
              <StatusBadge label="仅限开发环境" tone="warning" />
              <Text
                maxFontSizeMultiplier={2}
                selectable
                style={[
                  typography.caption,
                  { color: apiConfig.serverUrlConfigError ? colors.danger : colors.textSecondary },
                ]}>
                {apiConfig.serverUrlConfigError ?? `当前服务地址：${apiConfig.serverUrlDisplay ?? '未配置'}`}
              </Text>
              <View style={{ gap: spacing.xs }}>
                <Text maxFontSizeMultiplier={2} style={[typography.label, { color: colors.ink }]}>开发 JWT</Text>
                <TextInput
                  accessibilityLabel="开发 JWT"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setToken}
                  onSubmitEditing={() => void submit()}
                  placeholder="粘贴由服务端签发的 JWT"
                  placeholderTextColor={colors.textTertiary}
                  returnKeyType="done"
                  secureTextEntry
                  style={[
                    typography.body,
                    {
                      backgroundColor: colors.surfaceSubtle,
                      borderColor: error ? colors.danger : colors.border,
                      borderRadius: radius.medium,
                      borderWidth: 1,
                      color: colors.ink,
                      minHeight: 52,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                    },
                  ]}
                  value={token}
                />
                {error ? (
                  <Text accessibilityLiveRegion="assertive" maxFontSizeMultiplier={2} style={[typography.caption, { color: colors.danger }]}>
                    {error}
                  </Text>
                ) : (
                  <Text maxFontSizeMultiplier={2} style={[typography.caption, { color: colors.textSecondary }]}>
                    客户端仅检查有效期；签名与权限始终由服务端验证。
                  </Text>
                )}
              </View>
              <AppButton
                disabled={!token.trim()}
                fullWidth
                loading={submitting}
                onPress={() => void submit()}
                size="lg"
                title="使用开发令牌进入"
              />
            </View>
          ) : (
            <View style={{ alignItems: 'center', gap: spacing.sm }}>
              <StatusBadge label="尚未登录" tone="neutral" />
              <Text maxFontSizeMultiplier={2} style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
                正式登录入口将在后续版本提供。
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
