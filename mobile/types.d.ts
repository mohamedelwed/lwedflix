// Ambient types for the app.
declare module 'react-native-url-polyfill/auto';

// src/lib/tmdb.ts passes Next.js's fetch cache option; React Native ignores it.
interface RequestInit {
  next?: { revalidate?: number | false; tags?: string[] };
}
