import { describe, expect, it } from 'vitest';

import { getAuthRouteRedirect } from './auth-route';

describe('auth route guard', () => {
  it.each(['unauthenticated', 'expired', 'error'] as const)(
    'redirects protected routes to login for %s state',
    (status) => {
      expect(getAuthRouteRedirect(status, 'chat')).toBe('/auth');
      expect(getAuthRouteRedirect(status, '(tabs)')).toBe('/auth');
      expect(getAuthRouteRedirect(status, 'privacy-decision')).toBe('/auth');
    },
  );

  it('redirects an authenticated user away from auth routes', () => {
    expect(getAuthRouteRedirect('authenticated', 'auth')).toBe('/chat');
  });

  it('does not navigate while bootstrapping or when already in the correct route group', () => {
    expect(getAuthRouteRedirect('bootstrapping', 'chat')).toBeUndefined();
    expect(getAuthRouteRedirect('authenticated', 'chat')).toBeUndefined();
    expect(getAuthRouteRedirect('expired', 'auth')).toBeUndefined();
  });
});
