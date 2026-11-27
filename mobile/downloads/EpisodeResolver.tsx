import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { Buffer } from 'buffer';
import type { WebViewRef } from '@/player/bridge';
import { PROVIDERS, embedUrl } from '@shared/lib/providers';
import { classify, Registry } from '@electron/streams';
import { js, makeToken, shimFor, wrapperFor, WRAPPER_BASE_URL } from '@/player/bridge';
import { isAllowedPlayerNavigation } from '@/player/navigation';
import type { CapturedStream } from '@/player/types';
import { setSessionOpener, type DownloadSession, type ResolveTarget } from './engine';

// The hidden players downloads run in (electron/resolver.js on desktop).
// Each download gets one: it loads the title's server off screen, muted,
// keeps the first real stream it loads, pauses the picture, and then stays
// open so the download can fetch every piece through it. Stream servers
// refuse anything but the browser that plays (its cookies, its
// connection), so this is the one way they reliably say yes.

const SERVERS = PROVIDERS.filter((p) => p.name !== 'vidlink'); // DASH only
const WAIT_MS = 45000;
const SETTLE_MS = 2500;
const FETCH_TIMEOUT_MS = 90000;

interface Pending {
  resolve: (bytes: Uint8Array) => void;
  reject: (err: Error & { status?: number }) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface SessionState {
  key: number;
  target: ResolveTarget;
  server: number;
  /** Set once the stream is found: the session then serves fetches. */
  found: CapturedStream | null;
  open: (session: DownloadSession) => void;
  fail: (err: Error) => void;
}

let nextKey = 1;
let nextFetch = 1;

export default function EpisodeResolver() {
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const token = useMemo(makeToken, []);

  useEffect(() => {
    setSessionOpener(
      (target) =>
        new Promise<DownloadSession>((open, fail) => {
          setSessions((list) => [...list, { key: nextKey++, target, server: 0, found: null, open, fail }]);
        })
    );
    return () => setSessionOpener(null);
  }, []);

  const update = (key: number, patch: Partial<SessionState> | null) =>
    setSessions((list) => (patch ? list.map((s) => (s.key === key ? { ...s, ...patch } : s)) : list.filter((s) => s.key !== key)));

  return (
    <>
      {sessions.map((s) => (
        <HiddenPlayer key={`${s.key}-${s.server}`} session={s} token={token} update={update} />
      ))}
    </>
  );
}

function HiddenPlayer({ session, token, update }: { session: SessionState; token: string; update: (key: number, patch: Partial<SessionState> | null) => void }) {
  const web = useRef<WebViewRef>(null);
  const registry = useRef(new Registry());
  const firstSeen = useRef(0);
  const ua = useRef<string | undefined>(undefined);
  const pending = useRef(new Map<number, Pending>());
  const closed = useRef(false);
  const { target, server, key } = session;

  // Finding the stream: each server gets WAIT_MS; after the first stream appears, SETTLE_MS more.
  useEffect(() => {
    if (session.found) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const found = registry.current.list().filter((s) => s.supported);
      if (found.length && !firstSeen.current) firstSeen.current = Date.now();
      if (found.length && Date.now() - firstSeen.current >= SETTLE_MS) {
        clearInterval(timer);
        const best = registry.current.get(found.find((s) => s.best)?.id ?? found[0].id)!;
        const stream: CapturedStream = { url: best.url, type: best.kind === 'hls' ? 'application/vnd.apple.mpegurl' : '', size: best.size ?? 0, frame: best.frameUrl ?? '', ua: ua.current, at: Date.now() };
        // The download fetches what it needs; the picture needn't keep loading.
        web.current?.injectJavaScript(js.command({ action: 'pause' }));
        update(key, { found: stream });
        session.open({
          stream,
          fetch: (url, range) =>
            new Promise<Uint8Array>((resolve, reject) => {
              if (closed.current) return reject(new Error('closed'));
              const id = nextFetch++;
              const timer = setTimeout(() => {
                pending.current.delete(id);
                reject(new Error('timed out'));
              }, FETCH_TIMEOUT_MS);
              pending.current.set(id, { resolve, reject, timer });
              web.current?.injectJavaScript(js.fetch(id, stream.frame, url, range ?? null));
            }),
          close: () => {
            closed.current = true;
            pending.current.forEach((p) => {
              clearTimeout(p.timer);
              p.reject(new Error('closed'));
            });
            pending.current.clear();
            update(key, null);
          },
        });
        return;
      }
      if (Date.now() - started > WAIT_MS) {
        clearInterval(timer);
        if (server + 1 < SERVERS.length) update(key, { server: server + 1 });
        else {
          update(key, null);
          session.fail(new Error('No server had this title.'));
        }
      }
    }, 500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, session.found]);

  const url = embedUrl(SERVERS[server], target.mediaType, target.mediaId, target.season, target.episode);

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { c: string; p: Record<string, unknown> };
      const p = message.p;
      if (message.c === 'fetched' && p) {
        const call = pending.current.get(Number(p.id));
        if (!call) return;
        pending.current.delete(Number(p.id));
        clearTimeout(call.timer);
        if (p.ok) call.resolve(new Uint8Array(Buffer.from(String(p.data), 'base64')));
        else call.reject(Object.assign(new Error(`HTTP ${p.status}`), { status: Number(p.status) || 0 }));
        return;
      }
      // It plays off screen: keep it quiet, and paused once the stream is found.
      if (message.c === 'state' && p) {
        if (!p.muted) web.current?.injectJavaScript(js.command({ action: 'setMuted', muted: true }));
        if (session.found && p.playing) web.current?.injectJavaScript(js.command({ action: 'pause' }));
      }
      if (message.c !== 'stream' || !p || session.found) return;
      if (p.ua) ua.current = String(p.ua);
      const kind = classify(String(p.url), String(p.type), Number(p.size) || undefined);
      if (kind) registry.current.add({ frameUrl: String(p.frame), url: String(p.url), kind, size: Number(p.size) || undefined });
    } catch {
      // Not ours.
    }
  };

  return (
    <View style={styles.offscreen} pointerEvents="none">
      <WebView
        ref={web as never}
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
        webviewDebuggingEnabled /* TEMP: investigating downloads */
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
