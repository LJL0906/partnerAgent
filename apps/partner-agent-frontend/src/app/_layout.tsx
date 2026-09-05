import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { FeedbackState } from '@/components/ui/feedback-state';
import { bootstrapAuth, registerAuthTeardown, useAuthStore } from '@/features/auth';
import { resetChatRuntime } from '@/features/chat/use-chat';
import { reset会话管理 } from '@/features/chat/会话管理';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';

import AuthRoute from './auth';

export default function RootLayout() {
  const isReady = useAuthStore((state) => state.isReady);
  const status = useAuthStore((state) => state.status);
  const router = useRouter();
  const [firstSegment] = useSegments();

  useEffect(() => {
    if (status === 'authenticated' && firstSegment === 'auth') router.replace('/');
  }, [firstSegment, router, status]);

  useEffect(() => {
    const unregisterTeardown = registerAuthTeardown(async () => {
      resetChatRuntime();
      await reset会话管理();
    });
    void bootstrapAuth();
    return unregisterTeardown;
  }, []);

  if (!isReady) {
    return (
      <View style={{ backgroundColor: colors.canvas, flex: 1, justifyContent: 'center' }}>
        <StatusBar style="dark" />
        <FeedbackState description="正在恢复安全会话。" title="正在准备伙伴" type="loading" />
      </View>
    );
  }

  if (status !== 'authenticated') {
    return (
      <>
        <StatusBar style="dark" />
        <AuthRoute />
      </>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        initialRouteName="(tabs)"
        screenOptions={{
          contentStyle: { backgroundColor: colors.canvas },
          headerBackButtonDisplayMode: 'minimal',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.ink,
          headerTitleStyle: typography.pageTitle,
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="sessions" options={{ title: '历史对话' }} />
        <Stack.Screen
          name="privacy-decision"
          options={{
            presentation: process.env.EXPO_OS === 'ios' ? 'formSheet' : 'modal',
            sheetGrabberVisible: true,
            sheetAllowedDetents: [0.75, 1],
            title: '发送前隐私检查',
          }}
        />
      </Stack>
    </>
  );
}
