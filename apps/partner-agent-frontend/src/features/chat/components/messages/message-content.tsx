import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type { ReactNode } from 'react';
import { Linking, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { MessageCodeBlock } from './message-code-block';
import { isAudioUrl, isImageUrl, isSafeMediaUrl, isSafePlaybackUrl, isVideoUrl, MessageAudio, MessageImage, MessageVideo } from './message-media';

type MessageContentProps = { content: string; align?: 'left' | 'right'; format?: 'markdown' | 'text'; localizeTimeMetadata?: boolean };
type MarkdownNode = { token: Token; children: MarkdownNode[] };

const markdown = new MarkdownIt({ breaks: true, html: false, linkify: true, typographer: false });
const VIDEO_ALT_PREFIX = 'ziling-video:';
const AUDIO_ALT_PREFIX = 'ziling-audio:';

function escapeAlt(value: string) { return value.replace(/[\[\]\\]/g, '\\$&'); }
function readHtmlAttribute(attributes: string, name: string) {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, 'i'));
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function localizeUserFacingTime(value: string) {
  const timezoneOnlyLine = /^\s*(?:[-*+]\s*)?(?:\*\*)?\s*(?:UTC|GMT)(?:\s*时间)?(?:\*\*)?\s*[：:].*$/i;
  const weekdays: Record<string, string> = {
    Monday: '星期一', Tuesday: '星期二', Wednesday: '星期三', Thursday: '星期四',
    Friday: '星期五', Saturday: '星期六', Sunday: '星期日',
  };
  return value.split('\n')
    .filter((line) => !timezoneOnlyLine.test(line))
    .map((line) => {
      let localized = line
        .replace(/[（(]\s*(?:Asia\/Shanghai|China Standard Time)\s*[，,、/]\s*(北京时间|中国标准时间)\s*[）)]/gi, '（$1）')
        .replace(/\s*[（(]\s*(?:UTC|GMT)\s*时间(?:为|是|：|:)?[^）)]*[）)]/gi, '')
        .replace(/\s*[（(]\s*(?:Asia\/Shanghai|China Standard Time|(?:UTC|GMT)(?:\s*[+-]\s*0?8(?::?00)?)?)\s*[）)]/gi, '')
        .replace(/\b(?:Asia\/Shanghai|China Standard Time)\b/gi, '')
        .replace(/\b(\d{1,2}:\d{2})\s*(AM|PM)\b/gi, (_match, time: string, period: string) => `${period.toUpperCase() === 'AM' ? '上午' : '下午'} ${time}`)
        .replace(/\b(AM|PM)\s*(\d{1,2}:\d{2})\b/gi, (_match, period: string, time: string) => `${period.toUpperCase() === 'AM' ? '上午' : '下午'} ${time}`);
      for (const [english, chinese] of Object.entries(weekdays)) {
        localized = localized.replace(new RegExp(`\\b${english}\\b`, 'gi'), chinese);
      }
      return localized;
    }).join('\n');
}

function normalizeRichSegment(segment: string) {
  let value = segment.replace(/<audio\b([^>]*)>([\s\S]*?)<\/audio>/gi, (_tag, attributes: string, body: string) => {
    const sourceAttributes = body.match(/<source\b([^>]*)>/i)?.[1] ?? '';
    const src = readHtmlAttribute(attributes, 'src') ?? readHtmlAttribute(sourceAttributes, 'src');
    if (!src || !isSafePlaybackUrl(src)) return '';
    const label = readHtmlAttribute(attributes, 'aria-label') ?? readHtmlAttribute(attributes, 'title') ?? '消息音频';
    return `\n![${AUDIO_ALT_PREFIX}${escapeAlt(label)}](${src})\n`;
  });
  value = value.replace(/<audio\b([^>]*)\/?\s*>/gi, (_tag, attributes: string) => {
    const src = readHtmlAttribute(attributes, 'src');
    return src && isSafePlaybackUrl(src) ? `\n![${AUDIO_ALT_PREFIX}消息音频](${src})\n` : '';
  });
  value = value.replace(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi, (_tag, attributes: string, body: string) => {
    const sourceAttributes = body.match(/<source\b([^>]*)>/i)?.[1] ?? '';
    const src = readHtmlAttribute(attributes, 'src') ?? readHtmlAttribute(sourceAttributes, 'src');
    if (!src || !isSafePlaybackUrl(src)) return '';
    const label = readHtmlAttribute(attributes, 'aria-label') ?? readHtmlAttribute(attributes, 'title') ?? '视频';
    return `\n![${VIDEO_ALT_PREFIX}${escapeAlt(label)}](${src})\n`;
  });
  value = value.replace(/<video\b([^>]*)\/?\s*>/gi, (_tag, attributes: string) => {
    const src = readHtmlAttribute(attributes, 'src');
    return src && isSafePlaybackUrl(src) ? `\n![${VIDEO_ALT_PREFIX}视频](${src})\n` : '';
  });
  value = value.replace(/<img\b([^>]*)\/?\s*>/gi, (_tag, attributes: string) => {
    const src = readHtmlAttribute(attributes, 'src');
    if (!src || !isSafeMediaUrl(src)) return '';
    return `\n![${escapeAlt(readHtmlAttribute(attributes, 'alt') ?? '消息图片')}](${src})\n`;
  });
  const normalizedLines = value.split('\n').map((line) => {
    const trimmed = line.trim();
    const markdownLink = trimmed.match(/^\[([^\]]+)]\((https?:\/\/[^\s)]+)\)$/);
    if (markdownLink && isAudioUrl(markdownLink[2])) return `![${AUDIO_ALT_PREFIX}${escapeAlt(markdownLink[1])}](${markdownLink[2]})`;
    if (markdownLink && isVideoUrl(markdownLink[2])) return `![${VIDEO_ALT_PREFIX}${escapeAlt(markdownLink[1])}](${markdownLink[2]})`;
    if (!/^https?:\/\/\S+$/.test(trimmed)) return line;
    if (isImageUrl(trimmed)) return `![消息图片](${trimmed})`;
    if (isVideoUrl(trimmed)) return `![${VIDEO_ALT_PREFIX}消息视频](${trimmed})`;
    if (isAudioUrl(trimmed)) return `![${AUDIO_ALT_PREFIX}消息音频](${trimmed})`;
    return `[${trimmed}](${trimmed})`;
  }).join('\n');
  return normalizedLines.split(/(\n{2,})/).map((block) => {
    const trimmed = block.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return block;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed !== 'object' || parsed === null) return block;
      return `\n\n\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\`\n\n`;
    } catch { return block; }
  }).join('');
}

export function normalizeMessageMarkdown(content: string, localizeTimeMetadata = false) {
  const parts = content.replace(/\r\n?/g, '\n').split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  return parts.map((part, index) => index % 2 === 1
    ? part : normalizeRichSegment(localizeTimeMetadata ? localizeUserFacingTime(part) : part)).join('');
}

export async function openSafeLink(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    await Linking.openURL(parsed.toString());
    return true;
  } catch { return false; }
}

function tokensToTree(tokens: readonly Token[]): MarkdownNode[] {
  const root: MarkdownNode[] = [];
  const stack: MarkdownNode[][] = [root];
  for (const token of tokens) {
    if (token.nesting === -1) { stack.pop(); continue; }
    const node = { token, children: token.children ? tokensToTree(token.children) : [] };
    stack.at(-1)?.push(node);
    if (token.nesting === 1) stack.push(node.children);
  }
  return root;
}

function renderChildren(nodes: MarkdownNode[], path: string, parentType?: string) {
  return nodes.map((node, index) => renderNode(node, `${path}-${index}`, parentType, index));
}

function renderMediaInline(children: MarkdownNode[], key: string) {
  return children.map((child, index) => child.token.type === 'image'
    ? renderNode(child, `${key}-${index}`, 'inline', index)
    : <Text key={`${key}-${index}`} selectable style={{ color: colors.ink, ...typography.body }}>{renderNode(child, `${key}-${index}-content`, 'inline', index)}</Text>);
}

function renderImage(token: Token, key: string) {
  const src = token.attrGet('src') ?? '';
  const alt = token.content ?? token.attrGet('alt') ?? '';
  if (!isSafeMediaUrl(src)) return null;
  if (alt.startsWith(AUDIO_ALT_PREFIX) || isAudioUrl(src)) return <MessageAudio key={key} label={alt.replace(AUDIO_ALT_PREFIX, '')} url={src} />;
  if (alt.startsWith(VIDEO_ALT_PREFIX) || isVideoUrl(src)) return <MessageVideo key={key} label={alt.replace(VIDEO_ALT_PREFIX, '')} url={src} />;
  return <MessageImage key={key} alt={alt} url={src} />;
}

function renderNode(node: MarkdownNode, key: string, parentType?: string, index = 0): ReactNode {
  const { token, children } = node;
  const type = token.type.replace(/_open$/, '');
  const rendered = renderChildren(children, key, type);
  switch (type) {
    case 'inline': return children.some((child) => child.token.type === 'image')
      ? <View key={key} style={{ width: '100%' }}>{renderMediaInline(children, `${key}-media`)}</View>
      : <Text key={key} selectable style={{ color: colors.ink, ...typography.body }}>{rendered}</Text>;
    case 'text': return token.content;
    case 'paragraph': return <View key={key} style={{ width: '100%', marginBottom: spacing.sm, flexDirection: 'row', flexWrap: 'wrap' }}>{rendered}</View>;
    case 'heading': {
      const level = Number(token.tag.slice(1)) || 2;
      return <Text key={key} accessibilityRole="header" selectable style={{ width: '100%', color: colors.ink, fontSize: Math.max(16, 26 - level * 2), lineHeight: Math.max(22, 32 - level * 2), fontWeight: '700', marginBottom: spacing.xs }}>{rendered}</Text>;
    }
    case 'strong': return <Text key={key} style={{ fontWeight: '700' }}>{rendered}</Text>;
    case 'em': return <Text key={key} style={{ fontStyle: 'italic' }}>{rendered}</Text>;
    case 's': return <Text key={key} style={{ textDecorationLine: 'line-through' }}>{rendered}</Text>;
    case 'code_inline': return <Text key={key} style={{ color: colors.brand600, fontFamily: 'monospace', backgroundColor: colors.surfaceSubtle }}>{token.content}</Text>;
    case 'fence': return <MessageCodeBlock key={key} content={token.content} language={token.info} />;
    case 'code_block': return <MessageCodeBlock key={key} content={token.content} />;
    case 'bullet_list': case 'ordered_list': return <View key={key} style={{ width: '100%', marginBottom: spacing.sm }}>{rendered}</View>;
    case 'list_item': return <View key={key} style={{ width: '100%', flexDirection: 'row', marginBottom: spacing.xs }}><Text style={{ width: 24, color: colors.brand600 }}>{parentType === 'ordered_list' ? `${index + 1}.` : '•'}</Text><View style={{ flex: 1 }}>{rendered}</View></View>;
    case 'blockquote': return <View key={key} style={{ width: '100%', marginBottom: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderLeftWidth: 3, borderLeftColor: colors.brand400, backgroundColor: colors.infoSoft }}>{rendered}</View>;
    case 'link': return <Text key={key} accessibilityLabel="消息链接" accessibilityRole="link" onPress={() => { void openSafeLink(token.attrGet('href') ?? ''); }} selectable style={{ color: colors.brand600, textDecorationLine: 'underline' }}>{rendered}</Text>;
    case 'image': return renderImage(token, key);
    case 'softbreak': case 'hardbreak': return '\n';
    case 'hr': return <View key={key} style={{ width: '100%', height: 1, marginVertical: spacing.sm, backgroundColor: colors.divider }} />;
    case 'table': return <View key={key} accessibilityLabel="消息表格" style={{ width: '100%', marginBottom: spacing.sm, overflow: 'hidden', borderColor: colors.border, borderWidth: 1, borderRadius: 8 }}>{rendered}</View>;
    case 'thead': case 'tbody': return <View key={key}>{rendered}</View>;
    case 'tr': return <View key={key} style={{ flexDirection: 'row', borderBottomColor: colors.border, borderBottomWidth: 1 }}>{rendered}</View>;
    case 'th': return <View key={key} style={{ flex: 1, padding: spacing.sm, backgroundColor: colors.surfaceSubtle }}>{rendered}</View>;
    case 'td': return <View key={key} style={{ flex: 1, padding: spacing.sm }}>{rendered}</View>;
    default: return rendered.length ? <View key={key}>{rendered}</View> : token.content || null;
  }
}

export function MessageContent({ content, align = 'left', format = 'markdown', localizeTimeMetadata = false }: MessageContentProps) {
  if (format === 'text') return <View accessibilityLabel="消息正文" style={{ maxWidth: '100%', flexShrink: 1, alignSelf: align === 'right' ? 'flex-end' : 'flex-start' }}><Text selectable style={{ maxWidth: '100%', flexShrink: 1, color: colors.ink, textAlign: 'left', ...typography.body }}>{localizeTimeMetadata ? localizeUserFacingTime(content) : content}</Text></View>;
  const normalized = normalizeMessageMarkdown(content, localizeTimeMetadata);
  const nodes = tokensToTree(markdown.parse(normalized, {}));
  return <View accessibilityLabel="消息正文" style={{ width: '100%', alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>{renderChildren(nodes, 'markdown')}</View>;
}
