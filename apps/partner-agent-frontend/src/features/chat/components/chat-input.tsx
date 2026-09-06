import type { ModelConfig, ReasoningLevel } from '@partner-agent/contracts';
import { useState } from 'react';
import { Keyboard, Modal, Pressable, Text, TextInput, useWindowDimensions, View } from 'react-native';
import {
  Brain, Camera, Check, Cpu, File, ImageSquare, Keyboard as KeyboardIcon,
  PaperPlaneTilt, PhoneCall, Plus, StopCircle, Waveform, X,
} from 'phosphor-react-native';

import { AppButton } from '@/components/ui/app-button';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { shadows } from '@/theme/shadows';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

interface ChatInputProps {
  isStreaming: boolean;
  models: ModelConfig[];
  modelsLoading: boolean;
  modelsLoadError: boolean;
  modelSelectionError?: string;
  onRetryModels: () => void;
  modelConfigId: string;
  reasoningLevel?: ReasoningLevel;
  onModelConfigChange: (id: string) => void;
  onReasoningLevelChange: (level: ReasoningLevel) => void;
  onSend: (message: string, modelConfigId: string, reasoningLevel: ReasoningLevel) => Promise<boolean>;
  onCancel: () => Promise<void>;
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'auth_required';
}

const reasoningLabels: Record<ReasoningLevel, string> = { off: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高' };
export const MODEL_TRIGGER_MAX_WIDTH = '48%';
export const CLEAR_ACTION_WIDTH = 28;
export const CHAT_MORE_ACTIONS = [
  { id: 'image', label: '图片' },
  { id: 'camera', label: '拍摄' },
  { id: 'file', label: '文件' },
] as const;
type ChatMoreActionId = (typeof CHAT_MORE_ACTIONS)[number]['id'];

export function getChatMorePlaceholder(actionId: ChatMoreActionId): string {
  const action = CHAT_MORE_ACTIONS.find((item) => item.id === actionId);
  return `${action?.label ?? '该'}功能开发中`;
}

export function getVoiceModePresentation(active: boolean): {
  toggleLabel: string;
  placeholder: string | undefined;
} {
  return active
    ? { toggleLabel: '返回文字聊天', placeholder: '实时语音通话 · 即将开放' }
    : { toggleLabel: '进入实时语音通话', placeholder: undefined };
}

export function isChatInputClearable(value: string): boolean {
  return value.length > 0;
}

export function getReasoningOptions(model: ModelConfig | undefined): ReasoningLevel[] {
  return model ? [...model.reasoning_levels] : [];
}

export interface ModelRequestIdentity {
  requestId: number;
  ownerId: string | undefined;
  sessionRevision: number;
}

export function isCurrentModelRequest(
  expected: ModelRequestIdentity,
  current: ModelRequestIdentity,
): boolean {
  return expected.requestId === current.requestId
    && expected.ownerId === current.ownerId
    && expected.sessionRevision === current.sessionRevision;
}

export function resolveModelSelection(
  models: readonly ModelConfig[],
  modelConfigId: string,
  reasoningLevel: ReasoningLevel | undefined,
): { modelConfigId: string; reasoningLevel: ReasoningLevel | undefined } {
  const selected = models.find((model) => model.id === modelConfigId)
    ?? models.find((model) => model.is_default)
    ?? models[0];
  if (!selected) return { modelConfigId: '', reasoningLevel: undefined };
  return {
    modelConfigId: selected.id,
    reasoningLevel: reasoningLevel && selected.reasoning_levels.includes(reasoningLevel)
      ? reasoningLevel
      : selected.default_reasoning_level,
  };
}

export async function submitChatInput({
  onSend,
  dismissKeyboard,
  onSubmitted,
  onRejected,
}: {
  onSend: () => Promise<boolean>;
  dismissKeyboard: () => void;
  onSubmitted: () => void;
  onRejected: () => void;
}): Promise<boolean> {
  dismissKeyboard();
  onSubmitted();
  const submitted = await onSend();
  if (!submitted) onRejected();
  return submitted;
}

export function ChatInput({ isStreaming, models, modelsLoading, modelsLoadError, modelSelectionError, onRetryModels, modelConfigId, reasoningLevel, onModelConfigChange, onReasoningLevelChange, onSend, onCancel, connectionStatus }: ChatInputProps) {
  const { width } = useWindowDimensions();
  const [value, setValue] = useState('');
  const [voiceMode, setVoiceMode] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreFeedback, setMoreFeedback] = useState<string>();
  const [picker, setPicker] = useState<'model' | 'reasoning'>();
  const [providerPicker, setProviderPicker] = useState<string>();
  const [modelAnchor, setModelAnchor] = useState<{ x: number; width: number }>({ x: spacing.page, width: 0 });
  const [reasoningAnchor, setReasoningAnchor] = useState<{ x: number; width: number }>({ x: spacing.page, width: 0 });
  const voicePresentation = getVoiceModePresentation(voiceMode);

  async function handleSend() {
    if (!effectiveReasoningLevel) return;
    const submittedValue = value;
    await submitChatInput({
      onSend: () => onSend(submittedValue, modelConfigId, effectiveReasoningLevel),
      dismissKeyboard: () => Keyboard.dismiss(),
      onSubmitted: () => setValue((currentValue) => (
        currentValue === submittedValue ? '' : currentValue
      )),
      onRejected: () => setValue((currentValue) => currentValue || submittedValue),
    });
  }

  const selectedModel = models.find((model) => model.id === modelConfigId);
  const modelLabel = selectedModel?.model_id ?? (modelsLoading ? '加载模型…' : modelsLoadError ? '模型加载失败' : models.length === 0 ? '未配置模型' : '选择模型');
  const reasoningOptions = getReasoningOptions(selectedModel);
  const reasoningEnabled = selectedModel?.capabilities.includes('reasoning') === true;
  const effectiveReasoningLevel = reasoningLevel && reasoningOptions.includes(reasoningLevel)
    ? reasoningLevel
    : selectedModel?.default_reasoning_level;
  const reasoningLabel = effectiveReasoningLevel ? reasoningLabels[effectiveReasoningLevel] : '思考';
  const providers = Array.from(new Set(models.map((model) => model.provider)));
  const providerModels = models.filter((model) => model.provider === providerPicker);
  const providerLabel = (provider: string) => ({ deepseek: 'DeepSeek', openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', local: '本地模型' } as Record<string, string>)[provider] ?? provider;
  const connectionColor = connectionStatus === 'connected' ? colors.success : connectionStatus === 'connecting' || connectionStatus === 'idle' ? colors.warning : colors.danger;
  const connectionLabel = connectionStatus === 'connected' ? '已连接' : connectionStatus === 'connecting' ? '连接中' : connectionStatus === 'idle' ? '等待连接' : connectionStatus === 'auth_required' ? '鉴权失败' : '连接失败';
  const providerPanelWidth = Math.min(144, Math.max(116, width * 0.34));
  const modelPanelWidth = Math.min(188, Math.max(148, width * 0.44));
  const modelPickerWidth = providerPanelWidth + spacing.sm + (providerPicker ? modelPanelWidth : 0);
  const clampPickerLeft = (anchor: { x: number; width: number }, pickerWidth: number) => Math.min(Math.max(spacing.page, anchor.x + anchor.width / 2 - pickerWidth / 2), Math.max(spacing.page, width - spacing.page - pickerWidth));
  const pickerLeft = picker === 'reasoning' ? clampPickerLeft(reasoningAnchor, providerPanelWidth) : clampPickerLeft(modelAnchor, modelPickerWidth);

  return <>
    <View style={{ gap: spacing.xs, padding: spacing.xs, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 2, borderRadius: radius.large, borderCurve: 'continuous', boxShadow: shadows.float }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Pressable
          accessibilityLabel={`选择模型，当前为${modelLabel}`}
          accessibilityRole="button"
          disabled={isStreaming}
          onLayout={(event) => setModelAnchor({ x: event.nativeEvent.layout.x + spacing.page, width: event.nativeEvent.layout.width })}
          onPress={() => setPicker('model')}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: spacing.xs, maxWidth: MODEL_TRIGGER_MAX_WIDTH, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.infoSoft, borderColor: colors.toastInfoBorder, borderWidth: 1, opacity: isStreaming ? 0.5 : pressed ? 0.72 : 1 })}>
          <Cpu color={modelsLoadError ? colors.danger : colors.brand500} size={16} weight="duotone" />
          <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.brand600, ...typography.caption }}>{modelLabel}</Text>
        </Pressable>
        {reasoningEnabled ? (
          <Pressable
            accessibilityLabel={`选择思考等级，当前为${reasoningLabel}`}
            accessibilityRole="button"
            disabled={isStreaming}
            onLayout={(event) => setReasoningAnchor({ x: event.nativeEvent.layout.x + spacing.page, width: event.nativeEvent.layout.width })}
            onPress={() => setPicker('reasoning')}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surfaceSubtle, borderColor: colors.border, borderWidth: 1, opacity: isStreaming ? 0.52 : pressed ? 0.72 : 1 })}>
            <Brain color={colors.violet500} size={16} weight="duotone" />
            <Text style={{ color: colors.textSecondary, ...typography.caption }}>{reasoningLabel}</Text>
          </Pressable>
        ) : null}
        <View accessibilityLabel={`连接状态：${connectionLabel}`} style={{ marginLeft: 'auto', flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: connectionColor }} />
          <Text numberOfLines={1} style={[typography.caption, { color: connectionColor }]}>{connectionLabel}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <Pressable
          accessibilityLabel={voicePresentation.toggleLabel}
          accessibilityRole="button"
          accessibilityState={{ checked: voiceMode, disabled: isStreaming }}
          disabled={isStreaming}
          onPress={() => {
            Keyboard.dismiss();
            setMoreOpen(false);
            setMoreFeedback(undefined);
            setVoiceMode((active) => !active);
          }}
          style={({ pressed }) => ({
            alignItems: 'center', alignSelf: 'center', justifyContent: 'center',
            width: spacing.minTouchTarget, height: spacing.minTouchTarget,
            borderRadius: radius.pill, borderWidth: 1,
            borderColor: voiceMode ? colors.brand400 : 'transparent',
            backgroundColor: voiceMode ? colors.infoSoft : 'transparent',
            boxShadow: voiceMode ? '0 0 14px rgba(89, 103, 242, 0.28)' : undefined,
            opacity: isStreaming ? 0.34 : pressed ? 0.62 : 1,
            transform: [{ scale: pressed ? 0.92 : 1 }],
          })}>
          {voiceMode
            ? <KeyboardIcon color={colors.brand500} size={23} weight="duotone" />
            : <Waveform color={colors.violet500} size={25} weight="duotone" />}
        </Pressable>
        {voiceMode ? (
          <View
            accessibilityLabel={voicePresentation.placeholder}
            style={{ flex: 1, minHeight: spacing.minTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radius.pill, borderCurve: 'continuous', borderColor: colors.toastInfoBorder, borderWidth: 1, backgroundColor: colors.brandActionSoft }}>
            <PhoneCall color={colors.brand500} size={20} weight="duotone" />
            <Text style={[typography.control, { color: colors.brand600 }]}>{voicePresentation.placeholder}</Text>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.violet500, boxShadow: '0 0 8px rgba(138, 92, 246, 0.72)' }} />
          </View>
        ) : (
          <TextInput accessibilityLabel="聊天输入" multiline maxLength={4000} placeholder="问问我，或交给我去做…" placeholderTextColor={colors.textTertiary} value={value} onChangeText={(nextValue) => { setValue(nextValue); if (nextValue) setMoreOpen(false); }} style={{ flex: 1, minHeight: spacing.minTouchTarget, maxHeight: 116, color: colors.ink, outlineWidth: 0, ...typography.body, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm }} />
        )}
        {!voiceMode && isChatInputClearable(value) ? (
          <Pressable
            accessibilityLabel="清空输入"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setValue('')}
            style={({ pressed }) => ({
              alignItems: 'center',
              alignSelf: 'center',
              borderRadius: radius.pill,
              justifyContent: 'center',
              minHeight: spacing.minTouchTarget,
              width: CLEAR_ACTION_WIDTH,
              opacity: pressed ? 0.55 : 1,
            })}>
            <X color={colors.textTertiary} size={20} weight="bold" />
          </Pressable>
        ) : null}
        {isStreaming ? (
          <Pressable
            accessibilityLabel="停止回复"
            accessibilityRole="button"
            onPress={() => void onCancel()}
            style={({ pressed }) => ({
              alignItems: 'center',
              alignSelf: 'center',
              backgroundColor: 'transparent',
              borderRadius: radius.pill,
              justifyContent: 'center',
              minHeight: spacing.minTouchTarget,
              minWidth: spacing.minTouchTarget,
              opacity: pressed ? 0.62 : 1,
              transform: [{ scale: pressed ? 0.94 : 1 }],
            })}>
            <StopCircle color={colors.danger} size={24} weight="duotone" />
          </Pressable>
        ) : !voiceMode && value.trim() ? (
          <Pressable
            accessibilityLabel="发送消息"
            accessibilityRole="button"
            disabled={!value.trim() || !modelConfigId || !effectiveReasoningLevel}
            onPress={() => void handleSend()}
            style={({ pressed }) => ({
              alignItems: 'center',
              alignSelf: 'center',
              backgroundColor: 'transparent',
              borderRadius: radius.pill,
              justifyContent: 'center',
              minHeight: spacing.minTouchTarget,
              minWidth: spacing.minTouchTarget,
              opacity: !value.trim() || !modelConfigId || !effectiveReasoningLevel ? 0.32 : pressed ? 0.62 : 1,
              transform: [{ scale: pressed ? 0.94 : 1 }],
            })}>
            <PaperPlaneTilt color={colors.brand500} size={24} weight="duotone" />
          </Pressable>
        ) : !voiceMode ? (
          <Pressable
            accessibilityLabel={moreOpen ? '收起更多功能' : '打开更多功能'}
            accessibilityRole="button"
            accessibilityState={{ expanded: moreOpen }}
            onPress={() => {
              Keyboard.dismiss();
              setMoreFeedback(undefined);
              setMoreOpen((open) => !open);
            }}
            style={({ pressed }) => ({
              alignItems: 'center', alignSelf: 'center', justifyContent: 'center',
              minHeight: spacing.minTouchTarget, minWidth: spacing.minTouchTarget,
              borderRadius: radius.pill, backgroundColor: moreOpen ? colors.infoSoft : 'transparent',
              opacity: pressed ? 0.62 : 1,
              transform: [{ rotate: moreOpen ? '45deg' : '0deg' }],
            })}>
            <Plus color={colors.brand500} size={25} weight="bold" />
          </Pressable>
        ) : null}
      </View>
      {moreOpen ? (
        <View style={{ borderTopColor: colors.divider, borderTopWidth: 1, paddingTop: spacing.md, gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            {CHAT_MORE_ACTIONS.map((action) => {
              const Icon = action.id === 'image' ? ImageSquare : action.id === 'camera' ? Camera : File;
              return (
                <Pressable
                  key={action.id}
                  accessibilityLabel={`${action.label}，功能开发中`}
                  accessibilityRole="button"
                  onPress={() => setMoreFeedback(getChatMorePlaceholder(action.id))}
                  style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: spacing.xs, opacity: pressed ? 0.62 : 1 })}>
                  <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.medium, borderCurve: 'continuous', backgroundColor: colors.surfaceSubtle, borderColor: colors.border, borderWidth: 1 }}>
                    <Icon color={colors.textSecondary} size={24} weight="duotone" />
                  </View>
                  <Text style={[typography.caption, { color: colors.textSecondary }]}>{action.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {moreFeedback ? (
            <Text accessibilityRole="alert" style={[typography.caption, { color: colors.textTertiary, textAlign: 'center' }]}>
              {moreFeedback}
            </Text>
          ) : null}
        </View>
      ) : null}
      {modelSelectionError ? (
        <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger, paddingHorizontal: spacing.xs }]}>
          {modelSelectionError}
        </Text>
      ) : null}
    </View>
    <Modal visible={Boolean(picker)} transparent animationType="fade" onRequestClose={() => { setPicker(undefined); setProviderPicker(undefined); }}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.08)' }}
        onPress={() => { setPicker(undefined); setProviderPicker(undefined); }}>
        <View style={{ position: 'absolute', left: pickerLeft, bottom: 112, flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
          <Pressable
            style={{ width: providerPanelWidth, padding: spacing.sm, gap: spacing.xs, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.medium, boxShadow: shadows.float }}
            onPress={(event) => event.stopPropagation()}>
            <Text style={[typography.label, { color: colors.textSecondary, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs }]}>{picker === 'reasoning' ? '选择思考等级' : '选择供应商'}</Text>
            {picker === 'reasoning' ? reasoningOptions.map((level) => {
              const selected = level === effectiveReasoningLevel;
              return (
                <Pressable
                  key={level}
                  accessibilityRole="button"
                  accessibilityLabel={`选择思考等级${reasoningLabels[level]}`}
                  onPress={() => { onReasoningLevelChange(level); setPicker(undefined); }}
                  style={({ pressed }) => ({
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.xs,
                    minHeight: 36,
                    borderRadius: radius.small,
                    borderWidth: 1,
                    borderColor: selected ? colors.brand400 : colors.border,
                    backgroundColor: selected ? colors.infoSoft : colors.surface,
                    opacity: pressed ? 0.7 : 1,
                  })}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                    <Text style={[typography.control, { color: colors.ink, flex: 1 }]}>{reasoningLabels[level]}</Text>
                    {selected ? <Check color={colors.brand600} size={16} weight="bold" /> : null}
                  </View>
                </Pressable>
              );
            }) : modelsLoading ? <Text style={[typography.body, { color: colors.textSecondary, padding: spacing.sm }]}>正在加载模型配置…</Text> : modelsLoadError ? <AppButton fullWidth title="重新加载模型" variant="secondary" onPress={onRetryModels} /> : providers.length ? providers.map((provider) => (
              <Pressable key={provider} accessibilityRole="button" accessibilityLabel={`选择${providerLabel(provider)}供应商`} onPress={() => setProviderPicker(provider)} style={({ pressed }) => ({ paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, minHeight: 36, borderRadius: radius.small, borderWidth: 1, borderColor: provider === providerPicker ? colors.brand400 : colors.border, backgroundColor: provider === providerPicker ? colors.infoSoft : colors.surface, opacity: pressed ? 0.7 : 1 })}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  <Text numberOfLines={1} style={[typography.control, { color: colors.ink, flex: 1 }]}>{providerLabel(provider)}</Text>
                  {models.some((model) => model.id === modelConfigId && model.provider === provider) ? <Check color={colors.brand600} size={16} weight="bold" /> : null}
                </View>
              </Pressable>
            )) : <Text style={[typography.body, { color: colors.textSecondary, padding: spacing.sm }]}>暂无可用模型，请先在模型配置中添加。</Text>}
          </Pressable>
          {picker === 'model' && providerPicker ? (
            <Pressable
              style={{ width: modelPanelWidth, padding: spacing.sm, gap: spacing.xs, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.medium, boxShadow: shadows.float }}
              onPress={(event) => event.stopPropagation()}>
              <Text style={[typography.label, { color: colors.textSecondary, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs }]}>{providerLabel(providerPicker)}模型</Text>
              {providerModels.map((model) => (
                <Pressable key={model.id} accessibilityRole="button" accessibilityLabel={`选择${model.model_id}`} onPress={() => { onModelConfigChange(model.id); setPicker(undefined); setProviderPicker(undefined); }} style={({ pressed }) => ({ paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, minHeight: 36, borderRadius: radius.small, borderWidth: 1, borderColor: model.id === modelConfigId ? colors.brand400 : colors.border, backgroundColor: model.id === modelConfigId ? colors.infoSoft : colors.surface, opacity: pressed ? 0.7 : 1 })}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                    <Text numberOfLines={1} style={[typography.control, { color: colors.ink, flex: 1 }]}>{model.model_id}{model.is_default ? '（默认）' : ''}</Text>
                    {model.id === modelConfigId ? <Check color={colors.brand600} size={16} weight="bold" /> : null}
                  </View>
                </Pressable>
              ))}
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    </Modal>
  </>;
}





