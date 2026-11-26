// The phone app's config. Reads the desktop app's .env.local (or the
// environment, in CI) so both talk to the same Supabase project and TMDB.
import type { ExpoConfig } from 'expo/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(join(__dirname, '..', name), 'utf8').split(/\r?\n/)) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (match && !(match[1] in env)) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    } catch {
      // Not there: fine in CI, where the environment has them.
    }
  }
  return { ...env, ...(process.env as Record<string, string>) };
}

const env = loadEnv();
const version = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')).version as string;

const config: ExpoConfig = {
  name: 'Lwedflix',
  slug: 'lwedflix',
  version,
  orientation: 'default',
  icon: './assets/icon.png',
  scheme: 'lwedflix',
  userInterfaceStyle: 'dark',
  backgroundColor: '#0a0a0a',
  ios: {
    bundleIdentifier: 'app.lwedflix.mobile',
    supportsTablet: true,
    infoPlist: {
      UIBackgroundModes: ['audio'],
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
    },
  },
  android: {
    package: 'app.lwedflix.mobile',
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0a0a0a' },
    permissions: ['android.permission.WAKE_LOCK'],
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-image',
    'expo-sqlite',
    'expo-video',
    './plugins/withReleaseSigning',
    ['expo-splash-screen', { backgroundColor: '#0a0a0a', image: './assets/splash-icon.png', imageWidth: 160 }],
  ],
  experiments: { typedRoutes: false },
  extra: {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    tmdbBaseUrl: env.NEXT_PUBLIC_TMDB_BASE_URL || 'https://api.themoviedb.org/3',
    tmdbAccessToken: env.TMDB_ACCESS_TOKEN,
    releasesRepo: 'maysalim-sudo/lwedflix',
  },
};

export default config;
