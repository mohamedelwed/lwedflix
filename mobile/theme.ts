// The desktop app's design tokens (src/app/globals.css), for React Native.
export const colors = {
  background: '#0a0a0a',
  foreground: '#ffffff',
  accent: '#ff9900',
  accentDeep: '#ff6200',
  accentLight: '#ffc24d',
  muted: '#a1a1aa',
  card: '#141414',
  border: '#262626',
  glass: 'rgba(20, 20, 20, 0.7)',
  hairline: 'rgba(255, 255, 255, 0.1)',
  white5: 'rgba(255, 255, 255, 0.05)',
  white10: 'rgba(255, 255, 255, 0.1)',
  white20: 'rgba(255, 255, 255, 0.2)',
  white60: 'rgba(255, 255, 255, 0.6)',
  white70: 'rgba(255, 255, 255, 0.7)',
  white90: 'rgba(255, 255, 255, 0.9)',
  star: '#eab308',
  danger: '#ef4444',
  success: '#22c55e',
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, full: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const type = {
  hero: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -0.8, lineHeight: 38 },
  h1: { fontSize: 26, fontWeight: '800' as const, letterSpacing: -0.5 },
  h2: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.3 },
  body: { fontSize: 15, lineHeight: 22 },
  small: { fontSize: 13 },
  label: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 1.2, textTransform: 'uppercase' as const },
} as const;
