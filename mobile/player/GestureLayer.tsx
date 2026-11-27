import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, useCompetingGestures, useExclusiveGestures, usePanGesture, usePinchGesture, useTapGesture } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { ChevronsLeft, ChevronsRight, Sun, Volume1, Volume2, VolumeX } from 'lucide-react-native';
import { getBrightness, getVolume, setBrightness, setVolume } from './device';
import { isVertical, levelAfterSwipe, nextSkip, swipeZone, tapZone, type SkipStreak } from './gestures';
import { colors, radius } from '@/theme';

// The player's gestures, over the server's page (which never sees them):
// a tap shows or hides the controls; a double-tap on the left or right skips
// 10 s, and more taps in a row keep adding; in fullscreen, swiping up and
// down on the left changes this screen's brightness and on the right the
// phone's media volume; swiping up on the small player goes fullscreen and
// down in fullscreen leaves it; pinching fills or fits the screen.

const STREAK_MS = 700;
const FULLSCREEN_SWIPE = 80;

export default function GestureLayer({
  fullscreen,
  gestures,
  locked,
  onTap,
  onSkip,
  onFullscreen,
  onZoom,
}: {
  fullscreen: boolean;
  /** Double-tap and swipes (the "Gestures" switch); a tap always works. */
  gestures: boolean;
  /** The screen lock: only a tap (which shows the unlock button) gets through. */
  locked: boolean;
  onTap: () => void;
  /** Skip by this many seconds; false if not allowed (a locked watch party). */
  onSkip: (seconds: number) => boolean;
  onFullscreen: (on: boolean) => void;
  onZoom: (fill: boolean) => void;
}) {
  const size = useRef({ width: 1, height: 1 });
  const streak = useRef<SkipStreak | null>(null);
  const [bubble, setBubble] = useState<SkipStreak | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleOpacity = useRef(new Animated.Value(0)).current;

  const swipe = useRef<{ mode: 'brightness' | 'volume' | 'screen'; start: number; last: number } | null>(null);
  const [level, setLevel] = useState<{ kind: 'brightness' | 'volume'; value: number } | null>(null);
  const levelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
      if (levelTimer.current) clearTimeout(levelTimer.current);
    },
    []
  );

  const tick = () => void Haptics.selectionAsync().catch(() => {});

  const skip = (side: 'left' | 'right') => {
    const next = nextSkip(streak.current, side, Date.now());
    if (!onSkip(side === 'left' ? -10 : 10)) {
      streak.current = null;
      return;
    }
    streak.current = next;
    tick();
    setBubble(next);
    bubbleOpacity.setValue(1);
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => {
      // Only a fade that ran to the end clears the bubble: a new skip stops it midway.
      Animated.timing(bubbleOpacity, { toValue: 0, duration: 250, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(({ finished }) => finished && setBubble(null));
    }, 600);
  };

  const singleTap = useTapGesture({
    runOnJS: true,
    maxDuration: 500,
    onActivate: (e) => {
      // Mid-streak, single taps on the same side keep adding, as on YouTube.
      const side = tapZone(e.x, size.current.width);
      const s = streak.current;
      if (gestures && !locked && s && side === s.side && Date.now() - s.at <= STREAK_MS) return skip(side);
      onTap();
    },
  });

  const doubleTap = useTapGesture({
    runOnJS: true,
    numberOfTaps: 2,
    maxDelay: 250,
    enabled: gestures && !locked,
    onActivate: (e) => {
      const side = tapZone(e.x, size.current.width);
      if (side === 'center') onTap();
      else skip(side);
    },
  });

  const pan = usePanGesture({
    runOnJS: true,
    enabled: !locked,
    activeOffsetY: [-14, 14],
    failOffsetX: [-24, 24],
    onActivate: (e) => {
      if (!isVertical(e.translationX, e.translationY)) {
        swipe.current = null;
        return;
      }
      const zone = fullscreen && gestures ? swipeZone(e.x, size.current.width) : null;
      if (zone === 'brightness') swipe.current = { mode: 'brightness', start: getBrightness(), last: -1 };
      else if (zone === 'volume') swipe.current = { mode: 'volume', start: getVolume(), last: -1 };
      else swipe.current = { mode: 'screen', start: 0, last: 0 };
    },
    onUpdate: (e) => {
      const s = swipe.current;
      if (!s || s.mode === 'screen') return;
      let value = levelAfterSwipe(s.start, e.translationY, size.current.height);
      if (s.mode === 'brightness') setBrightness(value);
      else value = setVolume(value);
      // A tick when a swipe reaches either end.
      if ((value === 0 || value === 1) && s.last !== value) tick();
      s.last = value;
      if (levelTimer.current) clearTimeout(levelTimer.current);
      setLevel({ kind: s.mode, value });
    },
    onDeactivate: (e) => {
      const s = swipe.current;
      swipe.current = null;
      if (!s) return;
      if (s.mode === 'screen') {
        if (!fullscreen && e.translationY < -FULLSCREEN_SWIPE) onFullscreen(true);
        else if (fullscreen && e.translationY > FULLSCREEN_SWIPE) onFullscreen(false);
        return;
      }
      if (levelTimer.current) clearTimeout(levelTimer.current);
      levelTimer.current = setTimeout(() => setLevel(null), 700);
    },
  });

  const pinch = usePinchGesture({
    runOnJS: true,
    enabled: fullscreen && !locked,
    onDeactivate: (e) => {
      if (e.scale > 1.1) onZoom(true);
      else if (e.scale < 0.9) onZoom(false);
    },
  });

  const taps = useExclusiveGestures(doubleTap, singleTap);
  const gesture = useCompetingGestures(pinch, pan, taps);

  const LevelIcon = level?.kind === 'brightness' ? Sun : (level?.value ?? 0) === 0 ? VolumeX : (level?.value ?? 0) < 0.5 ? Volume1 : Volume2;

  return (
    <>
      <GestureDetector gesture={gesture}>
        <View
          style={StyleSheet.absoluteFill}
          collapsable={false}
          onLayout={(e) => (size.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        />
      </GestureDetector>

      {bubble && (
        <Animated.View pointerEvents="none" style={[styles.ripple, bubble.side === 'left' ? styles.rippleLeft : styles.rippleRight, { opacity: bubbleOpacity }]}>
          {bubble.side === 'left' ? <ChevronsLeft color="#fff" size={30} /> : <ChevronsRight color="#fff" size={30} />}
          <Text style={styles.bubbleText}>{bubble.total > 0 ? `+${bubble.total}` : bubble.total} s</Text>
        </Animated.View>
      )}

      {level && (
        <View pointerEvents="none" style={[styles.level, level.kind === 'brightness' ? { left: 28 } : { right: 28 }]}>
          <LevelIcon color="#fff" size={18} />
          <View style={styles.levelTrack}>
            <View style={[styles.levelFill, { height: `${Math.round(level.value * 100)}%` }]} />
          </View>
          <Text style={styles.levelText}>{Math.round(level.value * 100)}</Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  ripple: { position: 'absolute', top: 0, bottom: 0, width: '36%', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.12)' },
  rippleLeft: { left: 0, borderTopRightRadius: 400, borderBottomRightRadius: 400 },
  rippleRight: { right: 0, borderTopLeftRadius: 400, borderBottomLeftRadius: 400 },
  bubbleText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  level: {
    position: 'absolute',
    top: '20%',
    bottom: '20%',
    width: 44,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  levelTrack: { flex: 1, width: 6, borderRadius: 3, backgroundColor: colors.white20, justifyContent: 'flex-end', overflow: 'hidden' },
  levelFill: { width: '100%', backgroundColor: colors.accent },
  levelText: { color: '#fff', fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
