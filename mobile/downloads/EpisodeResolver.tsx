import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import type { WebViewRef } from '@/player/bridge';
import { PROVIDERS, embedUrl } from '@shared/lib/providers';
import { classify, Registry } from '@electron/streams';
import { js, makeToken, shimFor, wrapperFor, WRAPPER_BASE_URL } from '@/player/bridge';
import { isAllowedPlayerNavigation } from '@/player/navigation';
import type { CapturedStream } from '@/player/types';
import { setEpisodeResolver } from './engine';

// Finds the stream of an episode nobody is watching, for a season download
// (electron/resolver.js on desktop): an off-screen player loads the
// episode's server with autoplay on, keeps the first real stream it loads
// once the master playlist has had a moment to arrive, and moves on. One at
// a time, and only when the episode's turn comes, since stream URLs expire.

const SERVERS = PROVIDERS.filter((p) => p.name !== 'vidlink'); // DASH only
const WAIT_MS = 45000;
const SETTLE_MS = 2500;

interface Job {
  target: { mediaId: number; season: number; episode: number };
  resolve: (stream: CapturedStream) => void;
  reject: (err: Error) => void;
}

export default function EpisodeResolver() {
  const queue = useRef<Job[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [server, setServer] = useState(0);
  const token = useMemo(makeToken, []);
  const registry = useRef(new Registry());
  const firstSeen = useRef(0);
  const web = useRef<WebViewRef>(null);

  useEffect(() => {
    setEpisodeResolver(
      (target) =>
        new Promise<CapturedStream>((resolve, reject) => {
          queue.current.push({ target, resolve, reject });
          setJob((current) => current ?? queue.current.shift() ?? null);
        })
    );
    return () => setEpisodeResolver(null);
  }, []);

  const finish = (result: CapturedStream | Error) => {
    if (!job) return;
    if (result instanceof Error) job.reject(result);
    else job.resolve(result);
    registry.current = new Registry();
    firstSeen.current = 0;
    setServer(0);
    setJob(queue.current.shift() ?? null);
  };

  // Each server gets WAIT_MS; after the first stream appears, SETTLE_MS more.
  useEffect(() => {
    if (!job) return;
    registry.current = new Registry();
    firstSeen.current = 0;
    const started = Date.now();
    const timer = setInterval(() => {
      const found = registry.current.list().filter((s) => s.supported);
      if (found.length && !firstSeen.current) firstSeen.current = Date.now();
      if (found.length && Date.now() - firstSeen.current >= SETTLE_MS) {
        clearInterval(timer);
        const best = registry.current.get(found.find((s) => s.best)?.id ?? found[0].id)!;
        finish({ url: best.url, type: best.kind === 'hls' ? 'application/vnd.apple.mpegurl' : '', size: best.size ?? 0, frame: best.frameUrl ?? '', at: Date.now() });
        return;
      }
      if (Date.now() - started > WAIT_MS) {
        clearInterval(timer);
        if (server + 1 < SERVERS.length) setServer((s) => s + 1);
        else finish(new Error('No server had this episode.'));
      }
    }, 500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, server]);

  if (!job) return null;
  const url = embedUrl(SERVERS[server], 'tv', job.target.mediaId, job.target.season, job.target.episode);

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { c: string; p: CapturedStream & { muted?: boolean } };
      // It plays off screen: keep it quiet.
      if (message.c === 'state' && message.p && !message.p.muted) web.current?.injectJavaScript(js.command({ action: 'setMuted', muted: true }));
      if (message.c !== 'stream') return;
      const kind = classify(message.p.url, message.p.type, message.p.size || undefined);
      if (kind) registry.current.add({ frameUrl: message.p.frame, url: message.p.url, kind, size: message.p.size || undefined });
    } catch {
      // Not ours.
    }
  };

  return (
    <View style={styles.offscreen} pointerEvents="none">
      <WebView
        ref={web as never}
        key={`${job.target.mediaId}-${job.target.season}-${job.target.episode}-${server}`}
        source={{ html: wrapperFor(token, url, true), baseUrl: WRAPPER_BASE_URL }}
        originWhitelist={['*']}
        injectedJavaScriptBeforeContentLoaded={shimFor(token, Platform.OS)}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
        injectedJavaScriptForMainFrameOnly={false}
        onMessage={onMessage}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        mixedContentMode="always"
        onShouldStartLoadWithRequest={(req: ShouldStartLoadRequest) => isAllowedPlayerNavigation(req.url, req.isTopFrame ?? true)}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Laid out (so the page plays) but off the screen.
  offscreen: { position: 'absolute', left: -2000, top: 0, width: 640, height: 360, opacity: 0 },
});
