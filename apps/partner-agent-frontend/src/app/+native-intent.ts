import { sanitizeSystemPath } from '@/features/navigation/system-path';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return sanitizeSystemPath(path);
}
