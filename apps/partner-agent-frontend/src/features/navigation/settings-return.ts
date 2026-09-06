export type SettingsReturnTarget = '/chat';

export interface SettingsReturnRouter {
  back: () => void;
  dismissTo: (href: SettingsReturnTarget) => void;
}

export function resolveSettingsReturnTarget(value: string | string[] | undefined): SettingsReturnTarget | undefined {
  const target = Array.isArray(value) ? value[0] : value;
  return target === 'chat' ? '/chat' : undefined;
}

export function returnFromSettings(router: SettingsReturnRouter, target: SettingsReturnTarget | undefined): void {
  if (target) {
    router.dismissTo(target);
    return;
  }
  router.back();
}
