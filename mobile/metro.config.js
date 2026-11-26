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
  const resolve = upstream ?? context.resolveRequest;
  // Packages imported by the shared code (../src, ../electron) come from the
  // app's node_modules, never the desktop app's: one React, one Supabase.
  const bare = !moduleName.startsWith('.') && !path.isAbsolute(moduleName);
  if (bare && !context.originModulePath.startsWith(projectRoot + path.sep)) {
    return resolve({ ...context, originModulePath: path.join(projectRoot, 'index.js') }, moduleName, platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
