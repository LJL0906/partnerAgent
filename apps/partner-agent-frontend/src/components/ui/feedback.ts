import { useCallback, useMemo } from 'react';
import * as Haptics from 'expo-haptics';
import { useAudioPlayer } from 'expo-audio';

const errorSound = require('../../../assets/audio/feedback-error.wav');
const successSound = require('../../../assets/audio/feedback-success.wav');

export interface FeedbackPreferences {
  haptics?: boolean;
  sounds?: boolean;
}

export function useFeedback(preferences: FeedbackPreferences = {}) {
  const errorPlayer = useAudioPlayer(errorSound);
  const successPlayer = useAudioPlayer(successSound);
  const hapticsEnabled = preferences.haptics !== false;
  const soundsEnabled = preferences.sounds !== false;

  const play = useCallback(async (player: typeof errorPlayer) => {
    if (!soundsEnabled) return;
    try {
      await player.seekTo(0);
      player.play();
    } catch {
      // Sound is optional feedback; never block authentication.
    }
  }, [soundsEnabled]);

  const submit = useCallback(() => {
    if (hapticsEnabled) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, [hapticsEnabled]);

  const warning = useCallback(() => {
    if (hapticsEnabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    void play(errorPlayer);
  }, [errorPlayer, hapticsEnabled, play]);

  const error = useCallback(() => {
    if (hapticsEnabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    void play(errorPlayer);
  }, [errorPlayer, hapticsEnabled, play]);

  const success = useCallback(() => {
    if (hapticsEnabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    void play(successPlayer);
  }, [hapticsEnabled, play, successPlayer]);

  return useMemo(() => ({ submit, warning, error, success }), [error, submit, success, warning]);
}
