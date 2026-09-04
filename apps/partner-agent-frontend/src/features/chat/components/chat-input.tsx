import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { colors } from '@/theme/colors';

interface ChatInputProps {
  isStreaming: boolean;
  onSend: (message: string) => Promise<boolean>;
  onCancel: () => Promise<void>;
}

export function ChatInput({ isStreaming, onSend, onCancel }: ChatInputProps) {
  const [value, setValue] = useState('');

  async function handleSend() {
    const submitted = await onSend(value);
    if (submitted) setValue('');
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 20,
        borderCurve: 'continuous',
      }}>
      <TextInput
        accessibilityLabel="聊天输入"
        multiline
        maxLength={4000}
        placeholder="问问我，或交给我去做…"
        placeholderTextColor={colors.textSecondary}
        value={value}
        onChangeText={setValue}
        style={{
          flex: 1,
          minHeight: 42,
          maxHeight: 116,
          color: colors.text,
          fontSize: 16,
          lineHeight: 22,
          padding: 8,
        }}
      />
      {isStreaming ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="停止回复"
          onPress={onCancel}
          style={({ pressed }) => ({
            minWidth: 58,
            height: 42,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 14,
            backgroundColor: colors.errorSoft,
            opacity: pressed ? 0.7 : 1,
          })}>
          <Text style={{ color: colors.error, fontSize: 14, fontWeight: '700' }}>停止</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="发送消息"
          disabled={!value.trim()}
          onPress={handleSend}
          style={({ pressed }) => ({
            minWidth: 58,
            height: 42,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 14,
            backgroundColor: value.trim() ? colors.primary : colors.border,
            opacity: pressed ? 0.75 : 1,
          })}>
          <Text style={{ color: colors.card, fontSize: 14, fontWeight: '700' }}>发送</Text>
        </Pressable>
      )}
    </View>
  );
}
