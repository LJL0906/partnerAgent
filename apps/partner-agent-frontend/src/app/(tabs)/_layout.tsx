import { Tabs } from 'expo-router';

import { colors } from '@/theme/colors';

const tabScreenOptions = {
  headerStyle: { backgroundColor: colors.bg },
  headerShadowVisible: false,
  headerTitleStyle: { color: colors.text, fontSize: 22, fontWeight: '700' as const },
  sceneStyle: { backgroundColor: colors.bg },
  tabBarActiveTintColor: colors.primary,
  tabBarInactiveTintColor: colors.textSecondary,
  tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, height: 72 },
  tabBarItemStyle: { minWidth: 0 },
  tabBarLabelStyle: { fontSize: 13, fontWeight: '600' as const, paddingBottom: 8 },
  tabBarIconStyle: { display: 'none' as const },
};

export default function TabsLayout() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="index" options={{ title: '伙伴', tabBarLabel: '助手' }} />
      <Tabs.Screen name="today" options={{ title: '今日', tabBarLabel: '今日' }} />
      <Tabs.Screen name="execute" options={{ title: '执行', tabBarLabel: '执行' }} />
      <Tabs.Screen name="memory" options={{ title: '记忆', tabBarLabel: '记忆' }} />
      <Tabs.Screen name="profile" options={{ title: '我的', tabBarLabel: '我的' }} />
    </Tabs>
  );
}
