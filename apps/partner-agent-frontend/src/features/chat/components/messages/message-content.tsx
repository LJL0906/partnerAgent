import { Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

type MessageContentProps = { content: string; align?: 'left' | 'right' };
type MessageBlock =
  | { type: 'paragraph'; content: string }
  | { type: 'code'; content: string; language?: string }
  | { type: 'table'; rows: string[][] };

function isJsonObject(content: string) {
  try {
    const value: unknown = JSON.parse(content);
    return typeof value === 'object' && value !== null;
  } catch { return false; }
}

function splitTableRow(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string) { return splitTableRow(line).every((cell) => /^:?-{3,}:?$/.test(cell)); }

function parseMessageBlocks(content: string): MessageBlock[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MessageBlock[] = [];
  let paragraph: string[] = [];
  let code: string[] | null = null;
  let language: string | undefined;
  const flushParagraph = () => {
    if (paragraph.length) {
      const value = paragraph.join('\n');
      blocks.push({ type: 'paragraph', content: isJsonObject(value.trim()) ? JSON.stringify(JSON.parse(value.trim()), null, 2) : value });
      paragraph = [];
    }
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (code) {
      if (/^\s*```\s*$/.test(line)) { blocks.push({ type: 'code', content: code.join('\n'), language }); code = null; language = undefined; }
      else code.push(line);
      continue;
    }
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) { flushParagraph(); code = []; language = fence[1] || undefined; continue; }
    if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      flushParagraph();
      const rows = [splitTableRow(line)];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) { rows.push(splitTableRow(lines[index])); index += 1; }
      index -= 1;
      blocks.push({ type: 'table', rows });
    } else if (!line.trim()) flushParagraph();
    else paragraph.push(line);
  }
  if (code) { paragraph.push(`\`\`\`${language ?? ''}`); paragraph.push(...code); }
  flushParagraph();
  return blocks;
}

function renderParagraph(content: string) {
  const parts = content.split(/(\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g);
  return parts.map((part, index) => {
    const match = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    return match ? <Text key={`link-${index}`} accessibilityLabel={`${match[1]}，链接`} accessibilityRole="link" selectable>{match[1]}</Text> : <Text key={`text-${index}`} selectable>{part}</Text>;
  });
}

export function MessageContent({ content, align = 'left' }: MessageContentProps) {
  const blocks = parseMessageBlocks(content);
  return <View accessibilityLabel="消息正文" style={{ width: '100%', alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
    {blocks.map((block, index) => {
      if (block.type === 'code') return <View key={`code-${index}`} style={{ alignSelf: 'stretch', marginTop: index === 0 ? 0 : spacing.sm, padding: spacing.sm, borderRadius: 8, backgroundColor: colors.aiCore }}><Text selectable style={{ color: colors.surface, fontFamily: 'monospace', ...typography.body }}>{block.content}</Text></View>;
      if (block.type === 'table') return <View key={`table-${index}`} accessibilityLabel="消息表格" accessibilityRole="table" style={{ alignSelf: 'stretch', marginTop: index === 0 ? 0 : spacing.sm, borderColor: colors.border, borderWidth: 1, borderRadius: 8, overflow: 'hidden' }}>{block.rows.map((row, rowIndex) => <View key={`row-${rowIndex}`} accessibilityRole="row" style={{ flexDirection: 'row', borderBottomColor: colors.border, borderBottomWidth: rowIndex === block.rows.length - 1 ? 0 : 1 }}>{row.map((cell, cellIndex) => <Text key={`cell-${cellIndex}`} accessibilityRole="cell" selectable style={{ flex: 1, padding: spacing.sm, color: colors.ink, ...typography.body }}>{cell}</Text>)}</View>)}</View>;
      return <Text key={`paragraph-${index}`} selectable style={{ color: colors.ink, ...typography.body, marginTop: index === 0 ? 0 : spacing.sm }}>{renderParagraph(block.content)}</Text>;
    })}
  </View>;
}
