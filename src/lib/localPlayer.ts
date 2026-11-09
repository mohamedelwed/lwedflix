import type { DesktopPlayer, PlayerCommand, PlayerEvent, PlayerState } from './desktopPlayer';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * The player bridge's shape (src/lib/desktopPlayer.ts) over a <video> on the
 * page, so a downloaded film gets the same controls, shortcuts and "Up next"
 * as a stream.
 */
export function createLocalPlayer(video: HTMLVideoElement): DesktopPlayer & { destroy: () => void } {
  const listeners = new Set<(state: PlayerState | null) => void>();
  const subtitles = () => [...video.textTracks].filter((t) => t.kind === 'subtitles' || t.kind === 'captions');

  const stateOf = (event: PlayerEvent): PlayerState => {
    let buffered = video.currentTime;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime + 0.5 && video.buffered.end(i) >= video.currentTime) buffered = video.buffered.end(i);
    }
    const tracks = subtitles();
    return {
      event,
      playing: !video.paused && !video.ended,
      time: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      muted: video.muted,
      volume: video.volume,
      rate: video.playbackRate,
      buffered,
      buffering: !video.paused && video.readyState < 3,
      tracks: tracks.map((t) => ({ label: t.label, language: t.language })),
      track: tracks.findIndex((t) => t.mode === 'showing'),
    };
  };
  const emit = (event: PlayerEvent) => {
    const state = stateOf(event);
    listeners.forEach((listener) => listener(state));
  };

  const events: PlayerEvent[] = ['play', 'pause', 'seeked', 'progress', 'loadedmetadata', 'ended', 'volumechange', 'ratechange', 'waiting', 'playing'];
  const handlers = events.map((event) => [event, () => emit(event)] as const);
  handlers.forEach(([event, handler]) => video.addEventListener(event, handler));
  // timeupdate fires about four times a second; the bridge reports about once.
  let lastTick = 0;
  const onTime = () => {
    const now = performance.now();
    if (now - lastTick < 900) return;
    lastTick = now;
    emit('timeupdate');
  };
  video.addEventListener('timeupdate', onTime);

  const play = () => void video.play().catch(() => {});
  const seek = (time: number) => {
    if (Number.isFinite(video.duration)) video.currentTime = clamp(time, 0, video.duration);
  };

  return {
    onState(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    onProblem: () => () => {},
    onShortcut: () => () => {},
    command(command: PlayerCommand) {
      switch (command.action) {
        case 'play': play(); break;
        case 'pause': video.pause(); break;
        case 'toggle': if (video.paused) play(); else video.pause(); break;
        case 'seek': seek(command.time); break;
        case 'seekBy': seek(video.currentTime + clamp(command.delta, -600, 600)); break;
        case 'toggleMute': video.muted = !video.muted; break;
        case 'setMuted': video.muted = command.muted; break;
        case 'setVolume':
          video.volume = clamp(command.volume, 0, 1);
          if (command.volume > 0) video.muted = false;
          break;
        case 'setRate': video.playbackRate = clamp(command.rate, 0.25, 4); break;
        case 'setTrack':
          subtitles().forEach((t, i) => { t.mode = i === command.index ? 'showing' : 'disabled'; });
          emit('tracks');
          break;
        case 'report': emit('status'); break;
        case 'pip':
          if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
          else void video.requestPictureInPicture().catch(() => {});
          break;
        // Nothing of a server's to hide or move out of the way here.
        case 'clean':
        case 'liftSubtitles':
          break;
      }
    },
    destroy() {
      handlers.forEach(([event, handler]) => video.removeEventListener(event, handler));
      video.removeEventListener('timeupdate', onTime);
      listeners.clear();
    },
  };
}
