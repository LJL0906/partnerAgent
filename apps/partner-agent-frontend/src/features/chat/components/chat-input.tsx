import type { ModelConfig, ReasoningLevel } from '@partner-agent/contracts';
import { useState } from 'react';
import { Keyboard, Modal, Pressable, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Brain, Check, Cpu, PaperPlaneTilt, StopCircle } from 'phosphor-react-native';

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

export function ChatInput({ isStreaming, models, modelsLoading, modelsLoadError, onRetryModels, modelConfigId, reasoningLevel, onModelConfigChange, onReasoningLevelChange, onSend, onCancel, connectionStatus }: ChatInputProps) {
  const { width } = useWindowDimensions();
  const [value, setValue] = useState('');
  const [picker, setPicker] = useState<'model' | 'reasoning'>();
  const [providerPicker, setProviderPicker] = useState<string>();
  const [modelAnchor, setModelAnchor] = useState<{ x: number; width: number }>({ x: spacing.page, width: 0 });
  const [reasoningAnchor, setReasoningAnchor] = useState<{ x: number; width: number }>({ x: spacing.page, width: 0 });

  async function handleSend() {
    const submittedValue = value;
    const submitted = await onSend(submittedValue, modelConfigId, effectiveReasoningLevel ?? 'medium');
    if (submitted) { setValue((currentValue) => (currentValue === submittedValue ? '' : currentValue)); Keyboard.dismiss(); }
  }

  const selectedModel = models.find((model) => model.id === modelConfigId);
  const modelLabel = selectedModel?.model_id ?? (modelsLoading ? '加载模型…' : modelsLoadError ? '模型加载失败' : models.length === 0 ? '未配置模型' : '选择模型');
  const reasoningLevels = selectedModel?.reasoning_levels ?? [];
  const reasoningEnabled = reasoningLevels.length > 0;
  const reasoningOptions: ReasoningLevel[] = reasoningEnabled ? ['off', ...reasoningLevels] : [];
  const effectiveReasoningLevel = reasoningLevel ?? reasoningLevels[0];
  const reasoningLabel = effectiveReasoningLevel ? `思考 ${reasoningLabels[effectiveReasoningLevel]}` : '思考';
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
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, maxWidth: '58%', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.infoSoft, borderColor: colors.toastInfoBorder, borderWidth: 1, opacity: isStreaming ? 0.5 : pressed ? 0.72 : 1 })}>
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
        <View accessibilityLabel={`连接状态：${connectionLabel}`} style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: connectionColor }} />
          <Text numberOfLines={1} style={[typography.caption, { color: connectionColor }]}>{connectionLabel}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs }}>
        <TextInput accessibilityLabel="聊天输入" multiline maxLength={4000} placeholder="问问我，或交给我去做…" placeholderTextColor={colors.textTertiary} value={value} onChangeText={setValue} style={{ flex: 1, minHeight: spacing.minTouchTarget, maxHeight: 116, color: colors.ink, outlineWidth: 0, ...typography.body, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm }} />
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
        ) : (
          <Pressable
            accessibilityLabel="发送消息"
            accessibilityRole="button"
            disabled={!value.trim() || !modelConfigId}
            onPress={() => void handleSend()}
            style={({ pressed }) => ({
              alignItems: 'center',
              alignSelf: 'center',
              backgroundColor: 'transparent',
              borderRadius: radius.pill,
              justifyContent: 'center',
              minHeight: spacing.minTouchTarget,
              minWidth: spacing.minTouchTarget,
              opacity: !value.trim() || !modelConfigId ? 0.32 : pressed ? 0.62 : 1,
              transform: [{ scale: pressed ? 0.94 : 1 }],
            })}>
            <PaperPlaneTilt color={colors.brand500} size={24} weight="duotone" />
          </Pressable>
        )}
      </View>
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





