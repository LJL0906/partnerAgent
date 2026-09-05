import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppTabIcon } from '@/components/ui/app-tab-icon';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.ink,
        headerTitleStyle: typography.pageTitle,
        sceneStyle: { backgroundColor: colors.canvas },
        tabBarActiveTintColor: colors.brand500,
        tabBarHideOnKeyboard: true,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarItemStyle: { minHeight: 64, minWidth: 0, paddingTop: spacing.xs },
        tabBarLabelPosition: 'below-icon',
        tabBarLabelStyle: { ...typography.label, paddingBottom: spacing.xs },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
          height: 72 + insets.bottom,
          paddingBottom: insets.bottom,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          headerShown: false,
          title: '伙伴',
          tabBarAccessibilityLabel: '助手',
          tabBarIcon: ({ focused }) => (
            <AppTabIcon accessibilityLabel="助手" focused={focused} name="assistant" />
          ),
          tabBarLabel: '助手',
        }}
      />
      <Tabs.Screen
        name="today"
        options={{
          href: null,
          title: '今日',
          tabBarAccessibilityLabel: '今日',
          tabBarIcon: ({ focused }) => (
            <AppTabIcon accessibilityLabel="今日" focused={focused} name="today" />
          ),
          tabBarLabel: '今日',
        }}
      />
      <Tabs.Screen
        name="execute"
        options={{
          href: null,
          title: '执行',
          tabBarAccessibilityLabel: '执行',
          tabBarIcon: ({ focused }) => (
            <AppTabIcon accessibilityLabel="执行" focused={focused} name="execute" />
          ),
          tabBarLabel: '执行',
        }}
      />
      <Tabs.Screen
        name="memory"
        options={{
          href: null,
          title: '记忆',
          tabBarAccessibilityLabel: '记忆',
          tabBarIcon: ({ focused }) => (
            <AppTabIcon accessibilityLabel="记忆" focused={focused} name="memory" />
          ),
          tabBarLabel: '记忆',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          headerShown: false,
          title: '设置',
          tabBarAccessibilityLabel: '设置',
          tabBarIcon: ({ focused }) => (
            <AppTabIcon accessibilityLabel="设置" focused={focused} name="profile" />
          ),
          tabBarLabel: '设置',
        }}
      />
    </Tabs>
  );
}
