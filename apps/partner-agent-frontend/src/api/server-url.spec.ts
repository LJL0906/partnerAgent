import { describe, expect, it } from 'vitest';

import {
  requireResolvedServerUrl,
  resolveServerUrl,
  ServerUrlConfigurationError,
} from './server-url';

const developmentDefaults = {
  platform: 'ios',
  isDevelopment: true,
};

describe('server URL resolution', () => {
  it('keeps native LAN routing separate from the Web localhost override', () => {
    const options = {
      isDevelopment: true,
      environmentUrl: 'http://192.168.1.5:3000',
      webEnvironmentUrl: 'http://localhost:3000',
    };
    expect(resolveServerUrl({ ...options, platform: 'web' }).serverUrl).toBe('http://localhost:3000');
    expect(resolveServerUrl({ ...options, platform: 'android' }).serverUrl).toBe('http://192.168.1.5:3000');
    expect(resolveServerUrl({ ...options, platform: 'ios' }).serverUrl).toBe('http://192.168.1.5:3000');
  });

  it('prefers a valid environment URL and removes trailing slashes', () => {
    expect(resolveServerUrl({
      ...developmentDefaults,
      environmentUrl: ' https://api.example.test/base/// ',
      expoHostUri: '192.168.1.8:8081',
    })).toEqual({
      serverUrl: 'https://api.example.test/base',
      displayUrl: 'https://api.example.test/base',
      source: 'environment',
    });
  });

  it('does not silently fall back when the environment URL is invalid', () => {
    const result = resolveServerUrl({
      ...developmentDefaults,
      environmentUrl: 'ftp://api.example.test',
      expoHostUri: '192.168.1.8:8081',
    });

    expect(result.serverUrl).toBeUndefined();
    expect(result.source).toBe('environment');
    expect(() => requireResolvedServerUrl(result)).toThrow(ServerUrlConfigurationError);
  });

  it('rejects server URLs containing credentials so diagnostics cannot expose them', () => {
    const result = resolveServerUrl({
      ...developmentDefaults,
      environmentUrl: 'http://user:password@api.example.test',
    });

    expect(result.serverUrl).toBeUndefined();
    expect(result.source).toBe('environment');
  });

  it.each([
    ['192.168.1.8:8081', 'http://192.168.1.8:3000'],
    ['http://dev-machine.local:8081/index.bundle', 'http://dev-machine.local:3000'],
    ['http://[::1]:8081', 'http://[::1]:3000'],
  ])('derives backend port 3000 from Expo host %s', (expoHostUri, expected) => {
    expect(resolveServerUrl({ ...developmentDefaults, expoHostUri })).toMatchObject({
      serverUrl: expected,
      source: 'expoConfig.hostUri',
    });
  });

  it('prefers expoConfig.hostUri over the legacy Expo Go debugger host', () => {
    expect(resolveServerUrl({
      ...developmentDefaults,
      expoHostUri: '192.168.1.10:8081',
      legacyDebuggerHost: '192.168.1.99:8081',
    })).toMatchObject({
      serverUrl: 'http://192.168.1.10:3000',
      source: 'expoConfig.hostUri',
    });
  });

  it.each([
    ['web', 'http://localhost:3000'],
    ['ios', 'http://localhost:3000'],
    ['android', 'http://10.0.2.2:3000'],
  ])('uses a safe %s development fallback', (platform, expected) => {
    expect(resolveServerUrl({ platform, isDevelopment: true })).toMatchObject({
      serverUrl: expected,
      source: 'platform-fallback',
    });
  });

  it('never derives a production URL from Expo host metadata', () => {
    const result = resolveServerUrl({
      platform: 'android',
      isDevelopment: false,
      expoHostUri: '192.168.1.8:8081',
      legacyDebuggerHost: '192.168.1.9:8081',
    });

    expect(result).toMatchObject({ source: 'missing' });
    expect(result.serverUrl).toBeUndefined();
    expect(result.configError).toContain('生产构建缺少');
  });
});
