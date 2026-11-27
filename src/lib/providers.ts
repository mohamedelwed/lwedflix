// The streaming servers ("providers") and how to build each one's embed
// URL. Shared by the desktop player (src/components/VideoPlayer.tsx) and the
// phone app (mobile/), so both offer the same servers in the same order.

export interface Provider {
  name: string;
  url: string;
  type: 'tmdb' | 'imdb';
  /**
   * Origins whose postMessage traffic we accept for this provider.
   *
   * Normally just the origin of `url`, but a provider that redirects
   * serves its player — and therefore posts its messages — from the
   * host it lands on, not the one we requested. Stays a strict
   * allowlist; never widen this to a wildcard, since any page on the
   * internet can postMessage this window.
   */
  origins?: string[];
  /**
   * For players whose URLs don't follow `${url}/movie/${id}` and
   * `${url}/tv/${id}/${season}/${episode}`.
   */
  embed?: (kind: 'movie' | 'tv', id: string | number, season: number, episode: number) => string;
}

// Status as of 2026-10-22, checked by pressing play on a movie, a TV
// episode, an anime series and an anime film in each:
//   vidsrc.me  — streams all four (HLS).
//   vidcore    — streams all four (HLS).
//   2embed     — streams all four (HLS); tries to open two pop-ups per load.
//   videasy    — loads, then "We couldn't find that" for all four.
//   vidlink    — "Couldn't find this content" for three of the four.
// Not added: SuperEmbed (multiembed.mov) — full-page casino/shopping ads
// before every video, and movies stalled on "loading server".
// vidsrc.sbs was dropped: its registrar put the domain on clientHold, so it
// no longer resolves anywhere.
export const PROVIDERS: Provider[] = [
  // Default: the most reliable in testing. (Progress, watch-party sync and
  // episode auto-marking work on every server — the player bridge reads the
  // <video> itself.)
  //
  // Currently 302-redirects to vidsrc.sh. Kept on .me so the redirect can
  // follow wherever the mirror moves next.
  { name: 'vidsrc.me', url: 'https://vidsrc.me/embed', type: 'tmdb' },
  { name: 'vidcore', url: 'https://vidcore.org/embed', type: 'tmdb' },
  {
    name: '2embed',
    url: 'https://www.2embed.cc',
    type: 'tmdb',
    // Its TV path takes season and episode as `&s=…&e=…` with no `?`.
    embed: (kind, id, season, episode) =>
      kind === 'movie'
        ? `https://www.2embed.cc/embed/${id}`
        : `https://www.2embed.cc/embedtv/${id}&s=${season}&e=${episode}`,
  },
  // Also broadcasts its own progress (MEDIA_DATA over postMessage), which
  // the player listens for too.
  //
  // .net 301-redirects to .to. Pointing straight at .to avoids the hop,
  // and both are listed below because the redirect means either host can
  // end up being the one that posts progress.
  {
    name: 'videasy',
    url: 'https://player.videasy.to',
    type: 'tmdb',
    origins: ['https://player.videasy.to', 'https://player.videasy.net'],
  },
  // Reports no progress.
  { name: 'vidlink', url: 'https://vidlink.pro', type: 'tmdb' },
];

/** The embed URL for a title on a server. */
export function embedUrl(
  provider: Provider,
  type: 'movie' | 'tv',
  id: string | number,
  season: number,
  episode: number,
  imdbId?: string | null
): string {
  const base = provider.url;
  const useId = provider.type === 'imdb' && imdbId ? imdbId : id;
  if (provider.embed) return provider.embed(type, useId, season, episode);
  if (type === 'movie') return `${base}/movie/${useId}`;
  return `${base}/tv/${useId}/${season}/${episode}`;
}
