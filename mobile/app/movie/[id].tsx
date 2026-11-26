import React, { useEffect, useRef, useState } from 'react';
import { Share } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MapIcon, Popcorn, Share2 } from 'lucide-react-native';
import { getCollection, getMovieDetails } from '@shared/lib/tmdb';
import { getMovieResume } from '@shared/lib/movieProgress';
import { hydrateMovieProgress } from '@shared/lib/movieProgressSync';
import { shareUrl } from '@shared/lib/shareLink';
import { startParty } from '@shared/lib/watchRoom';
import TitleLayout from '@/components/TitleLayout';
import TitleInfo from '@/components/TitleInfo';
import ActionButton from '@/components/ActionButton';
import WatchlistButton from '@/components/WatchlistButton';
import CastRow, { type Person } from '@/components/CastRow';
import ContentRow from '@/components/ContentRow';
import DownloadButton from '@/components/DownloadButton';
import { ErrorState, Loading } from '@/components/States';
import PlayerView from '@/player/PlayerView';
import { usePlaybackTracking } from '@/player/usePlaybackTracking';
import type { PlayerHandle } from '@/player/types';
import { useAsync } from '@/lib/useAsync';
import { formatRuntime, imageUrl, type MediaItem } from '@/lib/media';

interface MovieDetails extends MediaItem {
  imdb_id?: string | null;
  runtime?: number;
  tagline?: string;
  genres?: { id: number; name: string }[];
  belongs_to_collection?: { id: number; name: string } | null;
  credits?: { cast: Person[]; crew: Person[] };
  recommendations?: { results: MediaItem[] };
}

export default function MovieScreen() {
  const { id, play } = useLocalSearchParams<{ id: string; play?: string }>();
  const { data: movie, error, reload } = useAsync<MovieDetails>(`movie:${id}`, () => getMovieDetails(id));
  const collection = useAsync<{ name: string; parts: MediaItem[] } | null>(
    movie?.belongs_to_collection ? `collection:${movie.belongs_to_collection.id}` : null,
    () => getCollection(movie!.belongs_to_collection!.id).catch(() => null)
  );

  const [playing, setPlaying] = useState(play === '1');
  const [fullscreen, setFullscreen] = useState(false);
  const [resumeAt, setResumeAt] = useState(() => getMovieResume(id));
  const player = useRef<PlayerHandle>(null);

  useEffect(() => {
    let live = true;
    void hydrateMovieProgress(id).then((changed) => live && changed && setResumeAt(getMovieResume(id)));
    return () => {
      live = false;
    };
  }, [id]);

  const media = {
    type: 'movie' as const,
    id: Number(id),
    title: movie?.title ?? '',
    posterPath: movie?.poster_path,
    backdropPath: movie?.backdrop_path,
    imdbId: movie?.imdb_id,
  };
  const onState = usePlaybackTracking(media, playing && !!movie);

  if (error && !movie) return <ErrorState onRetry={reload} />;
  if (!movie) return <Loading />;

  const directors = (movie.credits?.crew ?? []).filter((p) => p.job === 'Director');
  const parts = (collection.data?.parts ?? []).filter((p) => p.release_date).sort((a, b) => (a.release_date ?? '').localeCompare(b.release_date ?? ''));
  const resumeLabel = resumeAt ? 'Resume' : 'Play';

  return (
    <TitleLayout
      backdrop={imageUrl(movie.backdrop_path, 'w1280')}
      playing={playing}
      onPlay={() => setPlaying(true)}
      playLabel={resumeLabel}
      fullscreen={fullscreen}
      setFullscreen={setFullscreen}
      player={
        <PlayerView
          ref={player}
          media={media}
          resumeAt={resumeAt}
          autoplay
          fullscreen={fullscreen}
          onFullscreenChange={setFullscreen}
          onState={onState}
          onBack={() => (fullscreen ? setFullscreen(false) : setPlaying(false))}
        />
      }
    >
      <TitleInfo
        title={movie.title ?? ''}
        tagline={movie.tagline}
        rating={movie.vote_average}
        runtime={formatRuntime(movie.runtime)}
        year={(movie.release_date ?? '').split('-')[0]}
        genres={movie.genres}
        overview={movie.overview}
        actions={
          <>
            <WatchlistButton id={movie.id} type="movie" title={movie.title ?? ''} posterPath={movie.poster_path} />
            <DownloadButton player={player} playing={playing} onStartPlaying={() => setPlaying(true)} media={media} />
            <ActionButton
              icon={Popcorn}
              label="Watch party"
              onPress={() => {
                const code = startParty({ mediaType: 'movie', mediaId: String(movie.id), title: movie.title ?? '', posterPath: movie.poster_path ?? null, season: null, episode: null });
                router.push(`/watch/${code}`);
              }}
            />
            <ActionButton icon={Share2} label="Share" onPress={() => void Share.share({ message: `${movie.title} on Lwedflix: ${shareUrl(`/movie/${movie.id}`)}` })} />
            <ActionButton icon={MapIcon} label="Find similar" onPress={() => router.push(`/map?film=${movie.id}`)} />
          </>
        }
      />
      <CastRow title="Directed by" people={directors} />
      <CastRow title="Cast" people={(movie.credits?.cast ?? []).slice(0, 20)} />
      {parts.length > 1 && <ContentRow title={collection.data?.name ?? 'Collection'} items={parts.map((p) => ({ ...p, media_type: 'movie' as const }))} />}
      <ContentRow title="More like this" items={(movie.recommendations?.results ?? []).map((r) => ({ ...r, media_type: 'movie' as const }))} />
    </TitleLayout>
  );
}
