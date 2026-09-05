import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { bootstrapAuth, logout, signInWithPassword, useAuthStore } from './auth-store';

export function AccountLoginScreen() {
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const authError = useAuthStore((state) => state.errorMessage);
  const authMode = useAuthStore((state) => state.authMode);
  const status = useAuthStore((state) => state.status);
  const insets = useSafeAreaInsets();
  const inputStyle = { ...typography.body, backgroundColor: colors.surfaceSubtle, borderColor: colors.border, borderWidth: 1, borderRadius: radius.medium, color: colors.ink, minHeight: 52, paddingHorizontal: spacing.md, paddingVertical: spacing.sm };

  async function submit() {
    if (busy) return;
    if (!/^[a-z0-9_]{3,32}$/i.test(username.trim())) { setError('用户名须为 3–32 位英文字母、数字或下划线。'); return; }
    if ([...password].length < 12 || [...password].length > 128) { setError('密码须为 12–128 个字符，可以使用一句容易记住的话。'); return; }
    if (register && password !== confirmation) { setError('两次输入的密码不一致。'); return; }
    setBusy(true); setError(undefined);
    try {
      await signInWithPassword(username, password, register);
      setPassword(''); setConfirmation('');
    } catch (cause) {
      // Only the API's fixed user-facing messages are exposed here.
      const { AccountApiError } = await import('@/api/账户接口');
      setError(cause instanceof AccountApiError ? cause.message : '暂时无法保存登录状态，请重试。');
    } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: spacing.page, paddingTop: Math.max(insets.top, spacing.xl), paddingBottom: Math.max(insets.bottom, spacing.xl) }}>
        <View style={{ width: '100%', maxWidth: 440, alignSelf: 'center', gap: spacing.xl }}>
          <View style={{ alignItems: 'center', gap: spacing.md }}>
            <View style={{ backgroundColor: colors.aiCore, width: 64, height: 64, borderRadius: radius.large, alignItems: 'center', justifyContent: 'center' }}><AppIcon decorative name="sparkle" color={colors.brand400} size={28} /></View>
            <Text style={[typography.display, { color: colors.ink }]}>{register ? '认识你的伙伴' : '欢迎回来'}</Text>
            <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>{register ? '创建账户，开始你的第一段对话。' : '登录后，接着上次的话题聊。'}</Text>
          </View>
          <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.large, padding: spacing.lg, gap: spacing.md }}>
            <View style={{ gap: spacing.xs }}>
              <Text style={[typography.label, { color: colors.ink }]}>用户名</Text>
              <TextInput accessibilityLabel="用户名" autoComplete="username" autoCapitalize="none" autoCorrect={false} editable={!busy} maxLength={32} placeholder="3–32 位字母、数字或下划线" placeholderTextColor={colors.textTertiary} value={username} onChangeText={setUsername} style={inputStyle} />
            </View>
            <View style={{ gap: spacing.xs }}>
              <Text style={[typography.label, { color: colors.ink }]}>密码</Text>
              <View>
                <TextInput accessibilityLabel="密码" autoComplete={register ? 'new-password' : 'current-password'} autoCapitalize="none" autoCorrect={false} secureTextEntry={!passwordVisible} editable={!busy} maxLength={256} placeholder="至少 12 个字符" placeholderTextColor={colors.textTertiary} value={password} onChangeText={setPassword} onSubmitEditing={() => { if (!register) void submit(); }} style={[inputStyle, { paddingRight: 56 }]} />
                <AppButton accessibilityLabel={passwordVisible ? '隐藏密码' : '显示密码'} icon={passwordVisible ? 'eyeOff' : 'eye'} variant="icon" disabled={busy} onPress={() => setPasswordVisible((visible) => !visible)} style={{ position: 'absolute', right: 4, top: 4 }} />
              </View>
            </View>
            {register ? <View style={{ gap: spacing.xs }}>
              <Text style={[typography.label, { color: colors.ink }]}>确认密码</Text>
              <View>
                <TextInput accessibilityLabel="确认密码" autoComplete="new-password" autoCapitalize="none" autoCorrect={false} secureTextEntry={!confirmationVisible} editable={!busy} maxLength={256} placeholder="再输入一次密码" placeholderTextColor={colors.textTertiary} value={confirmation} onChangeText={setConfirmation} onSubmitEditing={() => void submit()} style={[inputStyle, { paddingRight: 56 }]} />
                <AppButton accessibilityLabel={confirmationVisible ? '隐藏确认密码' : '显示确认密码'} icon={confirmationVisible ? 'eyeOff' : 'eye'} variant="icon" disabled={busy} onPress={() => setConfirmationVisible((visible) => !visible)} style={{ position: 'absolute', right: 4, top: 4 }} />
              </View>
            </View> : null}
            {error || authError ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[typography.caption, { color: colors.danger }]}>{error ?? authError}</Text> : null}
            <AppButton fullWidth title={register ? '注册并开始聊天' : '登录'} loading={busy} disabled={!username.trim() || !password || (register && !confirmation)} onPress={() => void submit()} size="lg" />
            <AppButton fullWidth variant="tertiary" disabled={busy} title={register ? '已有账户？去登录' : '还没有账户？注册'} onPress={() => { setRegister(!register); setError(undefined); setPassword(''); setConfirmation(''); setPasswordVisible(false); setConfirmationVisible(false); }} />
            {status === 'error' ? <AppButton fullWidth variant="secondary" title={authMode === 'account' ? '重试退出登录' : '重试恢复登录'} onPress={() => void (authMode === 'account' ? logout() : bootstrapAuth())} /> : null}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
