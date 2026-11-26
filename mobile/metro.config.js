// Lets the app import the desktop app's libraries (../src) as `@shared/...`,
// resolved with the app's own node_modules. React Native prefers `.native.ts`
// files, so src/lib/supabase.native.ts and tmdbConfig.native.ts stand in for
// the web versions.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [path.join(repoRoot, 'src'), path.join(repoRoot, 'public')];
config.resolver.nodeModulesPaths = [path.join(projectRoot, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = { '@shared': path.join(repoRoot, 'src') };

// The desktop's download modules (electron/hls.js, mp4.js, streams.js) are
// reused as `@electron/...`; their Node built-ins resolve to small shims.
config.watchFolders.push(path.join(repoRoot, 'electron'));
const NODE_SHIMS = { 'node:crypto': path.join(projectRoot, 'shims/crypto.js') };

// The Movie Map's data ships as an asset (scripts/build-bridge.mjs copies
// public/movie-map/map.json in), read at runtime rather than bundled as JS.
config.resolver.assetExts.push('mapdata');

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('node:')) {
    return { type: 'sourceFile', filePath: NODE_SHIMS[moduleName] ?? path.join(projectRoot, 'shims/empty.js') };
  }
  if (moduleName.startsWith('@electron/')) {
    moduleName = path.join(repoRoot, 'electron', moduleName.slice('@electron/'.length));
  }
  if (moduleName.startsWith('@shared/')) {
    moduleName = path.join(repoRoot, 'src', moduleName.slice('@shared/'.length));
  }
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
