import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { formatTimestamp } from '@shared/lib/watchRoom';
import { colors, radius } from '@/theme';

/** The seek bar: drag or tap anywhere on it; seeks when released. */
export default function SeekBar({
  time,
  duration,
  buffered,
  onSeek,
  onScrub,
}: {
  time: number;
  duration: number;
  buffered: number;
  onSeek: (time: number) => void;
  onScrub?: (time: number | null) => void;
}) {
  const layout = useRef({ x: 0, width: 1 });
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  const [scrub, setScrub] = useState<number | null>(null);

  const fractionAt = (pageX: number) => Math.min(1, Math.max(0, (pageX - layout.current.x) / layout.current.width));
  const measure = () => ref.current?.measureInWindow((x: number, _y: number, width: number) => (layout.current = { x, width: Math.max(width, 1) }));
  const onLayout = (_e: LayoutChangeEvent) => measure();

  const shown = scrub ?? (duration > 0 ? time / duration : 0);
  const bufferedFraction = duration > 0 ? Math.min(1, buffered / duration) : 0;

  return (
    <View
      ref={ref}
      onLayout={onLayout}
      style={styles.hit}
      onStartShouldSetResponder={() => duration > 0}
      onMoveShouldSetResponder={() => duration > 0}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        measure();
        const f = fractionAt(e.nativeEvent.pageX);
        setScrub(f);
        onScrub?.(f * duration);
      }}
      onResponderMove={(e) => {
        const f = fractionAt(e.nativeEvent.pageX);
        setScrub(f);
        onScrub?.(f * duration);
      }}
      onResponderRelease={(e) => {
        const f = fractionAt(e.nativeEvent.pageX);
        setScrub(null);
        onScrub?.(null);
        onSeek(f * duration);
      }}
      onResponderTerminate={() => {
        setScrub(null);
        onScrub?.(null);
      }}
    >
      {/* While dragging: the time, large, above the finger. */}
      {scrub !== null && (
        <View pointerEvents="none" style={[styles.bubbleWrap, { left: `${shown * 100}%` }]}>
          <View style={styles.bubble}>
            <Text style={styles.bubbleText}>
              {formatTimestamp(shown * duration)}
              <Text style={styles.bubbleTotal}> / {formatTimestamp(duration)}</Text>
            </Text>
          </View>
        </View>
      )}
      <View style={[styles.track, scrub !== null && styles.trackActive]}>
        <View style={[styles.buffered, { width: `${bufferedFraction * 100}%` }]} />
        <View style={[styles.fill, { width: `${shown * 100}%` }]} />
      </View>
      <View style={[styles.thumb, { left: `${shown * 100}%` }, scrub !== null && styles.thumbActive]} />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: 28, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.white20, overflow: 'hidden' },
  trackActive: { height: 8, borderRadius: 4 },
  bubbleWrap: { position: 'absolute', bottom: 30, width: 0, alignItems: 'center', overflow: 'visible' },
  bubble: { position: 'absolute', bottom: 0, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.8)', borderWidth: 1, borderColor: colors.white20, width: 150, alignItems: 'center' },
  bubbleText: { color: '#fff', fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  bubbleTotal: { color: colors.white70, fontSize: 13, fontWeight: '600' },
  buffered: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: 'rgba(255,255,255,0.35)' },
  fill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.accent },
  thumb: { position: 'absolute', width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: colors.accent },
  thumbActive: { width: 20, height: 20, borderRadius: 10, marginLeft: -10 },
});
