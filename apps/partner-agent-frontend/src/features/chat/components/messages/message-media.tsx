import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:$|[?#])/i;
const VIDEO_EXTENSION = /\.(?:m3u8|m4v|mov|mp4|webm)(?:$|[?#])/i;
const AUDIO_EXTENSION = /\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav)(?:$|[?#])/i;

export function isSafeMediaUrl(url: string) {
  if (/^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i.test(url)) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch { return false; }
}

export function isSafePlaybackUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch { return false; }
}

export function isImageUrl(url: string) { return IMAGE_EXTENSION.test(url); }
export function isVideoUrl(url: string) { return VIDEO_EXTENSION.test(url); }
export function isAudioUrl(url: string) { return AUDIO_EXTENSION.test(url); }

function PreviewCloseButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel="关闭预览"
      accessibilityRole="button"
      onPress={onPress}
      style={{ position: 'absolute', right: spacing.lg, top: 48, zIndex: 1, width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.16)' }}
    >
      <AppIcon decorative color="#FFFFFF" name="close" size={24} />
    </Pressable>
  );
}

export function MessageImage({ alt, url }: { alt?: string; url: string }) {
  const [previewVisible, setPreviewVisible] = useState(false);
  if (!isSafeMediaUrl(url)) return null;
  const label = alt || '消息图片';
  return (
    <View accessibilityLabel={label} style={{ width: '100%', marginVertical: 4 }}>
      <Pressable accessibilityLabel="打开图片预览" accessibilityRole="button" onPress={() => setPreviewVisible(true)}>
        <Image
          accessibilityLabel={label}
          contentFit="contain"
          source={{ uri: url }}
          style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 10, backgroundColor: colors.surfaceSubtle }}
        />
      </Pressable>
      <Modal animationType="fade" onRequestClose={() => setPreviewVisible(false)} presentationStyle="overFullScreen" statusBarTranslucent transparent visible={previewVisible}>
        <View accessibilityLabel={`${label}全屏预览`} style={{ flex: 1, backgroundColor: '#000000' }}>
          <PreviewCloseButton onPress={() => setPreviewVisible(false)} />
          <Image accessibilityLabel={label} contentFit="contain" source={{ uri: url }} style={{ flex: 1, width: '100%' }} />
        </View>
      </Modal>
    </View>
  );
}

export function MessageVideo({ label = '消息视频', url }: { label?: string; url: string }) {
  const safeUrl = isSafePlaybackUrl(url) ? url : null;
  const [previewVisible, setPreviewVisible] = useState(false);
  const player = useVideoPlayer(safeUrl, (instance) => {
    instance.loop = true;
  });
  if (!safeUrl) return null;

  const openPreview = () => {
    player.play();
    setPreviewVisible(true);
  };
  const closePreview = () => {
    player.pause();
    setPreviewVisible(false);
  };

  return (
    <View accessibilityLabel={label} style={{ width: '100%', marginVertical: 4 }}>
      <Pressable accessibilityLabel="打开视频预览" accessibilityRole="button" onPress={openPreview}>
        {!previewVisible ? (
          <VideoView contentFit="contain" nativeControls={false} player={player} style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 10, backgroundColor: colors.aiCore }} />
        ) : <View style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 10, backgroundColor: colors.aiCore }} />}
      </Pressable>
      <Modal animationType="fade" onRequestClose={closePreview} presentationStyle="overFullScreen" statusBarTranslucent transparent visible={previewVisible}>
        <View accessibilityLabel={`${label}全屏预览`} style={{ flex: 1, justifyContent: 'center', backgroundColor: '#000000' }}>
          <PreviewCloseButton onPress={closePreview} />
          <VideoView contentFit="contain" fullscreenOptions={{ enable: true }} nativeControls player={player} style={{ width: '100%', aspectRatio: 16 / 9 }} />
        </View>
      </Modal>
    </View>
  );
}

function formatDuration(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const seconds = Math.floor(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function mediaFilename(url: string) {
  try {
    const name = new URL(url).pathname.split('/').filter(Boolean).at(-1);
    return name ? decodeURIComponent(name) : '消息音频';
  } catch { return '消息音频'; }
}

export function MessageAudio({ label = '消息音频', url }: { label?: string; url: string }) {
  const safeUrl = isSafePlaybackUrl(url) ? url : null;
  const player = useAudioPlayer(safeUrl);
  const status = useAudioPlayerStatus(player);
  if (!safeUrl) return null;
  const displayLabel = label === '消息音频' ? mediaFilename(safeUrl) : label;
  return (
    <View accessibilityLabel={displayLabel} style={{ width: '100%', marginVertical: 4, padding: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surfaceSubtle }}>
      <Pressable
        accessibilityLabel={status.playing ? '暂停音频' : '播放音频'}
        accessibilityRole="button"
        onPress={() => { if (status.playing) player.pause(); else player.play(); }}
        style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.infoSoft }}
      >
        <AppIcon decorative color={colors.brand600} name={status.playing ? 'pause' : 'play'} size={19} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} selectable style={[typography.body, { color: colors.ink }]}>{displayLabel}</Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{formatDuration(status.currentTime)} / {formatDuration(status.duration)}</Text>
      </View>
    </View>
  );
}
