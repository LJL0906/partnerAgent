const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);

// Metro watches projectRoot and resolves node_modules on demand. The only external
// workspace whose source changes need HMR is the shared contracts package.
config.watchFolders = [path.resolve(__dirname, '../../packages/contracts')];

// Bound transform concurrency as a second guard against Windows file-handle
// exhaustion while keeping the monorepo server root and package resolution.
config.maxWorkers = 2;

module.exports = config;
