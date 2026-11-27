import React, { useEffect } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar as RNStatusBar } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Play } from 'lucide-react-native';
import PressableScale from './PressableScale';
import { colors, radius, space } from '@/theme';

/**
 * A title page: the player (or the backdrop with a Play button, until
 * playing) fixed at the top, the details scrolling under it. Fullscreen
 * turns the phone sideways and gives the player the whole screen.
 */
export default function TitleLayout({
  backdrop,
  playing,
  onPlay,
  playLabel = 'Play',
  player,
  fullscreen,
  setFullscreen,
  children,
}: {
  backdrop: string | null;
  playing: boolean;
  onPlay: () => void;
  playLabel?: string;
  player: React.ReactNode;
  fullscreen: boolean;
  setFullscreen: (on: boolean) => void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();

  // Sideways for fullscreen; back to upright after. Turning the phone while
  // playing also goes fullscreen.
  useEffect(() => {
    void (fullscreen
      ? ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
      : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).then(() => ScreenOrientation.unlockAsync()));
  }, [fullscreen]);

  useEffect(() => {
    if (!playing) return;
    const sub = ScreenOrientation.addOrientationChangeListener(({ orientationInfo }) => {
      const landscape =
        orientationInfo.orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
        orientationInfo.orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;
      if (landscape) setFullscreen(true);
    });
    return () => ScreenOrientation.removeOrientationChangeListener(sub);
  }, [playing, setFullscreen]);

  useEffect(
    () => () => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).then(() => ScreenOrientation.unlockAsync());
    },
    []
  );

  useEffect(() => {
    if (!fullscreen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setFullscreen(false);
      return true;
    });
    return () => sub.remove();
  }, [fullscreen, setFullscreen]);

  return (
    <View style={{ flex: 1, backgroundColor: fullscreen ? '#000' : colors.background }}>
      <StatusBar hidden={fullscreen} style="light" />
      {/* After fullscreen (status bar hidden) the inset can read 0 for a moment: Android's own height is the floor. */}
      <View style={{ height: fullscreen ? 0 : Math.max(insets.top, RNStatusBar.currentHeight ?? 0), backgroundColor: '#000' }} />
      {playing ? (
        player
      ) : (
        <View style={styles.poster}>
          {backdrop && <Image source={backdrop} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} />}
          <LinearGradient colors={['rgba(0,0,0,0.35)', 'transparent', 'rgba(10,10,10,0.9)']} style={StyleSheet.absoluteFill} />
          <PressableScale onPress={onPlay} style={styles.play} accessibilityLabel={playLabel}>
            <Play size={30} color="#000" fill="#000" style={{ marginLeft: 4 }} />
          </PressableScale>
          <Text style={styles.playLabel}>{playLabel}</Text>
          <Pressable style={styles.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={10} accessibilityLabel="Back">
            <ChevronLeft color="#fff" size={24} />
          </Pressable>
        </View>
      )}
      {!fullscreen && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}>
          {children}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  poster: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  play: { width: 68, height: 68, borderRadius: 34, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  playLabel: { color: '#fff', fontWeight: '700', marginTop: space.sm, fontSize: 13, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 6 },
  back: { position: 'absolute', top: space.sm, left: space.sm, width: 40, height: 40, borderRadius: radius.full, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
});
