import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Circle, Popcorn, Share2 } from 'lucide-react-native';
import { getTVDetails, getTVSeasonDetails } from '@shared/lib/tmdb';
import {
  getEpisodePositions,
  getLastPosition,
  getWatchedKeys,
  hydrateShowProgress,
  markEpisodeWatched,
  syncShowProgress,
  toggleEpisodeWatched,
} from '@shared/lib/episodeProgress';
import { shareUrl } from '@shared/lib/shareLink';
import { startParty } from '@shared/lib/watchRoom';
import TitleLayout from '@/components/TitleLayout';
import TitleInfo from '@/components/TitleInfo';
import ActionButton from '@/components/ActionButton';
import WatchlistButton from '@/components/WatchlistButton';
import CastRow, { type Person } from '@/components/CastRow';
import ContentRow from '@/components/ContentRow';
import Chip from '@/components/Chip';
import DownloadButton from '@/components/DownloadButton';
import SeasonDownloadButton from '@/components/SeasonDownloadButton';
import { ErrorState, Loading } from '@/components/States';
import PlayerView from '@/player/PlayerView';
import UpNextCard from '@/player/UpNextCard';
import { usePlaybackTracking } from '@/player/usePlaybackTracking';
import type { PlayerHandle, PlayerState } from '@/player/types';
import { useAsync } from '@/lib/useAsync';
import { adjacentEpisode, type EpisodeRef } from '@/lib/episodes';
import { imageUrl, type MediaItem } from '@/lib/media';
import { colors, radius, space, type } from '@/theme';

interface ShowDetails extends MediaItem {
  number_of_seasons?: number;
  seasons?: { season_number: number; name: string; episode_count: number }[];
  genres?: { id: number; name: string }[];
  episode_run_time?: number[];
  tagline?: string;
  external_ids?: { imdb_id?: string | null };
  credits?: { cast: Person[] };
  created_by?: Person[];
  recommendations?: { results: MediaItem[] };
}

export interface Episode {
  episode_number: number;
  name: string;
  overview?: string;
  still_path?: string | null;
  runtime?: number | null;
  air_date?: string | null;
}

export default function ShowScreen() {
  const params = useLocalSearchParams<{ id: string; season?: string; episode?: string; play?: string }>();
  const id = params.id;
  const { data: show, error, reload } = useAsync<ShowDetails>(`tv:${id}`, () => getTVDetails(id));

  const last = getLastPosition(id);
  const [active, setActive] = useState<EpisodeRef>(() =>
    params.season ? { season: Number(params.season), episode: Number(params.episode ?? 1) } : last ?? { season: 1, episode: 1 }
  );
  const [browseSeason, setBrowseSeason] = useState(active.season);
  const [playing, setPlaying] = useState(params.play === '1' || !!params.season);
  const [autoplay, setAutoplay] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [state, setState] = useState<PlayerState | null>(null);
  const [next, setNext] = useState<EpisodeRef | null>(null);
  const [, setProgressTick] = useState(0);
  const player = useRef<PlayerHandle>(null);

  const season = useAsync<{ episodes: Episode[] }>(`tv:${id}:season:${browseSeason}`, () => getTVSeasonDetails(id, browseSeason));
  const activeSeason = useAsync<{ episodes: Episode[] }>(`tv:${id}:season:${active.season}`, () => getTVSeasonDetails(id, active.season));
  const activeEpisode = activeSeason.data?.episodes?.find((e) => e.episode_number === active.episode);

  useEffect(() => {
    let live = true;
    void hydrateShowProgress(id).then((changed) => {
      if (!live || !changed) return;
      setProgressTick((t) => t + 1);
      if (!params.season) {
        const saved = getLastPosition(id);
        if (saved) {
          setActive(saved);
          setBrowseSeason(saved.season);
        }
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    let live = true;
    setNext(null);
    void adjacentEpisode(id, active, 1).then((n) => live && setNext(n));
    return () => {
      live = false;
    };
  }, [id, active]);

  const media = {
    type: 'tv' as const,
    id: Number(id),
    title: show?.name ?? '',
    posterPath: show?.poster_path,
    backdropPath: show?.backdrop_path,
    imdbId: show?.external_ids?.imdb_id,
    season: active.season,
    episode: active.episode,
    episodeTitle: activeEpisode?.name,
  };
  const track = usePlaybackTracking(media, playing && !!show, () => setProgressTick((t) => t + 1));
  const onState = useCallback(
    (s: PlayerState | null) => {
      setState(s);
      track(s);
    },
    [track]
  );

  const playEpisode = useCallback((ref: EpisodeRef, auto = true) => {
    setActive(ref);
    setBrowseSeason(ref.season);
    setAutoplay(auto);
    setPlaying(true);
    setState(null);
  }, []);

  const playNext = useCallback(() => {
    if (!next) return;
    markEpisodeWatched(id, active.season, active.episode);
    syncShowProgress(id);
    playEpisode(next, true);
  }, [id, active, next, playEpisode]);

  if (error && !show) return <ErrorState onRetry={reload} />;
  if (!show) return <Loading />;

  const seasons = (show.seasons ?? []).filter((s) => s.season_number > 0 && s.episode_count > 0);
  const watched = getWatchedKeys(id);
  const positions = getEpisodePositions(id);
  const year = (show.first_air_date ?? '').split('-')[0];

  return (
    <TitleLayout
      backdrop={imageUrl(show.backdrop_path, 'w1280')}
      playing={playing}
      onPlay={() => setPlaying(true)}
      playLabel={`Play S${active.season} E${active.episode}`}
      fullscreen={fullscreen}
      setFullscreen={setFullscreen}
      player={
        <PlayerView
          ref={player}
          media={media}
          resumeAt={positions[`${active.season}-${active.episode}`]?.watched}
          autoplay={autoplay}
          fullscreen={fullscreen}
          onFullscreenChange={setFullscreen}
          onState={onState}
          onNext={next ? playNext : undefined}
          onBack={() => (fullscreen ? setFullscreen(false) : setPlaying(false))}
          overlay={
            next ? (
              <UpNextCard
                key={`${active.season}-${active.episode}`}
                state={state}
                next={next}
                onPlayNext={playNext}
              />
            ) : null
          }
        />
      }
    >
      <TitleInfo
        title={show.name ?? ''}
        tagline={show.tagline}
        rating={show.vote_average}
        year={year}
        extra={show.number_of_seasons ? `${show.number_of_seasons} season${show.number_of_seasons > 1 ? 's' : ''}` : undefined}
        genres={show.genres}
        overview={show.overview}
        actions={
          <>
            <WatchlistButton id={show.id} type="tv" title={show.name ?? ''} posterPath={show.poster_path} />
            <DownloadButton player={player} playing={playing} onStartPlaying={() => setPlaying(true)} media={media} />
            <ActionButton
              icon={Popcorn}
              label="Watch party"
              onPress={() => {
                const code = startParty({
                  mediaType: 'tv',
                  mediaId: String(show.id),
                  title: show.name ?? '',
                  posterPath: show.poster_path ?? null,
                  season: active.season,
                  episode: active.episode,
                });
                router.push(`/watch/${code}`);
              }}
            />
            <ActionButton
              icon={Share2}
              label="Share"
              onPress={() => void Share.share({ message: `${show.name} on Lwedflix: ${shareUrl(`/tv/${show.id}?season=${active.season}&episode=${active.episode}`)}` })}
            />
          </>
        }
      />

      <View style={styles.episodesHead}>
        <Text style={styles.heading}>Episodes</Text>
        <SeasonDownloadButton show={{ id: show.id, name: show.name ?? '', posterPath: show.poster_path ?? null }} season={browseSeason} episodes={season.data?.episodes ?? []} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seasons}>
        {seasons.map((s) => (
          <Chip key={s.season_number} label={s.name || `Season ${s.season_number}`} active={browseSeason === s.season_number} onPress={() => setBrowseSeason(s.season_number)} />
        ))}
      </ScrollView>
      <View style={styles.episodes}>
        {(season.data?.episodes ?? []).map((e) => {
          const key = `${browseSeason}-${e.episode_number}`;
          const isActive = active.season === browseSeason && active.episode === e.episode_number;
          const pos = positions[key];
          const fraction = pos && pos.duration > 0 ? pos.watched / pos.duration : 0;
          const done = watched.has(key);
          return (
            <Pressable
              key={key}
              onPress={() => playEpisode({ season: browseSeason, episode: e.episode_number })}
              style={({ pressed }) => [styles.episode, isActive && styles.episodeActive, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.still}>
                {e.still_path && <Image source={imageUrl(e.still_path, 'w300')} style={StyleSheet.absoluteFill} contentFit="cover" />}
                {fraction > 0 && (
                  <View style={styles.stillTrack}>
                    <View style={[styles.stillFill, { width: `${Math.min(100, fraction * 100)}%` }]} />
                  </View>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.epTitle, isActive && { color: colors.accent }]} numberOfLines={2}>
                  {e.episode_number}. {e.name}
                </Text>
                {!!e.runtime && <Text style={styles.epMeta}>{e.runtime}m</Text>}
                {!!e.overview && <Text style={styles.epOverview} numberOfLines={2}>{e.overview}</Text>}
              </View>
              <Pressable
                hitSlop={10}
                onPress={() => {
                  toggleEpisodeWatched(id, browseSeason, e.episode_number);
                  syncShowProgress(id);
                  setProgressTick((t) => t + 1);
                }}
                accessibilityLabel={done ? 'Mark as not watched' : 'Mark as watched'}
              >
                {done ? <CheckCircle2 color={colors.accent} size={22} /> : <Circle color={colors.white20} size={22} />}
              </Pressable>
            </Pressable>
          );
        })}
      </View>

      <CastRow title="Created by" people={show.created_by ?? []} />
      <CastRow title="Cast" people={(show.credits?.cast ?? []).slice(0, 20)} />
      <ContentRow title="More like this" items={(show.recommendations?.results ?? []).map((r) => ({ ...r, media_type: 'tv' as const }))} />
    </TitleLayout>
  );
}

const styles = StyleSheet.create({
  episodesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, marginTop: space.xl, marginBottom: space.md },
  heading: { ...type.h2, color: colors.foreground },
  seasons: { gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md },
  episodes: { paddingHorizontal: space.lg, gap: space.sm },
  episode: { flexDirection: 'row', gap: space.md, alignItems: 'center', padding: space.sm, borderRadius: radius.lg, backgroundColor: colors.white5, borderWidth: 1, borderColor: 'transparent' },
  episodeActive: { borderColor: 'rgba(255,153,0,0.4)', backgroundColor: 'rgba(255,153,0,0.06)' },
  still: { width: 120, aspectRatio: 16 / 9, borderRadius: radius.md, backgroundColor: colors.card, overflow: 'hidden' },
  stillTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: colors.white20 },
  stillFill: { height: 3, backgroundColor: colors.accent },
  epTitle: { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  epMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  epOverview: { color: colors.muted, fontSize: 12, marginTop: 2, lineHeight: 16 },
});
