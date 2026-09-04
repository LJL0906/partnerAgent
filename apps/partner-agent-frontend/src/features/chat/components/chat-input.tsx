import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { shadows } from '@/theme/shadows';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

interface ChatInputProps {
  isStreaming: boolean;
  onSend: (message: string) => Promise<boolean>;
  onCancel: () => Promise<void>;
}

export function ChatInput({ isStreaming, onSend, onCancel }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  async function handleSend() {
    const submittedValue = value;
    const submitted = await onSend(submittedValue);
    if (submitted) {
      setValue((currentValue) => (currentValue === submittedValue ? '' : currentValue));
    }
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: spacing.xs,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xxs,
        backgroundColor: colors.surface,
        borderColor: isFocused ? colors.brand500 : colors.border,
        borderWidth: isFocused ? 2 : 1,
        borderRadius: radius.large,
        borderCurve: 'continuous',
        boxShadow: shadows.float,
      }}>
      <TextInput
        accessibilityLabel="聊天输入"
        multiline
        maxLength={4000}
        placeholder="问问我，或交给我去做…"
        placeholderTextColor={colors.textTertiary}
        value={value}
        onChangeText={setValue}
        onBlur={() => setIsFocused(false)}
        onFocus={() => setIsFocused(true)}
        style={{
          flex: 1,
          minHeight: spacing.minTouchTarget,
          maxHeight: 116,
          color: colors.ink,
          ...typography.body,
          paddingHorizontal: spacing.xs,
          paddingVertical: spacing.sm,
        }}
      />
      {isStreaming ? (
        <AppButton
          accessibilityLabel="停止回复"
          icon="stop"
          onPress={onCancel}
          style={{
            alignSelf: 'center',
            minWidth: 76,
            borderRadius: radius.medium,
          }}
          title="停止"
          variant="danger"
        />
      ) : (
        <AppButton
          accessibilityLabel="发送消息"
          disabled={!value.trim()}
          icon="send"
          onPress={handleSend}
          style={{
            alignSelf: 'center',
            minWidth: 76,
            borderRadius: radius.medium,
          }}
          title="发送"
        />
      )}
    </View>
  );
}
