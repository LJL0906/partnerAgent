import { getDefaultConfig } from 'expo/metro-config';
// @ts-expect-error This Node-only config test is excluded from the Expo runtime bundle.
import path from 'node:path';
// @ts-expect-error This Node-only config test is excluded from the Expo runtime bundle.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import config from '../metro.config.js';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractsRoot = path.resolve(frontendRoot, '../../packages/contracts');
const backendRoot = path.resolve(frontendRoot, '../partner-agent-backend');
const workspaceNodeModules = path.resolve(frontendRoot, '../../node_modules');

describe('Metro configuration', () => {
  it('pre-watches only the external contracts workspace', () => {
    const watchFolders = config.watchFolders.map((folder: string) => path.resolve(folder));

    expect(watchFolders).toEqual([contractsRoot]);
    expect(watchFolders).not.toContain(path.resolve(config.projectRoot));
    expect(watchFolders).not.toContain(backendRoot);
    expect(watchFolders).not.toContain(workspaceNodeModules);
  });

  it('bounds transform concurrency without replacing the default resolver', () => {
    const defaults = getDefaultConfig(frontendRoot);

    expect(config.maxWorkers).toBeGreaterThan(0);
    expect(config.maxWorkers).toBeLessThanOrEqual(2);
    expect(config.resolver).toEqual(defaults.resolver);
    expect(config.resolver.blockList).toEqual(defaults.resolver.blockList);
  });
});
