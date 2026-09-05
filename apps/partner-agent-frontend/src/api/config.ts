import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { requireResolvedServerUrl, resolveServerUrl } from './server-url';

const serverUrlResolution = resolveServerUrl({
  environmentUrl: process.env.EXPO_PUBLIC_SERVER_URL,
  webEnvironmentUrl: process.env.EXPO_PUBLIC_WEB_SERVER_URL,
  expoHostUri: Constants.expoConfig?.hostUri,
  legacyDebuggerHost: Constants.expoGoConfig?.debuggerHost,
  platform: Platform.OS,
  isDevelopment: typeof __DEV__ === 'undefined' || __DEV__,
});

export const apiConfig = {
  get serverUrl(): string {
    return requireResolvedServerUrl(serverUrlResolution);
  },
  serverUrlSource: serverUrlResolution.source,
  serverUrlDisplay: serverUrlResolution.displayUrl,
  serverUrlConfigError: serverUrlResolution.configError,
  submitTextPath: '/api/v1/inputs/text',
  cancelTaskPath: '/api/v1/tasks/cancel',
  submitPrivacyDecisionPath: '/api/v1/privacy-decisions/submit',
  taskPath: '/api/v1/tasks',
  chatSessionPath: '/api/v1/chat-sessions',
  streamNamespace: '/ws/v1',
} as const;
