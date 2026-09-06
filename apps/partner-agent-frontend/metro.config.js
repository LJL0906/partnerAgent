const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);

// The frontend consumes the contracts workspace, not the backend workspace.
// Watching backend build output creates a large, irrelevant HMR burst on Windows.
const backendRoot = path.resolve(__dirname, '../partner-agent-backend');
config.watchFolders = config.watchFolders.filter((folder) => path.resolve(folder) !== backendRoot);

// Bound transform concurrency as a second guard against Windows file-handle
// exhaustion while keeping the monorepo server root and package resolution.
config.maxWorkers = 2;

module.exports = config;
