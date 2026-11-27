import React, { useEffect } from 'react';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SystemUI from 'expo-system-ui';
import { AuthProvider } from '@/lib/auth';
import { WatchlistProvider } from '@/lib/watchlist';
import EpisodeResolver from '@/downloads/EpisodeResolver';
import { DialogHost } from '@/components/Dialog';
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
              <Stack.Screen name="download-settings" options={{ title: 'Download settings' }} />
            </Stack>
            <EpisodeResolver />
            <DialogHost />
          </ThemeProvider>
          </WatchlistProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * A screen that breaks shows what went wrong instead of closing the app
 * (a release build otherwise quits on any uncaught error). Try again
 * re-renders it.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: 24, paddingTop: 80, gap: 12 }}>
      <Text style={{ color: colors.foreground, fontSize: 22, fontWeight: '800' }}>Something went wrong</Text>
      <Text style={{ color: colors.muted, fontSize: 14 }}>This screen hit an error. Try again, or send a screenshot of this to whoever looks after Lwedflix.</Text>
      <ScrollView style={{ maxHeight: 220, backgroundColor: colors.card, borderRadius: 12, padding: 12 }}>
        <Text selectable style={{ color: colors.white70, fontSize: 12, fontFamily: 'monospace' }}>{String(error?.message ?? error)}</Text>
      </ScrollView>
      <Pressable onPress={retry} style={{ alignSelf: 'flex-start', backgroundColor: colors.accent, paddingHorizontal: 20, height: 44, borderRadius: 999, justifyContent: 'center' }}>
        <Text style={{ color: '#000', fontWeight: '800' }}>Try again</Text>
      </Pressable>
    </View>
  );
}
