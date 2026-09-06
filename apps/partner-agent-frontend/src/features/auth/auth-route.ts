import type { AuthStatus } from './auth-store';

export type AuthRouteRedirect = '/auth' | '/chat';

export function getAuthRouteRedirect(
  status: AuthStatus,
  firstSegment: string | undefined,
): AuthRouteRedirect | undefined {
  const isAuthRoute = firstSegment === 'auth';
  if (status === 'authenticated') return isAuthRoute ? '/chat' : undefined;
  if (status === 'bootstrapping') return undefined;
  return isAuthRoute ? undefined : '/auth';
}
