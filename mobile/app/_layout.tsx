import '@/lib/polyfills';
import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SystemUI from 'expo-system-ui';
import { AuthProvider } from '@/lib/auth';
import { WatchlistProvider } from '@/lib/watchlist';
import EpisodeResolver from '@/downloads/EpisodeResolver';
import { startMovieProgressSync } from '@shared/lib/movieProgressSync';
import { flushWatchHistory } from '@shared/lib/watchHistory';
import { resumeDownloads } from '@/downloads/engine';
import { colors } from '@/theme';

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.background, card: colors.background, primary: colors.accent, border: colors.border, text: colors.foreground },
};

export default function RootLayout() {
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background);
    startMovieProgressSync();
    void flushWatchHistory();
    void resumeDownloads();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <AuthProvider>
          <WatchlistProvider>
          <ThemeProvider value={theme}>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.background },
                headerTintColor: colors.foreground,
                headerTitleStyle: { fontWeight: '700' },
                headerShadowVisible: false,
                contentStyle: { backgroundColor: colors.background },
                headerBackButtonDisplayMode: 'minimal',
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="movie/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="tv/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="watch/[code]" options={{ headerShown: false }} />
              <Stack.Screen name="offline/[id]" options={{ headerShown: false, orientation: 'all' }} />
              <Stack.Screen name="login" options={{ title: 'Sign in', presentation: 'modal' }} />
              <Stack.Screen name="signup" options={{ title: 'Create account', presentation: 'modal' }} />
            </Stack>
            <EpisodeResolver />
          </ThemeProvider>
          </WatchlistProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
