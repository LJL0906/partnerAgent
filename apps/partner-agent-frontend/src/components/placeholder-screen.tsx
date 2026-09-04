import { useRouter } from 'expo-router';
import { ScrollView, useWindowDimensions, View } from 'react-native';

import { FeedbackState } from '@/components/ui/feedback-state';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

interface PlaceholderScreenProps {
  description: string;
}

export function PlaceholderScreen({ description }: PlaceholderScreenProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.canvas }}
      contentContainerStyle={{
        alignItems: 'center',
        flexGrow: 1,
        justifyContent: 'center',
        padding: width <= 320 ? spacing.md : spacing.page,
      }}>
      <View style={{ maxWidth: 440, width: '100%' }}>
        <FeedbackState
          type="empty"
          title={description}
          description={null}
          actionLabel="前往助手"
          onAction={() => router.navigate('/')}
        />
      </View>
    </ScrollView>
  );
}
