import { Tabs } from 'expo-router';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.ink,
        headerTitleStyle: typography.pageTitle,
        sceneStyle: { backgroundColor: colors.canvas },
        tabBarStyle: { display: 'none' },
      }}>
    </Tabs>
  );
}
