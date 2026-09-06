import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

const languageLabels: Record<string, string> = {
  bash: 'Shell', css: 'CSS', html: 'HTML', js: 'JavaScript', javascript: 'JavaScript',
  json: 'JSON', jsx: 'JSX', markdown: 'Markdown', md: 'Markdown', py: 'Python',
  python: 'Python', sh: 'Shell', sql: 'SQL', ts: 'TypeScript', tsx: 'TSX',
  xml: 'XML', yaml: 'YAML', yml: 'YAML',
};

export async function copyCode(content: string) {
  await Clipboard.setStringAsync(content);
}

export function MessageCodeBlock({ content, language }: { content: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const normalizedLanguage = language?.trim().toLowerCase();
  const label = normalizedLanguage ? languageLabels[normalizedLanguage] ?? normalizedLanguage : '代码';
  const isMarkdown = normalizedLanguage === 'markdown' || normalizedLanguage === 'md';
  const copyLabel = isMarkdown ? '复制 Markdown' : '复制代码';

  return (
    <View accessibilityLabel={`${label}代码块`} style={{ width: '100%', overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surfaceSubtle }}>
      <View style={{ minHeight: 36, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{label}</Text>
        <Pressable
          accessibilityLabel={copyLabel}
          accessibilityRole="button"
          onPress={() => {
            void copyCode(content).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            });
          }}
          style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}
        >
          <AppIcon decorative color={colors.brand600} name={copied ? 'check' : 'copy'} size={17} />
        </Pressable>
      </View>
      <Text selectable style={[typography.body, { padding: spacing.sm, color: colors.ink, fontFamily: 'monospace' }]}>{content.replace(/\n$/, '')}</Text>
    </View>
  );
}
