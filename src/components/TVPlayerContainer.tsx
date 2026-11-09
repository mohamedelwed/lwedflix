'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { useSearchParams, usePathname } from 'next/navigation';
import VideoPlayer from './VideoPlayer';
import UpNextCard from './UpNextCard';
import SeasonDownloadButton from './downloads/SeasonDownloadButton';
import { useAuth } from './AuthProvider';
import MovieCard from './MovieCard';
import {
  Star,
  Calendar,
  Users,
  List,
  Bookmark,
  ChevronRight,
  Check,
  ChevronLeft,
  SkipForward,
} from 'lucide-react';
import { getImageUrl } from '@/lib/imageUrl';
import WatchlistButton from './WatchlistButton';
import RecommendButton from './RecommendButton';
import ShareTitleButton from './ShareTitleButton';
import WatchRoomButton from './WatchRoomButton';
import TitleDiscussion from './TitleDiscussion';
import {
  getLastPosition,
  setLastPosition,
  toggleEpisodeWatched,
  markEpisodeWatched,
  hydrateShowProgress,
  getWatchedKeys,
  getEpisodePositions,
  setEpisodePosition,
  type EpisodePosition,
} from '@/lib/episodeProgress';

interface TVPlayerContainerProps {
  show: any;
}

const TVPlayerContainer = ({ show }: TVPlayerContainerProps) => {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  // Search params reflect the requested URL identically on server and client,
  // so it's safe to use them for the initial render (no hydration mismatch).
  // localStorage isn't available during SSR, so the "resume last episode"
  // fallback is applied after mount instead, in the effect below.
  const urlSeason = Number(searchParams.get('season'));
  const urlEpisode = Number(searchParams.get('episode'));
  const { user } = useAuth();
  const [position, setPosition] = useState(() =>
    urlSeason > 0 && urlEpisode > 0
      ? { season: urlSeason, episode: urlEpisode }
      : { season: 1, episode: 1 }
  );
  const { season: activeSeason, episode: activeEpisode } = position;

  // Watched marks are also client-only state; start empty (matches SSR) and
  // hydrate from localStorage after mount.
  const [watchedKeys, setWatchedKeys] = useState<Set<string>>(new Set());
  const [positions, setPositions] = useState<Record<string, EpisodePosition>>({});

  // Episode names/synopses aren't in the show payload — TMDB only includes
  // episode_count per season there — so the active season's episode list is
  // fetched separately whenever the season changes.
  const [seasonEpisodes, setSeasonEpisodes] = useState<any[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tv-season?id=${show.id}&season=${activeSeason}`)
      .then((res) => res.json())
      .then((data) => { if (!cancelled) setSeasonEpisodes(data.episodes || []); })
      .catch(() => { if (!cancelled) setSeasonEpisodes([]); });
    return () => { cancelled = true; };
  }, [show.id, activeSeason]);

  const currentEpisodeData = seasonEpisodes.find((e: any) => e.episode_number === activeEpisode);

  // Hover preview: details come straight from seasonEpisodes (already
  // fetched). A short preview clip is a separate, per-episode lookup — most
  // episodes have none, since TMDB only carries official promo clips/teasers
  // here, never the episode itself, so it's fetched lazily and only after
  // the hover holds for a moment (skips firing on quick mouse passes).
  const [hoveredEpisode, setHoveredEpisode] = useState<number | null>(null);
  const [hoverClipUrl, setHoverClipUrl] = useState<string | null>(null);
  const hoveredEpisodeData = seasonEpisodes.find((e: any) => e.episode_number === hoveredEpisode);

  useEffect(() => {
    if (hoveredEpisode == null) {
      setHoverClipUrl(null);
      return;
    }
    setHoverClipUrl(null);
    const timer = setTimeout(() => {
      fetch(`/api/tv-episode-videos?id=${show.id}&season=${activeSeason}&episode=${hoveredEpisode}`)
        .then((res) => res.json())
        .then((data) => {
          const clip = (data.results || []).find(
            (v: any) => v.site === 'YouTube' && (v.type === 'Clip' || v.type === 'Teaser' || v.type === 'Trailer')
          );
          if (clip) setHoverClipUrl(`https://www.youtube.com/embed/${clip.key}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0`);
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [hoveredEpisode, show.id, activeSeason]);

  const updateUrl = (season: number, episode: number) => {
    const url = `${pathname}?season=${season}&episode=${episode}`;
    window.history.replaceState(null, '', url);
  };

  // An episode picked here (or Up next's) starts on its own; the one the
  // page opens on waits for play.
  const [autoplay, setAutoplay] = useState(false);
  const selectEpisode = (season: number, episode: number, play = true) => {
    if (play) setAutoplay(true);
    setPosition({ season, episode });
    setLastPosition(show.id, season, episode);
    updateUrl(season, episode);
  };

  // On mount: if the URL didn't specify an episode, resume where the viewer
  // left off; either way, load the watched marks and make sure the URL
  // reflects the episode actually playing.
  useEffect(() => {
    if (!(urlSeason > 0 && urlEpisode > 0)) {
      const last = getLastPosition(show.id);
      if (last) {
        setPosition(last);
        updateUrl(last.season, last.episode);
      } else {
        updateUrl(1, 1);
      }
    }
    setWatchedKeys(getWatchedKeys(show.id));
    setPositions(getEpisodePositions(show.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show.id]);

  // Pull saved progress for this account and re-read once it lands.
  // Runs on sign-in too, so marks made while signed out merge in rather
  // than being stranded in that browser.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    hydrateShowProgress(show.id).then((changed) => {
      if (cancelled || !changed) return;
      setWatchedKeys(getWatchedKeys(show.id));
      setPositions(getEpisodePositions(show.id));

      // Only move the viewer if they didn't ask for a specific episode.
      if (!(urlSeason > 0 && urlEpisode > 0)) {
        const last = getLastPosition(show.id);
        if (last) {
          setPosition(last);
          updateUrl(last.season, last.episode);
        }
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show.id, user?.id]);

  // Real playback position from the player, reported about once a second.
  // setEpisodePosition marks the episode watched once it's far enough in and
  // returns false when nothing actually changed, so idle ticks cost nothing.
  const handleProgress = useCallback(
    ({ watched, duration }: { watched: number; duration: number }) => {
      if (!setEpisodePosition(show.id, activeSeason, activeEpisode, watched, duration)) return;
      setPositions(getEpisodePositions(show.id));
      setWatchedKeys(getWatchedKeys(show.id));
    },
    [show.id, activeSeason, activeEpisode]
  );

  const toggleWatched = (season: number, episode: number) => {
    toggleEpisodeWatched(show.id, season, episode);
    setWatchedKeys(getWatchedKeys(show.id));
  };

  const seasonsWithEpisodes = useMemo(
    () => show.seasons.filter((s: any) => s.season_number > 0),
    [show.seasons]
  );
  const totalEpisodes = useMemo(
    () => seasonsWithEpisodes.reduce((acc: number, s: any) => acc + s.episode_count, 0),
    [seasonsWithEpisodes]
  );
  // Previous/next across season boundaries: the last episode of a season
  // is followed by episode 1 of the next, not by nothing.
  const { prevEpisode, nextEpisode } = useMemo(() => {
    const idx = seasonsWithEpisodes.findIndex((s: any) => s.season_number === activeSeason);
    const count =
      seasonsWithEpisodes.find((s: any) => s.season_number === activeSeason)?.episode_count ?? 0;

    let prev: { season: number; episode: number } | null = null;
    let next: { season: number; episode: number } | null = null;

    if (activeEpisode > 1) {
      prev = { season: activeSeason, episode: activeEpisode - 1 };
    } else if (idx > 0) {
      const ps = seasonsWithEpisodes[idx - 1];
      prev = { season: ps.season_number, episode: ps.episode_count };
    }

    if (activeEpisode < count) {
      next = { season: activeSeason, episode: activeEpisode + 1 };
    } else if (idx >= 0 && idx < seasonsWithEpisodes.length - 1) {
      next = { season: seasonsWithEpisodes[idx + 1].season_number, episode: 1 };
    }

    return { prevEpisode: prev, nextEpisode: next };
  }, [seasonsWithEpisodes, activeSeason, activeEpisode]);

  // Advancing implies you finished the one you were on, so mark it —
  // markEpisodeWatched, not toggleEpisodeWatched, or hitting Next on an
  // already-watched episode would silently un-mark it.
  const goToNextEpisode = () => {
    markEpisodeWatched(show.id, activeSeason, activeEpisode);
    setWatchedKeys(getWatchedKeys(show.id));
    if (nextEpisode) selectEpisode(nextEpisode.season, nextEpisode.episode);
  };

  // Pick an unfinished episode up where it was left; a finished one (or one
  // barely started) plays from the top.
  const saved = positions[`${activeSeason}-${activeEpisode}`];
  const resumeAt =
    saved && saved.duration > 0 && saved.watched / saved.duration < 0.9 ? saved.watched : undefined;

  const episodeControls = (
    <>
      <button
        onClick={() => prevEpisode && selectEpisode(prevEpisode.season, prevEpisode.episode)}
        disabled={!prevEpisode}
        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-black/20 text-[10px] font-bold uppercase tracking-widest text-white/50 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed transition-all"
        title={
          prevEpisode
            ? `Play S${prevEpisode.season} E${prevEpisode.episode}`
            : 'This is the first episode'
        }
      >
        <ChevronLeft size={14} />
        <span>Previous</span>
      </button>

      <button
        onClick={goToNextEpisode}
        disabled={!nextEpisode}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-[10px] font-bold uppercase tracking-widest text-white shadow-lg hover:bg-accent/90 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
        title={
          nextEpisode
            ? `Mark S${activeSeason} E${activeEpisode} watched and play S${nextEpisode.season} E${nextEpisode.episode}`
            : 'This is the last episode'
        }
      >
        <span>Next</span>
        <SkipForward size={14} />
      </button>
    </>
  );

  const watchedCount = useMemo(
    () =>
      Array.from(watchedKeys).filter((key) => {
        const [s] = key.split('-').map(Number);
        return seasonsWithEpisodes.some((se: any) => se.season_number === s);
      }).length,
    [watchedKeys, seasonsWithEpisodes]
  );
  const progressPercent = totalEpisodes > 0 ? Math.round((watchedCount / totalEpisodes) * 100) : 0;

  const currentSeason = show.seasons.find((s: any) => s.season_number === activeSeason);
  const releaseYear = (show.first_air_date || '').split('-')[0];

  return (
    <div className="container mx-auto px-6 -mt-40 relative z-20 space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        {/* Left Column: Player and Details */}
        <div className="lg:col-span-2 space-y-8">
          <VideoPlayer
            type="tv"
            id={show.id}
            imdbId={show.external_ids?.imdb_id}
            season={activeSeason}
            episode={activeEpisode}
            title={show.name}
            posterPath={show.poster_path}
            videos={show.videos.results}
            onProgress={handleProgress}
            controls={episodeControls}
            resumeAt={resumeAt}
            onNext={nextEpisode ? goToNextEpisode : undefined}
            nextLabel={nextEpisode ? `S${nextEpisode.season} E${nextEpisode.episode}` : undefined}
            episodeTitle={seasonEpisodes.find((e) => e.season_number === activeSeason && e.episode_number === activeEpisode)?.name}
            autoplay={autoplay}
            overlay={
              nextEpisode && (
                <UpNextCard
                  key={`${activeSeason}-${activeEpisode}`}
                  next={nextEpisode}
                  name={
                    nextEpisode.season === activeSeason
                      ? seasonEpisodes.find((e) => e.episode_number === nextEpisode.episode)?.name
                      : undefined
                  }
                  onPlayNext={goToNextEpisode}
                />
              )
            }
          />
          
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-6">
                <h1 className="text-4xl md:text-5xl font-bold text-white">{show.name}</h1>
                <div className="flex items-center gap-3 flex-wrap">
                  <WatchlistButton
                    id={show.id}
                    type="tv"
                    title={show.name}
                    posterPath={show.poster_path}
                  />
                  <RecommendButton
                    mediaType="tv"
                    mediaId={show.id}
                    title={show.name}
                    posterPath={show.poster_path}
                  />
                  <ShareTitleButton
                    mediaType="tv"
                    mediaId={show.id}
                    title={show.name}
                    posterPath={show.poster_path}
                    season={activeSeason}
                    episode={activeEpisode}
                  />
                  <WatchRoomButton
                    mediaType="tv"
                    mediaId={show.id}
                    title={show.name}
                    posterPath={show.poster_path}
                    season={activeSeason}
                    episode={activeEpisode}
                  />
                </div>
              </div>

              {currentEpisodeData && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs font-bold text-accent uppercase tracking-widest">
                    Season {activeSeason} · Episode {activeEpisode}
                  </p>
                  {currentEpisodeData.name && (
                    <h2 className="text-xl font-bold text-white">{currentEpisodeData.name}</h2>
                  )}
                  {currentEpisodeData.overview && (
                    <p className="text-sm text-white/60 leading-relaxed max-w-2xl">
                      {currentEpisodeData.overview}
                    </p>
                  )}

                </div>
              )}

              <div className="flex flex-wrap gap-4 text-sm font-medium text-muted">
                <div className="flex items-center space-x-1">
                  <Star className="text-yellow-500 fill-yellow-500" size={16} />
                  <span className="text-white">{show.vote_average.toFixed(1)}</span>
                </div>
                <div className="flex items-center space-x-1 text-accent">
                  <span>{show.number_of_seasons} Seasons</span>
                </div>
                <div className="flex items-center space-x-1">
                  <Calendar size={16} />
                  <span>{releaseYear}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {show.genres.map((genre: any) => (
                <span key={genre.id} className="px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-white/80">
                  {genre.name}
                </span>
              ))}
            </div>

            {/* Episode Selector */}
            <div className="p-6 rounded-3xl bg-white/[0.02] border border-white/5 space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-accent/20 rounded-xl flex items-center justify-center text-accent">
                    <List size={20} />
                  </div>
                  <h3 className="text-xl font-bold text-white">Episodes</h3>
                </div>
                <div className="flex items-center gap-2">
                  <SeasonDownloadButton
                    showId={show.id}
                    showTitle={show.name}
                    posterPath={show.poster_path}
                    season={activeSeason}
                    seasons={seasonsWithEpisodes}
                  />
                  <select
                    value={activeSeason}
                    onChange={(e) => selectEpisode(Number(e.target.value), 1, false)}
                    className="bg-card border border-white/10 text-white text-sm rounded-xl px-4 py-2 focus:ring-2 focus:ring-accent outline-none"
                  >
                    {seasonsWithEpisodes.map((s: any) => (
                      <option key={s.id} value={s.season_number}>
                        Season {s.season_number}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Overall show progress */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-medium text-muted">
                  <span>{watchedCount} of {totalEpisodes} episodes watched</span>
                  <span className="text-white/70">{progressPercent}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
                {Array.from({ length: currentSeason?.episode_count || 0 }, (_, i) => i + 1).map((ep) => {
                  const key = `${activeSeason}-${ep}`;
                  const isActive = ep === activeEpisode;
                  const isWatched = watchedKeys.has(key);
                  const position = positions[key];
                  // Only meaningful mid-episode: 0% and "finished" are already
                  // conveyed by the tile's own styling.
                  const partial =
                    position && position.duration > 0 && !isWatched
                      ? Math.min(100, Math.round((position.watched / position.duration) * 100))
                      : 0;
                  const isHovered = hoveredEpisode === ep;
                  return (
                    // The hover card is `absolute`, so it never affects this
                    // wrapper's size or the grid's layout — it floats over
                    // whatever's underneath instead of pushing it down.
                    <div key={ep} className="relative">
                      <button
                        onClick={() => selectEpisode(activeSeason, ep)}
                        onMouseEnter={() => setHoveredEpisode(ep)}
                        onMouseLeave={() => setHoveredEpisode((prev) => (prev === ep ? null : prev))}
                        className={`relative w-full py-3 rounded-xl text-xs font-bold transition-all border ${
                          isActive
                            ? 'bg-accent border-accent text-white shadow-lg shadow-accent/20'
                            : isWatched
                            ? 'bg-white/[0.03] border-white/5 text-white/30'
                            : 'bg-white/5 border-white/5 text-white/50 hover:bg-white/10 hover:border-white/10'
                        }`}
                      >
                        EP {ep}
                        <span
                          role="button"
                          aria-label={isWatched ? 'Mark as unwatched' : 'Mark as watched'}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleWatched(activeSeason, ep);
                          }}
                          className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center border transition-colors ${
                            isWatched
                              ? 'bg-accent border-accent text-white'
                              : 'bg-black/60 border-white/10 text-transparent hover:text-white/40'
                          }`}
                        >
                          <Check size={11} strokeWidth={3} />
                        </span>
                        {partial > 0 && (
                          <span className="absolute bottom-0 left-0 right-0 h-1 rounded-b-xl bg-white/10 overflow-hidden">
                            <span
                              className="block h-full bg-accent/80"
                              style={{ width: `${partial}%` }}
                            />
                          </span>
                        )}
                      </button>

                      {/* Hover card: still image (or an official clip/teaser,
                          when TMDB has one for this episode) plus its details. */}
                      <AnimatePresence>
                        {isHovered && hoveredEpisodeData && (
                          <motion.div
                            initial={{ opacity: 0, y: -4, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -4, scale: 0.97 }}
                            transition={{ duration: 0.15 }}
                            className="absolute z-40 top-full mt-2 left-1/2 -translate-x-1/2 w-64 max-w-[85vw] pointer-events-none"
                          >
                            <div className="p-3 rounded-2xl bg-card border border-white/10 shadow-2xl space-y-2">
                              <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
                                {hoverClipUrl ? (
                                  <iframe
                                    key={hoverClipUrl}
                                    src={hoverClipUrl}
                                    className="w-full h-full"
                                    allow="autoplay; encrypted-media"
                                    frameBorder="0"
                                  />
                                ) : hoveredEpisodeData.still_path ? (
                                  <Image
                                    src={getImageUrl(hoveredEpisodeData.still_path, 'w300')}
                                    alt={hoveredEpisodeData.name}
                                    fill
                                    sizes="256px"
                                    className="object-cover"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-white/20">
                                    <List size={24} />
                                  </div>
                                )}
                              </div>
                              <p className="text-[10px] font-bold text-accent uppercase tracking-widest">
                                Episode {hoveredEpisodeData.episode_number}
                                {hoveredEpisodeData.air_date ? ` · ${hoveredEpisodeData.air_date}` : ''}
                                {hoveredEpisodeData.runtime ? ` · ${hoveredEpisodeData.runtime}m` : ''}
                              </p>
                              <h4 className="text-sm font-bold text-white line-clamp-1">{hoveredEpisodeData.name}</h4>
                              <p className="text-xs text-white/60 leading-relaxed line-clamp-3">
                                {hoveredEpisodeData.overview || 'No description available.'}
                              </p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </div>

            <p className="text-lg text-white/70 leading-relaxed max-w-3xl">
              {show.overview}
            </p>

            {/* Cast */}
            <div className="space-y-4 pt-4 border-t border-white/5">
              <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                <Users size={20} className="text-accent" />
                <span>Top Cast</span>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4">
                {show.credits.cast.slice(0, 6).map((person: any) => (
                  <Link 
                    key={person.id} 
                    href={`/person/${person.id}`}
                    className="text-center space-y-2 group"
                  >
                    <div className="relative aspect-square rounded-full overflow-hidden bg-card border border-white/5 group-hover:border-accent transition-all duration-300">
                      <Image 
                        src={getImageUrl(person.profile_path, 'w185')} 
                        alt={person.name}
                        fill
                        sizes="100px"
                        className="object-cover group-hover:scale-110 transition-transform duration-500"
                      />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white line-clamp-1 group-hover:text-accent transition-colors">{person.name}</p>
                      <p className="text-[10px] text-muted line-clamp-1">{person.character}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Reviews Section */}
            <TitleDiscussion
              mediaType="tv"
              mediaId={show.id}
              title={show.name}
              posterPath={show.poster_path}
              season={activeSeason}
              episode={activeEpisode}
              reviews={show.reviews.results}
            />
          </div>
        </div>

        {/* Right Column: Recommendations & Ads */}
        <div className="space-y-8 flex flex-col">
          <h3 className="text-xl font-bold text-white tracking-tight pt-4">Similar Shows</h3>
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-6">
            {show.recommendations.results.slice(0, 4).map((rec: any) => (
              <MovieCard 
                key={rec.id}
                id={rec.id}
                title={rec.name}
                posterPath={rec.poster_path}
                rating={rec.vote_average}
                date={(rec.first_air_date || '').split('-')[0]}
                type="tv"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TVPlayerContainer;
