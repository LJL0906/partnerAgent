import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Animated: {}, Modal: vi.fn(), PanResponder: { create: vi.fn() }, Pressable: vi.fn(),
  StyleSheet: { absoluteFill: {} }, Text: vi.fn(), useWindowDimensions: () => ({ width: 400, height: 800 }), View: vi.fn(),
}));
vi.mock('expo-router', () => ({ usePathname: () => '/chat', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
vi.mock('@/components/ui/app-icon', () => ({ AppIcon: vi.fn() }));

// eslint-disable-next-line import/first
import { getHeaderNavigationPopoverTop, HEADER_NAV_BUTTON_SIZE, shouldRenderFloatingNavigation } from './floating-menu';

describe('chat navigation placement', () => {
  it('replaces the draggable chat overlay with a compact header trigger', () => {
    expect(shouldRenderFloatingNavigation('/chat')).toBe(false);
    expect(shouldRenderFloatingNavigation('/today')).toBe(true);
    expect(HEADER_NAV_BUTTON_SIZE).toBe(44);
  });

  it('places the menu below the measured trigger without covering it', () => {
    expect(getHeaderNavigationPopoverTop(52, HEADER_NAV_BUTTON_SIZE)).toBe(102);
  });
});
