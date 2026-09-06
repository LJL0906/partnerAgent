import { Animated, Modal, Pressable, View } from 'react-native';

import { colors } from '@/theme/colors';

import { ConversationList } from './session-list';

interface ChatSessionsDrawerProps {
  visible: boolean;
  width: number;
  progress: Animated.Value;
  onClose: () => void;
}

export function ChatSessionsDrawer({ visible, width, progress, onClose }: ChatSessionsDrawerProps) {
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Animated.View renderToHardwareTextureAndroid shouldRasterizeIOS style={{ width, backgroundColor: colors.surface, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }) }] }}>
          <ConversationList onClose={onClose} />
        </Animated.View>
        <Animated.View style={{ flex: 1, opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} />
        </Animated.View>
      </View>
    </Modal>
  );
}
