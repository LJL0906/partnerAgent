import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { WechatLogoIcon } from 'phosphor-react-native';
import { ACCOUNT_PASSWORD_MESSAGE, LOGIN_PASSWORD_MESSAGE, isValidAccountPassword, isValidAccountUsername, normalizeAccountUsername } from '@/api/account-api';
import { AmbientBackground } from '@/components/ui/ambient-background';
import { PurpleWelcomeText } from '@/components/ui/ziling-welcome-effect';
import { AppButton } from '@/components/ui/app-button';
import { useToast } from '@/components/ui/toast';
import { useFeedback } from '@/components/ui/feedback';
import { colors } from '@/theme/colors';
import { authTokens } from '@/theme/auth';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { bootstrapAuth, logout, signInWithPassword, useAuthStore } from './auth-store';

type FocusedField = 'username' | 'password' | 'confirmation' | undefined;

export function AccountLoginScreen({ register = false }: { register?: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [focusedField, setFocusedField] = useState<FocusedField>();
  const [busy, setBusy] = useState(false);
  const authError = useAuthStore((state) => state.errorMessage);
  const authMode = useAuthStore((state) => state.authMode);
  const status = useAuthStore((state) => state.status);
  const { showToast } = useToast();
  const router = useRouter();
  const feedback = useFeedback();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (authError) { feedback.error(); showToast({ type: 'error', message: authError }); }
  }, [authError, feedback, showToast]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent = `
      #auth-screen input:-webkit-autofill,
      #auth-screen input:-webkit-autofill:hover,
      #auth-screen input:-webkit-autofill:focus {
        -webkit-text-fill-color: #171821;
        -webkit-box-shadow: 0 0 0 1000px #F7F8FC inset;
        box-shadow: 0 0 0 1000px #F7F8FC inset;
        transition: background-color 9999s ease-out;
      }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  async function submit() {
    if (busy) return;
    feedback.submit();
    const normalizedUsername = normalizeAccountUsername(username);
    if (!isValidAccountUsername(normalizedUsername)) { feedback.warning(); showToast({ type: 'warning', message: '用户名须为 3–32 位英文字母、数字或下划线。' }); return; }
    if (!isValidAccountPassword(password, register)) { feedback.warning(); showToast({ type: 'warning', message: register ? ACCOUNT_PASSWORD_MESSAGE : LOGIN_PASSWORD_MESSAGE }); return; }
    if (register && password !== confirmation) { feedback.warning(); showToast({ type: 'warning', message: '两次输入的密码不一致。' }); return; }
    setBusy(true);
    try {
      await signInWithPassword(normalizedUsername, password, register);
      if (register) { feedback.success(); showToast({ type: 'success', message: '主人，紫灵连接已建立，正在进入。' }); }
      setPassword(''); setConfirmation('');
    } catch (cause) {
      const { AccountApiError } = await import('@/api/account-api');
      feedback.error(); showToast({ type: 'error', message: cause instanceof AccountApiError ? cause.message : '暂时无法保存登录状态，请重试。' });
    } finally { setBusy(false); }
  }

  function goToOtherMode() {
    setUsername(''); setPassword(''); setConfirmation('');
    setPasswordVisible(false); setConfirmationVisible(false); setFocusedField(undefined);
    if (register) router.back(); else router.push('/auth/register');
  }

  function fieldStyle(field: Exclude<FocusedField, undefined>) {
    return {
      borderBottomColor: focusedField === field ? authTokens.field.focusBorder : authTokens.field.border,
      borderBottomWidth: focusedField === field ? authTokens.field.focusBorderWidth : authTokens.field.defaultBorderWidth,
    } as const;
  }

  return (
    <KeyboardAvoidingView nativeID="auth-screen" behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: colors.canvas, position: 'relative' }}>
      <AmbientBackground />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.page, paddingTop: Math.max(insets.top + spacing.lg, spacing.huge), paddingBottom: Math.max(insets.bottom + spacing.xl, spacing.huge) }}>
        <View style={{ width: '100%', maxWidth: authTokens.layout.maxWidth, alignSelf: 'center', gap: authTokens.layout.sectionGap }}>
          <PurpleWelcomeText register={register} />

          <View style={{ gap: authTokens.layout.fieldGroupGap }}>
            <View style={fieldStyle('username')}>
              <Text style={[typography.caption, { color: focusedField === 'username' ? colors.brand500 : colors.textSecondary, letterSpacing: authTokens.field.labelLetterSpacing }]}>{'用户名'}</Text>
              <TextInput
                accessibilityLabel="用户名"
                autoCapitalize="none"
                autoCorrect={false}
                importantForAutofill="yes"
                keyboardAppearance="light"
                underlineColorAndroid="transparent"
                editable={!busy}
                maxLength={32}
                placeholder="请告诉紫灵您的用户名"
                placeholderTextColor={authTokens.field.placeholder}
                value={username}
                onChangeText={setUsername}
                onFocus={() => setFocusedField('username')}
                onBlur={() => setFocusedField(undefined)}
                selectionColor={authTokens.field.focusBorder}
                style={[typography.body, { backgroundColor: authTokens.field.background, color: authTokens.field.text, minHeight: authTokens.field.minHeight, paddingVertical: authTokens.field.verticalPadding }]}
              />
            </View>

            <View style={fieldStyle('password')}>
              <View style={{ alignItems: 'center', flexDirection: 'row', gap: spacing.xs }}>
                <Text style={[typography.caption, { color: focusedField === 'password' ? colors.brand500 : colors.textSecondary, letterSpacing: authTokens.field.labelLetterSpacing }]}>{'密码'}</Text>
                {register ? <Text style={[typography.caption, { color: colors.textTertiary }]}>{'（字母 + 数字）'}</Text> : null}
              </View>
              <View>
                <TextInput
                  accessibilityLabel="密码"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!busy}
                  maxLength={128}
                  placeholder={register ? '愿这份密码只属于您' : '请温柔地输入密码'}
                  placeholderTextColor={authTokens.field.placeholder}
                  secureTextEntry={!passwordVisible}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(undefined)}
                  onSubmitEditing={() => { if (!register) void submit(); }}
                  selectionColor={authTokens.field.focusBorder}
                style={[typography.body, { backgroundColor: authTokens.field.background, color: authTokens.field.text, minHeight: authTokens.field.minHeight, paddingVertical: authTokens.field.verticalPadding, paddingRight: authTokens.field.passwordRightPadding }]}
                />
                <AppButton accessibilityLabel={passwordVisible ? '隐藏密码' : '显示密码'} icon={passwordVisible ? 'eyeOff' : 'eye'} variant="icon" disabled={busy} onPress={() => setPasswordVisible((visible) => !visible)} style={{ position: 'absolute', right: 0, bottom: 0 }} />
              </View>
            </View>

            {register ? <View style={fieldStyle('confirmation')}>
              <Text style={[typography.caption, { color: focusedField === 'confirmation' ? colors.brand500 : colors.textSecondary, letterSpacing: authTokens.field.labelLetterSpacing }]}>{'确认密码'}</Text>
              <View>
                <TextInput
                  accessibilityLabel="确认密码"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!busy}
                  maxLength={128}
                  placeholder="请再确认一次"
                  placeholderTextColor={authTokens.field.placeholder}
                  secureTextEntry={!confirmationVisible}
                  value={confirmation}
                  onChangeText={setConfirmation}
                  onFocus={() => setFocusedField('confirmation')}
                  onBlur={() => setFocusedField(undefined)}
                  onSubmitEditing={() => void submit()}
                  selectionColor={authTokens.field.focusBorder}
                style={[typography.body, { backgroundColor: authTokens.field.background, color: authTokens.field.text, minHeight: authTokens.field.minHeight, paddingVertical: authTokens.field.verticalPadding, paddingRight: authTokens.field.passwordRightPadding }]}
                />
                <AppButton accessibilityLabel={confirmationVisible ? '隐藏确认密码' : '显示确认密码'} icon={confirmationVisible ? 'eyeOff' : 'eye'} variant="icon" disabled={busy} onPress={() => setConfirmationVisible((visible) => !visible)} style={{ position: 'absolute', right: 0, bottom: 0 }} />
              </View>
            </View> : null}
          </View>

          <View style={{ alignItems: 'center', gap: authTokens.layout.actionGroupGap }}>
            <Pressable
              accessibilityLabel={register ? '创建紫灵账户' : '进入紫灵'}
              accessibilityRole="button"
              accessibilityState={{ busy: busy, disabled: !username.trim() || !password || (register && !confirmation) }}
              disabled={busy || !username.trim() || !password || (register && !confirmation)}
              onPress={() => void submit()}
              style={({ pressed }) => ({
                alignItems: 'center',
                alignSelf: 'center',
                backgroundColor: authTokens.primaryAction.background,
                borderColor: authTokens.primaryAction.border,
                borderRadius: authTokens.primaryAction.radius,
                borderWidth: 1,
                flexDirection: 'row',
                gap: spacing.sm,
                justifyContent: 'center',
                minHeight: authTokens.primaryAction.minHeight,
                minWidth: authTokens.primaryAction.minWidth,
                opacity: busy || !username.trim() || !password || (register && !confirmation) ? authTokens.primaryAction.disabledOpacity : pressed ? authTokens.primaryAction.pressedOpacity : 1,
                paddingHorizontal: authTokens.primaryAction.horizontalPadding,
                shadowColor: colors.brand500,
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.12,
                shadowRadius: 14,
                transform: [{ scale: pressed ? authTokens.primaryAction.pressedScale : 1 }],
              })}>
              {busy ? <ActivityIndicator color={colors.brand500} /> : <Text style={[typography.control, { color: colors.brand600, letterSpacing: 0.3 }]}>{register ? '创建紫灵账户' : '进入紫灵'}</Text>}
            </Pressable>
            <AppButton variant="tertiary" disabled={busy} title={register ? '已有账户？返回登录' : '还没有账户？创建账户'} onPress={goToOtherMode} style={{ alignSelf: 'center' }} textStyle={{ color: colors.textSecondary, fontWeight: '500' }} />
            {!register ? (
              <Pressable accessibilityRole="button" accessibilityLabel="忘记密码" disabled={busy} onPress={() => showToast({ type: 'info', message: '忘记密码功能即将开放。' })}>
                <Text style={[typography.caption, { color: colors.brand500, letterSpacing: 0.6, textAlign: 'center' }]}>忘记密码？</Text>
              </Pressable>
            ) : null}
            <View style={{ alignItems: 'center', flexDirection: 'row', gap: spacing.md, width: '100%' }}>
              <View style={{ backgroundColor: colors.divider, flex: 1, height: 1 }} />
              <Text style={[typography.caption, { color: colors.textTertiary, letterSpacing: authTokens.field.labelLetterSpacing }]}>或使用</Text>
              <View style={{ backgroundColor: colors.divider, flex: 1, height: 1 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.md, justifyContent: 'center' }}>
              <Pressable accessibilityRole="button" accessibilityLabel="QQ 登录" disabled={busy} onPress={() => showToast({ type: 'info', message: 'QQ 登录功能即将开放。' })} style={({ pressed }) => ({ alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: authTokens.primaryAction.radius, borderWidth: 1, height: authTokens.providerButton.size, justifyContent: 'center', opacity: pressed ? authTokens.providerButton.pressedOpacity : 1, width: authTokens.providerButton.size })}>
                <Text style={{ color: colors.info, fontSize: 18, fontWeight: '700' }}>Q</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="微信登录" disabled={busy} onPress={() => showToast({ type: 'info', message: '微信登录功能即将开放。' })} style={({ pressed }) => ({ alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: authTokens.primaryAction.radius, borderWidth: 1, height: authTokens.providerButton.size, justifyContent: 'center', opacity: pressed ? authTokens.providerButton.pressedOpacity : 1, width: authTokens.providerButton.size })}>
                <WechatLogoIcon color={colors.success} size={21} weight="regular" />
              </Pressable>
            </View>
            <Text style={[typography.caption, { color: colors.textTertiary, lineHeight: 18, textAlign: 'center' }]}>继续使用即表示你同意<Text style={{ color: colors.textSecondary }}>《用户协议》</Text>与<Text style={{ color: colors.textSecondary }}>《隐私政策》</Text></Text>
            {status === 'error' ? <AppButton variant="secondary" title={authMode === 'account' ? '重试退出登录' : '重试恢复登录'} onPress={() => void (authMode === 'account' ? logout() : bootstrapAuth())} style={{ alignSelf: 'center' }} /> : null}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
