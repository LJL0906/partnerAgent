export type ServerUrlPlatform = 'web' | 'android' | 'ios' | string;
export type ServerUrlSource =
  | 'environment'
  | 'expoConfig.hostUri'
  | 'expoGoConfig.debuggerHost'
  | 'platform-fallback'
  | 'missing';

export interface ResolveServerUrlOptions {
  environmentUrl?: string;
  expoHostUri?: string;
  legacyDebuggerHost?: string;
  platform: ServerUrlPlatform;
  isDevelopment: boolean;
}

export interface ServerUrlResolution {
  serverUrl?: string;
  displayUrl?: string;
  source: ServerUrlSource;
  configError?: string;
}

export class ServerUrlConfigurationError extends Error {
  readonly code = 'SERVER_URL_CONFIGURATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'ServerUrlConfigurationError';
  }
}

function normalizeHttpUrl(rawUrl: string): string | undefined {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    if (parsed.username || parsed.password) {
      return undefined;
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

function backendUrlFromExpoHost(rawHost: string): string | undefined {
  try {
    const candidate = rawHost.includes('://') ? rawHost : `http://${rawHost}`;
    const parsed = new URL(candidate);
    if (!parsed.hostname) {
      return undefined;
    }

    const hostname = parsed.hostname.includes(':') && !parsed.hostname.startsWith('[')
      ? `[${parsed.hostname}]`
      : parsed.hostname;
    return `http://${hostname}:3000`;
  } catch {
    return undefined;
  }
}

function developmentPlatformFallback(platform: ServerUrlPlatform): string | undefined {
  if (platform === 'android') {
    return 'http://10.0.2.2:3000';
  }
  if (platform === 'ios' || platform === 'web') {
    return 'http://localhost:3000';
  }
  return undefined;
}

export function resolveServerUrl(options: ResolveServerUrlOptions): ServerUrlResolution {
  const configuredUrl = options.environmentUrl?.trim();
  if (configuredUrl) {
    const serverUrl = normalizeHttpUrl(configuredUrl);
    if (!serverUrl) {
      return {
        source: 'environment',
        configError: 'EXPO_PUBLIC_SERVER_URL 必须是有效的 http 或 https 地址。',
      };
    }
    return { serverUrl, displayUrl: serverUrl, source: 'environment' };
  }

  if (!options.isDevelopment) {
    return {
      source: 'missing',
      configError: '生产构建缺少 EXPO_PUBLIC_SERVER_URL，已停止连接后端。',
    };
  }

  const expoHostCandidates: [ServerUrlSource, string | undefined][] = [
    ['expoConfig.hostUri', options.expoHostUri],
    ['expoGoConfig.debuggerHost', options.legacyDebuggerHost],
  ];
  for (const [source, rawHost] of expoHostCandidates) {
    if (!rawHost?.trim()) {
      continue;
    }
    const serverUrl = backendUrlFromExpoHost(rawHost.trim());
    if (serverUrl) {
      return { serverUrl, displayUrl: serverUrl, source };
    }
  }

  const serverUrl = developmentPlatformFallback(options.platform);
  if (serverUrl) {
    return { serverUrl, displayUrl: serverUrl, source: 'platform-fallback' };
  }

  return {
    source: 'missing',
    configError: '无法确定开发服务器地址，请配置 EXPO_PUBLIC_SERVER_URL。',
  };
}

export function requireResolvedServerUrl(resolution: ServerUrlResolution): string {
  if (!resolution.serverUrl) {
    throw new ServerUrlConfigurationError(
      resolution.configError ?? '后端服务地址未配置。',
    );
  }
  return resolution.serverUrl;
}
