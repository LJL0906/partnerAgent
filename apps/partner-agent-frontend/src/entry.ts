import { prepareWebRouterBootstrap } from './features/navigation/system-path';

declare const require: (id: string) => unknown;

const shouldLoadRouter = typeof window === 'undefined'
  || prepareWebRouterBootstrap(window.location, (path) => window.location.replace(path));

if (shouldLoadRouter) require('expo-router/entry');
