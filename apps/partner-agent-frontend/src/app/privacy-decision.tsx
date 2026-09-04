import type { SensitiveCategory } from '@partner-agent/contracts';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { FeedbackState } from '@/components/ui/feedback-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { reconcileChatFromRest } from '@/features/chat/use-chat';
import { usePrivacyDecisionStore } from '@/features/privacy/privacy-decision-store';
import { useChatStore } from '@/store/chat-store';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

const categoryLabels: Record<SensitiveCategory, string> = {
  identity_document: '身份凭证',
  bank_card: '银行卡信息',
  password: '密码',
  api_key: 'API 密钥',
  secret: '其他机密信息',
};

export default function PrivacyDecisionRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const summary = useChatStore((state) => state.privacyDecision);
  const activeTaskId = useChatStore((state) => state.activeTaskId);
  const sessionId = useChatStore((state) => state.sessionId);
  const phase = usePrivacyDecisionStore((state) => state.phase);
  const errorMessage = usePrivacyDecisionStore((state) => state.errorMessage);
  const canRefresh = usePrivacyDecisionStore((state) => state.canRefresh);
  const submit = usePrivacyDecisionStore((state) => state.submit);
  const reset = usePrivacyDecisionStore((state) => state.reset);
  const [refreshing, setRefreshing] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => reset(), [reset, summary?.egress_id]);
  useEffect(() => {
    const checkExpiry = () => {
      const expiresAt = summary ? Date.parse(summary.expires_at) : Number.NaN;
      setExpired(!Number.isFinite(expiresAt) || expiresAt <= Date.now());
    };
    const initialCheck = setTimeout(checkExpiry, 0);
    const interval = setInterval(checkExpiry, 30_000);
    return () => {
      clearTimeout(initialCheck);
      clearInterval(interval);
    };
  }, [summary]);

  const reconcile = async () => {
    const results = await reconcileChatFromRest(activeTaskId, sessionId);
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('状态刷新失败，请稍后重试。');
    }
  };

  const decide = async (decision: 'redact' | 'allow' | 'block') => {
    if (!summary || expired) return;
    const succeeded = await submit({
      egressId: summary.egress_id,
      decision,
      expiresAt: summary.expires_at,
      reconcile,
    });
    if (succeeded) router.back();
  };

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await reconcile();
      reset();
    } finally {
      setRefreshing(false);
    }
  };

  if (!summary) {
    return (
      <View style={{ backgroundColor: colors.canvas, flex: 1, justifyContent: 'center' }}>
        <FeedbackState
          actionLabel="返回助手"
          description="这次检查可能已完成或失效，请返回查看最新状态。"
          onAction={() => router.back()}
          title="没有待处理的隐私检查"
          type="empty"
        />
      </View>
    );
  }

  const blocked = expired || phase === 'expired';
  const submitting = phase === 'submitting';
  const visibleError = blocked
    ? '本次隐私决定已过期，请刷新任务状态。'
    : errorMessage;

  return (
    <ScrollView
      contentContainerStyle={{
        alignSelf: 'center',
        gap: spacing.xl,
        maxWidth: 560,
        paddingBottom: Math.max(insets.bottom, spacing.xl),
        paddingHorizontal: spacing.page,
        paddingTop: spacing.xl,
        width: '100%',
      }}
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.canvas, flex: 1 }}>
      <View style={{ alignItems: 'center', gap: spacing.md }}>
        <View
          style={{
            alignItems: 'center',
            backgroundColor: colors.aiCore,
            borderRadius: radius.large,
            height: 60,
            justifyContent: 'center',
            width: 60,
          }}>
          <AppIcon accessibilityLabel="隐私保护" color={colors.brand400} name="shield" size={28} />
        </View>
        <View style={{ alignItems: 'center', gap: spacing.xs }}>
          <Text maxFontSizeMultiplier={2} style={[typography.pageTitle, { color: colors.ink, textAlign: 'center' }]}>确认这次如何发送</Text>
          <Text maxFontSizeMultiplier={2} style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
            检测到可能敏感的信息类别。页面不会展示命中原文。
          </Text>
        </View>
      </View>

      <View
        style={{
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderCurve: 'continuous',
          borderRadius: radius.large,
          borderWidth: 1,
          overflow: 'hidden',
        }}>
        <DetailRow label="敏感类别">
          <View style={{ alignItems: 'flex-end', flex: 1, gap: spacing.xs }}>
            {summary.categories.map((category) => (
              <StatusBadge key={category} label={categoryLabels[category]} tone="warning" />
            ))}
          </View>
        </DetailRow>
        <DetailRow label="服务提供方" value={summary.provider} />
        <DetailRow label="模型" value={summary.model_id} />
        <DetailRow
          label="有效期至"
          value={new Date(summary.expires_at).toLocaleString()}
          last
        />
      </View>

      <View style={{ backgroundColor: colors.infoSoft, borderRadius: radius.medium, flexDirection: 'row', gap: spacing.sm, padding: spacing.md }}>
        <AppIcon decorative color={colors.info} name="info" size={20} />
        <Text maxFontSizeMultiplier={2} style={[typography.body, { color: colors.info, flex: 1 }]}>
          建议优先脱敏后发送；“仅本次允许”不会改变之后的隐私策略。
        </Text>
      </View>

      {visibleError ? (
        <View accessibilityLiveRegion="assertive" style={{ backgroundColor: colors.dangerSoft, borderRadius: radius.medium, gap: spacing.xs, padding: spacing.md }}>
          <Text maxFontSizeMultiplier={2} style={[typography.bodyStrong, { color: colors.danger }]}>无法提交决定</Text>
          <Text maxFontSizeMultiplier={2} style={[typography.body, { color: colors.danger }]}>{visibleError}</Text>
        </View>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <AppButton disabled={blocked} fullWidth loading={submitting} onPress={() => void decide('redact')} size="lg" title="脱敏后发送" />
        <AppButton disabled={blocked || submitting} fullWidth onPress={() => void decide('allow')} size="lg" title="仅本次允许" variant="secondary" />
        <AppButton disabled={blocked || submitting} fullWidth onPress={() => void decide('block')} size="lg" title="不发送" variant="danger" />
        {(blocked || canRefresh) ? (
          <AppButton fullWidth loading={refreshing} onPress={() => void refresh()} title="刷新状态" variant="tertiary" />
        ) : null}
      </View>
    </ScrollView>
  );
}

function DetailRow({ label, value, last = false, children }: { label: string; value?: string; last?: boolean; children?: ReactNode }) {
  return (
    <View style={{ alignItems: 'flex-start', borderBottomColor: colors.divider, borderBottomWidth: last ? 0 : 1, flexDirection: 'row', gap: spacing.md, minHeight: 52, padding: spacing.md }}>
      <Text maxFontSizeMultiplier={2} style={[typography.label, { color: colors.textSecondary, paddingTop: 3 }]}>{label}</Text>
      {children ?? (
        <Text maxFontSizeMultiplier={2} selectable style={[typography.bodyStrong, { color: colors.ink, flex: 1, textAlign: 'right' }]}>{value}</Text>
      )}
    </View>
  );
}
