import { ScrollView, Text, View } from 'react-native';

import { colors } from '@/theme/colors';

interface PlaceholderScreenProps {
  description: string;
}

export function PlaceholderScreen({ description }: PlaceholderScreenProps) {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: 'center' }}>
      <View style={{ gap: 10 }}>
        <Text selectable style={{ color: colors.textSecondary, fontSize: 16, lineHeight: 24 }}>
          {description}
        </Text>
      </View>
    </ScrollView>
  );
}
