import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { ConnectionLoadingScreen } from '@/components/ui/connection-loading-screen';
import { AppThemeProvider, ToastProvider } from '@/components/ui/toast';
import { FloatingNavigation } from '@/components/navigation/floating-menu';
import { bootstrapAuth, registerAuthTeardown, useAuthStore } from '@/features/auth';
import { getAuthRouteRedirect } from '@/features/auth/auth-route';
import { resetChatRuntime } from '@/features/chat/use-chat';
import { resetSessionManagement } from '@/features/chat/session-management';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';
export default function RootLayout() {
  return (
    <AppThemeProvider>
      <ToastProvider>
        <RootLayoutContent />
      </ToastProvider>
    </AppThemeProvider>
  );
}

function RootLayoutContent() {
  const isReady = useAuthStore((state) => state.isReady);
  const status = useAuthStore((state) => state.status);
  const router = useRouter();
  const [firstSegment] = useSegments();

  useEffect(() => {
    if (!isReady) return;
    const redirect = getAuthRouteRedirect(status, firstSegment);
    if (redirect) router.replace(redirect);
  }, [firstSegment, isReady, router, status]);

  useEffect(() => {
    const unregisterTeardown = registerAuthTeardown(async () => {
      resetChatRuntime();
      await resetSessionManagement();
    });
    void bootstrapAuth();
    return unregisterTeardown;
  }, []);

  if (!isReady) {
    return (
      <View style={{ flex: 1 }}>
        <StatusBar style="dark" />
        <ConnectionLoadingScreen />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack
        initialRouteName={status === 'authenticated' ? 'chat' : 'auth/index'}
        screenOptions={{
          contentStyle: { backgroundColor: colors.canvas },
          headerBackButtonDisplayMode: 'minimal',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.ink,
          headerTitleStyle: typography.pageTitle,
        }}>
        <Stack.Screen name="auth/index" options={{ headerShown: false }} />
        <Stack.Screen name="auth/register" options={{ headerShown: false }} />
        <Stack.Screen name="chat" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
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
      {status === 'authenticated' ? <FloatingNavigation /> : null}
    </View>
  );
}
