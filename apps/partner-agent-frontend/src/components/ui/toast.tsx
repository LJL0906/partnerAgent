import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import { Modal, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Provider as PaperProvider, Snackbar } from 'react-native-paper';
import { AppIcon, type AppIconName } from '@/components/ui/app-icon';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { shadows } from '@/theme/shadows';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type ToastType = 'success' | 'warning' | 'error' | 'info';

export interface ToastOptions {
  message: string;
  type?: ToastType;
  duration?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

interface ToastContextValue {
  showToast: (options: ToastOptions | string) => void;
  dismissToast: () => void;
}

export interface ToastProviderProps extends PropsWithChildren {
  styles?: Partial<Record<ToastType, StyleProp<ViewStyle>>>;
  textStyles?: Partial<Record<ToastType, StyleProp<TextStyle>>>;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const paperTheme = {
  version: 3 as const,
  dark: false,
  roundness: 16,
  colors: {
    primary: colors.brand500,
    onPrimary: colors.surface,
    primaryContainer: colors.infoSoft,
    onPrimaryContainer: colors.ink,
    secondary: colors.violet500,
    onSecondary: colors.surface,
    secondaryContainer: colors.surfaceSubtle,
    onSecondaryContainer: colors.ink,
    background: colors.canvas,
    onBackground: colors.ink,
    surface: colors.surface,
    onSurface: colors.ink,
    surfaceVariant: colors.surfaceSubtle,
    onSurfaceVariant: colors.textSecondary,
    outline: colors.border,
    error: colors.danger,
    onError: colors.surface,
    errorContainer: colors.dangerSoft,
    onErrorContainer: colors.ink,
    inverseSurface: colors.ink,
    inverseOnSurface: colors.surface,
    inversePrimary: colors.brand400,
    shadow: colors.ink,
    scrim: colors.overlay,
  },
};

const toastColors: Record<ToastType, string> = {
  success: colors.success,
  warning: colors.warning,
  error: colors.danger,
  info: colors.info,
};
const toastBorders: Record<ToastType, string> = {
  success: colors.toastSuccessBorder,
  warning: colors.toastWarningBorder,
  error: colors.toastDangerBorder,
  info: colors.toastInfoBorder,
};
const toastTints: Record<ToastType, string> = {
  success: colors.toastSuccessTint,
  warning: colors.toastWarningTint,
  error: colors.toastDangerTint,
  info: colors.toastInfoTint,
};
const toastIcons: Record<ToastType, AppIconName> = {
  success: 'check', warning: 'warning', error: 'error', info: 'info',
};

export function AppThemeProvider({ children }: PropsWithChildren) {
  return <PaperProvider theme={paperTheme}>{children}</PaperProvider>;
}

export function ToastProvider({ children, styles, textStyles }: ToastProviderProps) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<(ToastOptions & { key: number }) | undefined>();
  const showToast = useCallback((options: ToastOptions | string) => {
    const resolved = typeof options === 'string' ? { message: options } : options;
    setToast({ type: 'info', duration: 3000, ...resolved, key: Date.now() });
  }, []);
  const dismissToast = useCallback(() => setToast(undefined), []);
  const contextValue = useMemo(() => ({ showToast, dismissToast }), [dismissToast, showToast]);
  const toastType = toast?.type ?? 'info';
  const toastColor = toastColors[toastType];
  const toastBorder = toastBorders[toastType];

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <Modal
        animationType="none"
        transparent
        visible={Boolean(toast)}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={dismissToast}
      >
        <View pointerEvents="box-none" style={{ flex: 1 }}>
          <Snackbar
            key={toast?.key}
            visible={Boolean(toast)}
            onDismiss={dismissToast}
            duration={toast?.duration ?? 3000}
            wrapperStyle={{ top: insets.top + spacing.sm, bottom: undefined, paddingHorizontal: spacing.md }}
            style={[{ backgroundColor: colors.toastSurface, borderColor: toastBorder, borderWidth: 1, borderRadius: radius.large, borderCurve: 'continuous', boxShadow: shadows.float, minHeight: 56, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }, toast ? styles?.[toast.type ?? 'info'] : undefined, toast?.style]}
            action={{ label: '关闭', onPress: dismissToast, textColor: colors.textTertiary }}>
          <View style={{ position: 'relative', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, overflow: 'hidden', paddingVertical: spacing.xxs }}>
            <View style={{ position: 'absolute', left: -spacing.xs, top: -spacing.md, width: spacing.xs, height: 72, borderRadius: radius.pill, backgroundColor: toastColor }} />
            <View style={{ position: 'absolute', right: -spacing.xl, top: -spacing.xxl, width: 88, height: 88, borderRadius: radius.pill, backgroundColor: toastTints[toastType], opacity: 0.72 }} />
            <View style={{ position: 'absolute', right: spacing.xl, top: -spacing.sm, width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.toastDecor }} />
            <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: radius.medium, backgroundColor: toastTints[toastType], borderColor: toastBorder, borderWidth: 1 }}>
              <AppIcon decorative name={toastIcons[toastType]} color={toastColor} size={17} />
            </View>
            <Text numberOfLines={3} style={[typography.body, { color: colors.toastText, flex: 1, zIndex: 1 }, toast ? textStyles?.[toast.type ?? 'info'] ?? toast.textStyle : undefined]}>{toast?.message ?? ''}</Text>
          </View>
          </Snackbar>
        </View>
      </Modal>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast 必须在 ToastProvider 内使用。');
  return context;
}
