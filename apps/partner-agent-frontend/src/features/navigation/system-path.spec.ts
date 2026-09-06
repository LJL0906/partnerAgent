import { describe, expect, it } from 'vitest';

import { prepareWebRouterBootstrap, sanitizeSystemPath } from './system-path';

describe('sanitizeSystemPath', () => {
  it.each([
    'partner-agent://chat?value=%',
    'partner-agent://chat?value=%2',
    'partner-agent://chat?value=%GG',
  ])('rejects malformed percent encoding before Expo Router parses %s', (path) => {
    expect(sanitizeSystemPath(path)).toBe('/auth');
  });

  it('rejects oversized external paths', () => {
    expect(sanitizeSystemPath(`partner-agent://chat?value=${'a'.repeat(2048)}`)).toBe('/auth');
  });

  it('rejects excessive encoded input even when each escape is valid', () => {
    expect(sanitizeSystemPath(`partner-agent://chat?value=${'%25'.repeat(65)}`)).toBe('/auth');
  });

  it('preserves ordinary internal and application deep links', () => {
    expect(sanitizeSystemPath('/chat')).toBe('/chat');
    expect(sanitizeSystemPath('partner-agent://chat?source=notification')).toBe(
      'partner-agent://chat?source=notification',
    );
  });

  it('redirects an unsafe initial Web location before Router is loaded', () => {
    const replacements: string[] = [];

    expect(prepareWebRouterBootstrap(
      { pathname: '/chat', search: `?value=${'%25'.repeat(65)}`, hash: '' },
      (path) => replacements.push(path),
    )).toBe(false);
    expect(replacements).toEqual(['/auth']);
  });

  it('allows a bounded initial Web location without redirecting', () => {
    const replacements: string[] = [];

    expect(prepareWebRouterBootstrap(
      { pathname: '/chat', search: '?source=history', hash: '#latest' },
      (path) => replacements.push(path),
    )).toBe(true);
    expect(replacements).toEqual([]);
  });
});
