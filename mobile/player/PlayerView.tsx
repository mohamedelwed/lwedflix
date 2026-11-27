import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import type { WebViewRef } from '@/player/bridge';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { Captions, ChevronLeft, Gauge, Lock, LockOpen, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, Server, SkipForward, SlidersHorizontal } from 'lucide-react-native';
import { PROVIDERS, embedUrl } from '@shared/lib/providers';
import { formatTimestamp } from '@shared/lib/watchRoom';
import { js, makeToken, shimFor, wrapperFor, WRAPPER_BASE_URL } from './bridge';
import SeekBar from './SeekBar';
import PlayerPanel, { type PanelTab } from './PlayerPanel';
import GestureLayer from './GestureLayer';
import { fillScale } from './gestures';
import { resetBrightness } from './device';
import { setPlayerSettings, usePlayerSettings } from './playerSettings';
import type { CapturedStream, PlayableMedia, PlayerCommand, PlayerHandle, PlayerState } from './types';
import { isAllowedPlayerNavigation } from './navigation';
import { clearStreams, recordStream, setWatching } from '@/downloads/engine';
import { colors, radius, space } from '@/theme';

// After the viewer taps into the player, how long a server gets to start a
// stream before the next one is tried (START_TIMEOUT_MS on desktop).
const START_TIMEOUT_MS = 20000;
const CONTROLS_HIDE_MS = 3000;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export interface PlayerViewProps {
  media: PlayableMedia;
  /** Seconds to start from, applied once when the stream first reports its length. */
  resumeAt?: number;
  /** Start the stream without a tap (Up next, or the viewer pressed Play already). */
  autoplay?: boolean;
  fullscreen: boolean;
  onFullscreenChange: (fullscreen: boolean) => void;
  /** Every report from the player bridge (null: the stream went away). */
  onState?: (state: PlayerState | null) => void;
  onEnded?: () => void;
  /** Shown as a button when there's a next episode. */
  onNext?: () => void;
  onBack?: () => void;
  /** A media URL the server loaded (for downloads). */
  onStream?: (stream: CapturedStream) => void;
  /** Party: playback locked to the host. */
  locked?: boolean;
  /** Drawn over the video, under the controls (party reactions, Up next). */
  overlay?: React.ReactNode;
}

/**
 * The player: a server's embed page in a WebView, with the desktop app's
 * player bridge (electron/preload.js) running in its frames, and
 * Lwedflix's own controls drawn over the picture once the stream plays.
 */
const PlayerView = forwardRef<PlayerHandle, PlayerViewProps>(function PlayerView(props, ref) {
  const { media, resumeAt, autoplay, fullscreen, onFullscreenChange, onState, onEnded, onNext, onBack, onStream, locked, overlay } = props;
  const web = useRef<WebViewRef>(null);
  const token = useMemo(makeToken, []);
  const [providerIndex, setProviderIndex] = useState(0);
  const tried = useRef(new Set<number>([0]));
  const [state, setState] = useState<PlayerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverControls, setServerControls] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [sheet, setSheet] = useState<PanelTab | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>('server');
  const openPanel = (tab: PanelTab) => {
    setPanelTab(tab);
    setSheet(tab);
  };
  const [notice, setNotice] = useState<string | null>(null);
  const { gestures } = usePlayerSettings();
  // The screen lock (against stray touches) and the picture filling the screen.
  const [screenLocked, setScreenLocked] = useState(false);
  const [fill, setFill] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const streams = useRef<CapturedStream[]>([]);
  const resumed = useRef(false);
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = useRef({ onState, onEnded, onStream });
  callbacks.current = { onState, onEnded, onStream };

  const provider = PROVIDERS[providerIndex];
  const url = embedUrl(provider, media.type, media.id, media.season ?? 1, media.episode ?? 1, media.imdbId);
  const playing = state?.playing ?? false;
  // The page is built once; later titles, episodes and servers load into it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => wrapperFor(token, url, !!autoplay), [token]);
  const ready = state !== null;

  // The screen stays on while the stream plays, not while it's paused; and
  // downloads give way to it, as the download settings say.
  useEffect(() => {
    if (!playing) return;
    void activateKeepAwakeAsync('player');
    setWatching(true);
    return () => {
      void deactivateKeepAwake('player');
      setWatching(false);
    };
  }, [playing]);

  const send = useCallback((command: PlayerCommand) => {
    web.current?.injectJavaScript(js.command(command));
  }, []);

  useImperativeHandle(ref, () => ({ command: send, streams: () => streams.current }), [send]);

  // A new title, episode or server: load it in the same page.
  const first = useRef(true);
  useEffect(() => {
    resumed.current = false;
    streams.current = [];
    clearStreams();
    setState(null);
    setLoading(true);
    if (first.current) {
      first.current = false;
      return;
    }
    web.current?.injectJavaScript(js.load(url, true));
  }, [url]);

  // A new title or episode starts again from the first server.
  useEffect(() => {
    tried.current = new Set([0]);
    setProviderIndex(0);
  }, [media.type, media.id, media.season, media.episode]);

  const clearStartTimer = () => {
    if (startTimer.current) clearTimeout(startTimer.current);
    startTimer.current = null;
  };

  const nextServer = useCallback((reason: string) => {
    clearStartTimer();
    const next = PROVIDERS.findIndex((_, i) => !tried.current.has(i));
    if (next === -1) {
      setNotice('No server could play this. Pick one to try again.');
      return;
    }
    tried.current.add(next);
    setNotice(`${reason} Trying ${PROVIDERS[next].name}…`);
    setProviderIndex(next);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => clearStartTimer, []);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: { c: string; p: unknown };
      try {
        message = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      switch (message.c) {
        case 'state': {
          const next = message.p as PlayerState | null;
          setState(next);
          callbacks.current.onState?.(next);
          if (!next) return;
          setLoading(false);
          clearStartTimer();
          if (!resumed.current && next.duration > 0) {
            resumed.current = true;
            if (!serverControlsRef.current) send({ action: 'clean', on: true });
            if (resumeAt && resumeAt > 0 && resumeAt < next.duration - 30 && next.time < 5) send({ action: 'seek', time: resumeAt });
          }
          if (next.event === 'ended') callbacks.current.onEnded?.();
          break;
        }
        case 'problem':
          nextServer(`${PROVIDERS[providerIndexRef.current].name} can't play this.`);
          break;
        case 'stream': {
          const s = { ...(message.p as Omit<CapturedStream, 'at'>), at: Date.now() };
          streams.current = [s, ...streams.current.filter((x) => x.url !== s.url)].slice(0, 30);
          recordStream(s);
          callbacks.current.onStream?.(s);
          break;
        }
        case 'load':
          setLoading(false);
          break;
      }
    },
    [nextServer, resumeAt, send]
  );

  useEffect(() => {
    if (!fullscreen) {
      resetBrightness();
      setFill(false);
      setScreenLocked(false);
    }
  }, [fullscreen]);
  useEffect(() => () => resetBrightness(), []);

  const providerIndexRef = useRef(providerIndex);
  providerIndexRef.current = providerIndex;
  const serverControlsRef = useRef(serverControls);
  serverControlsRef.current = serverControls;

  // Before the stream plays, taps go to the server's page (its play button).
  // The first tap starts the clock on that server.
  const onTouchBeforeReady = () => {
    if (ready || startTimer.current) return;
    startTimer.current = setTimeout(() => {
      startTimer.current = null;
      nextServer(`${PROVIDERS[providerIndexRef.current].name} didn't start.`);
    }, START_TIMEOUT_MS);
  };

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
  }, []);

  useEffect(() => {
    if (!playing) {
      setControlsVisible(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    } else {
      showControls();
    }
  }, [playing, showControls]);

  const toggleServerControls = () => {
    const next = !serverControls;
    setServerControls(next);
    send({ action: 'clean', on: !next });
  };

  const ownControls = ready && !serverControls;
  const time = scrubTime ?? state?.time ?? 0;
  const duration = state?.duration ?? 0;

  const pickServer = (i: number) => {
    tried.current.add(i);
    setProviderIndex(i);
    if (i === providerIndex) web.current?.injectJavaScript(js.load(url, true));
  };

  return (
    <View style={[styles.root, fullscreen && styles.fullscreen]} onLayout={(e) => setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      <View
        style={[StyleSheet.absoluteFill, fullscreen && fill && { transform: [{ scale: fillScale(box.width, box.height) }] }]}
        onTouchStart={onTouchBeforeReady}
      >
        <WebView
          ref={web as never}
          source={{ html, baseUrl: WRAPPER_BASE_URL }}
          originWhitelist={['*']}
          injectedJavaScriptBeforeContentLoaded={shimFor(token, Platform.OS)}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
          injectedJavaScriptForMainFrameOnly={false}
          onMessage={onMessage}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          allowsFullscreenVideo={false}
          mediaPlaybackRequiresUserAction={false}
          allowsAirPlayForMediaPlayback
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false}
          mixedContentMode="always"
          thirdPartyCookiesEnabled
          onShouldStartLoadWithRequest={(req: ShouldStartLoadRequest) => isAllowedPlayerNavigation(req.url, req.isTopFrame ?? true, req.navigationType)}
          onFileDownload={() => {}}
          style={styles.web}
          containerStyle={styles.web}
          bounces={false}
          scrollEnabled={false}
          overScrollMode="never"
          webviewDebuggingEnabled={__DEV__}
        />
      </View>

      {overlay}

      {/* Over a playing stream with our controls, taps never reach the server's page (its ads). */}
      {ownControls && (
        <GestureLayer
          fullscreen={fullscreen}
          gestures={gestures}
          locked={screenLocked}
          onTap={() => (controlsVisible && playing ? setControlsVisible(false) : showControls())}
          onSkip={(seconds) => {
            if (locked) {
              setNotice('The host has locked playback');
              return false;
            }
            send({ action: 'seekBy', delta: seconds });
            return true;
          }}
          onFullscreen={onFullscreenChange}
          onZoom={setFill}
        />
      )}

      {/* With the controls hidden, a thin line still shows how far along it is. */}
      {ownControls && !controlsVisible && duration > 0 && (
        <View pointerEvents="none" style={styles.thinTrack}>
          <View style={[styles.thinFill, { width: `${Math.min(100, ((state?.time ?? 0) / duration) * 100)}%` }]} />
        </View>
      )}

      {/* Locked: only the unlock button answers, when a tap brings it up. */}
      {ownControls && screenLocked && controlsVisible && (
        <View style={styles.unlockWrap} pointerEvents="box-none">
          <Pressable
            onPress={() => {
              setScreenLocked(false);
              void Haptics.selectionAsync().catch(() => {});
              showControls();
            }}
            style={styles.unlock}
            accessibilityLabel="Unlock the screen"
          >
            <LockOpen color="#000" size={16} />
            <Text style={styles.unlockText}>Tap to unlock</Text>
          </Pressable>
        </View>
      )}

      {loading && !ready && (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      )}

      {(!ready || serverControls) && (
        <View style={styles.preTop} pointerEvents="box-none">
          {onBack && (
            <IconButton onPress={onBack} label="Back">
              <ChevronLeft color="#fff" size={22} />
            </IconButton>
          )}
          <View style={{ flex: 1 }} />
          {serverControls && (
            <IconButton onPress={() => openPanel('more')} label="Player settings">
              <SlidersHorizontal color="#fff" size={18} />
            </IconButton>
          )}
          <Pressable onPress={() => openPanel('server')} style={styles.serverPill}>
            <Server color="#fff" size={14} />
            <Text style={styles.serverText}>{provider.name}</Text>
          </Pressable>
          <IconButton onPress={() => onFullscreenChange(!fullscreen)} label="Fullscreen">
            {fullscreen ? <Minimize color="#fff" size={18} /> : <Maximize color="#fff" size={18} />}
          </IconButton>
        </View>
      )}

      {ownControls && controlsVisible && !screenLocked && (
        <View style={[StyleSheet.absoluteFill, styles.controls]} pointerEvents="box-none">
          <View style={styles.topRow} pointerEvents="box-none">
            {onBack && (
              <IconButton onPress={onBack} label="Back">
                <ChevronLeft color="#fff" size={22} />
              </IconButton>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{media.title}</Text>
              {media.type === 'tv' && (
                <Text style={styles.subtitle} numberOfLines={1}>
                  S{media.season} · E{media.episode}
                  {media.episodeTitle ? ` · ${media.episodeTitle}` : ''}
                </Text>
              )}
            </View>
            <Pressable onPress={() => openPanel('server')} style={styles.serverPill}>
              <Server color="#fff" size={14} />
              <Text style={styles.serverText}>{provider.name}</Text>
            </Pressable>
          </View>

          <View style={styles.middleRow} pointerEvents="box-none">
            <IconButton big onPress={() => (locked ? setNotice('The host has locked playback') : send({ action: 'seekBy', delta: -10 }))} label="Back 10 seconds">
              <RotateCcw color="#fff" size={26} />
            </IconButton>
            <View>
              <IconButton huge onPress={() => (locked ? setNotice('The host has locked playback') : send({ action: 'toggle' }))} label={playing ? 'Pause' : 'Play'}>
                {playing ? <Pause color="#fff" fill="#fff" size={34} /> : <Play color="#fff" fill="#fff" size={34} />}
              </IconButton>
              {/* Loading shows under the button, not instead of it. */}
              {state?.buffering && <ActivityIndicator color="#fff" size="small" style={styles.buffering} />}
            </View>
            <IconButton big onPress={() => (locked ? setNotice('The host has locked playback') : send({ action: 'seekBy', delta: 10 }))} label="Forward 10 seconds">
              <RotateCw color="#fff" size={26} />
            </IconButton>
          </View>

          <View style={styles.bottom} pointerEvents="box-none">
            <View style={styles.timeRow} pointerEvents="none">
              <Text style={styles.time}>{formatTimestamp(time)}</Text>
              <Text style={styles.time}>{formatTimestamp(duration)}</Text>
            </View>
            <SeekBar
              time={state?.time ?? 0}
              duration={duration}
              buffered={state?.buffered ?? 0}
              onScrub={(t) => {
                setScrubTime(t);
                if (t !== null) showControls();
              }}
              onSeek={(t) => (locked ? setNotice('The host has locked playback') : send({ action: 'seek', time: t }))}
            />
            <View style={styles.buttonsRow}>
              {(state?.tracks.length ?? 0) > 0 && (
                <IconButton onPress={() => openPanel('subtitles')} label="Subtitles">
                  <Captions color={state && state.track >= 0 ? colors.accent : '#fff'} size={20} />
                </IconButton>
              )}
              <IconButton onPress={() => openPanel('speed')} label="Speed">
                <Gauge color="#fff" size={20} />
              </IconButton>
              <IconButton onPress={() => openPanel('more')} label="Player settings">
                <SlidersHorizontal color="#fff" size={20} />
              </IconButton>
              <IconButton
                onPress={() => {
                  setScreenLocked(true);
                  void Haptics.selectionAsync().catch(() => {});
                  showControls();
                }}
                label="Lock the screen"
              >
                <Lock color="#fff" size={20} />
              </IconButton>
              <View style={{ flex: 1 }} />
              {onNext && (
                <Pressable onPress={onNext} style={styles.nextButton}>
                  <SkipForward color="#fff" size={16} fill="#fff" />
                  <Text style={styles.nextText}>Next episode</Text>
                </Pressable>
              )}
              <IconButton onPress={() => onFullscreenChange(!fullscreen)} label="Fullscreen">
                {fullscreen ? <Minimize color="#fff" size={20} /> : <Maximize color="#fff" size={20} />}
              </IconButton>
            </View>
          </View>
        </View>
      )}

      {notice && (
        <View style={styles.notice} pointerEvents="none">
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      )}

      <PlayerPanel
        open={sheet !== null}
        tab={panelTab}
        fullscreen={fullscreen}
        onTab={setPanelTab}
        onClose={() => setSheet(null)}
        data={{
          servers: PROVIDERS.map((p, i) => ({ name: p.name, selected: i === providerIndex })),
          tracks: (state?.tracks ?? []).map((t, i) => ({
            label: t.label || t.language || `Track ${i + 1}`,
            language: t.label && t.language ? t.language : undefined,
            selected: state?.track === i,
          })),
          subtitlesOff: (state?.track ?? -1) === -1,
          speeds: SPEEDS,
          rate: state?.rate ?? 1,
          serverControls,
          gestures,
        }}
        actions={{
          pickServer: (i) => {
            setSheet(null);
            pickServer(i);
          },
          pickTrack: (i) => send({ action: 'setTrack', index: i }),
          pickSpeed: (rate) => send({ action: 'setRate', rate }),
          setServerControls: (on) => {
            if (on !== serverControls) toggleServerControls();
          },
          setGestures: (on) => setPlayerSettings({ gestures: on }),
        }}
      />
    </View>
  );
});

function IconButton({ children, onPress, label, big, huge }: { children: React.ReactNode; onPress: () => void; label: string; big?: boolean; huge?: boolean }) {
  const size = huge ? 72 : big ? 56 : 40;
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, { width: size, height: size, borderRadius: size / 2 }, (big || huge) && styles.iconButtonBig, pressed && { opacity: 0.6 }]}
    >
      {children}
    </Pressable>
  );
}

export default PlayerView;

const styles = StyleSheet.create({
  root: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', overflow: 'hidden' },
  fullscreen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, aspectRatio: undefined, zIndex: 100 },
  web: { flex: 1, backgroundColor: '#000' },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  preTop: { position: 'absolute', top: space.sm, left: space.sm, right: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  controls: { backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'space-between', padding: space.md },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { color: '#fff', fontSize: 15, fontWeight: '700' },
  subtitle: { color: colors.white70, fontSize: 12, marginTop: 1 },
  middleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 36 },
  bottom: { gap: 2 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: colors.white90, fontSize: 12, fontVariant: ['tabular-nums'], fontWeight: '600' },
  buttonsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconButton: { alignItems: 'center', justifyContent: 'center' },
  iconButtonBig: { backgroundColor: 'rgba(0,0,0,0.35)' },
  serverPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderColor: colors.white20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.full },
  serverText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  nextButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.white20, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full, marginRight: 4 },
  nextText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  notice: { position: 'absolute', top: 56, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.75)', borderColor: colors.white20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full, maxWidth: '90%' },
  buffering: { position: 'absolute', top: 80, alignSelf: 'center' },
  thinTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.2)' },
  thinFill: { height: 2, backgroundColor: colors.accent },
  unlockWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: space.xl },
  unlock: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.accent, paddingHorizontal: 16, height: 40, borderRadius: radius.full },
  unlockText: { color: '#000', fontWeight: '800', fontSize: 13 },
  noticeText: { color: '#fff', fontSize: 12, fontWeight: '600', textAlign: 'center' },
});
