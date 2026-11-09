import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { getMovieDetails, getCollection } from '@/lib/tmdb';
import { getImageUrl } from '@/lib/imageUrl';
import MoviePlayer from '@/components/MoviePlayer';
import MovieCard from '@/components/MovieCard';
import FranchiseRow from '@/components/FranchiseRow';
import { Star, Clock, Calendar, Users, Bookmark, Play, Layers, MapIcon } from 'lucide-react';
import WatchlistButton from '@/components/WatchlistButton';
import RecommendButton from '@/components/RecommendButton';
import ShareTitleButton from '@/components/ShareTitleButton';
import WatchRoomButton from '@/components/WatchRoomButton';
import TitleDiscussion from '@/components/TitleDiscussion';

export default async function MoviePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const movie = await getMovieDetails(id);

  const releaseYear = (movie.release_date || '').split('-')[0];
  const runtime = `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m`;

  // Find Director(s)
  const directors = movie.credits.crew.filter((p: any) => p.job === 'Director');

  // This title's own collection (direct sequels/prequels, e.g. a trilogy).
  const collectionId = movie.belongs_to_collection?.id;
  const collectionData = collectionId ? await getCollection(collectionId).catch(() => null) : null;

  const collectionItems = (collectionData?.parts || [])
    .filter((p: any) => p.release_date)
    .sort((a: any, b: any) => a.release_date.localeCompare(b.release_date))
    .map((p: any) => ({
      id: p.id,
      title: p.title,
      posterPath: p.poster_path,
      rating: p.vote_average || 0,
      year: (p.release_date || '').split('-')[0],
    }));

  return (
    <div className="min-h-screen pb-20">
      {/* Backdrop Header */}
      <div className="relative h-[50vh] w-full">
        <Image 
          src={getImageUrl(movie.backdrop_path)} 
          alt={movie.title}
          fill
          priority
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
      </div>

      <div className="container mx-auto px-6 -mt-40 relative z-20 space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Left Column: Player and Details */}
          <div className="lg:col-span-2 space-y-8">
            <MoviePlayer
              id={id} 
              imdbId={movie.imdb_id} 
              title={movie.title}
              posterPath={movie.poster_path}
              videos={movie.videos.results}
            />

            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-6">
                  <h1 className="text-4xl md:text-5xl font-bold text-white">{movie.title}</h1>
                  <div className="flex items-center gap-3 flex-wrap">
                    <WatchlistButton
                      id={movie.id}
                      type="movie"
                      title={movie.title}
                      posterPath={movie.poster_path}
                    />
                    <RecommendButton
                      mediaType="movie"
                      mediaId={movie.id}
                      title={movie.title}
                      posterPath={movie.poster_path}
                    />
                    <ShareTitleButton
                      mediaType="movie"
                      mediaId={movie.id}
                      title={movie.title}
                      posterPath={movie.poster_path}
                    />
                    <WatchRoomButton
                      mediaType="movie"
                      mediaId={movie.id}
                      title={movie.title}
                      posterPath={movie.poster_path}
                    />
                    <Link
                      href={`/map?film=${movie.id}`}
                      className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-white/5 border border-white/10 text-white text-sm font-bold hover:bg-white/10 transition-all"
                    >
                      <MapIcon size={16} />
                      <span>Find similar</span>
                    </Link>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-sm font-medium text-muted">
                  <div className="flex items-center space-x-1">
                    <Star className="text-yellow-500 fill-yellow-500" size={16} />
                    <span className="text-white">{movie.vote_average.toFixed(1)}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Clock size={16} />
                    <span>{runtime}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Calendar size={16} />
                    <span>{releaseYear}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {movie.genres.map((genre: any) => (
                  <span key={genre.id} className="px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-white/80">
                    {genre.name}
                  </span>
                ))}
              </div>

              <p className="text-lg text-white/70 leading-relaxed max-w-3xl">
                {movie.overview}
              </p>

              {/* Cast and Director */}
              <div className="space-y-8">
                <div className="flex flex-col space-y-4">
                  <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                    <Users size={20} className="text-accent" />
                    <span>Cast & Crew</span>
                  </h3>
                  
                  {/* Director(s) */}
                  <div className="flex flex-wrap gap-4">
                    {directors.map((director: any) => (
                      <Link 
                        key={director.id} 
                        href={`/person/${director.id}`}
                        className="group flex items-center space-x-3 bg-white/5 border border-white/10 hover:border-accent/40 rounded-2xl p-2 pr-6 transition-all"
                      >
                        <div className="relative w-12 h-12 rounded-xl overflow-hidden bg-card">
                          <Image 
                            src={getImageUrl(director.profile_path, 'w185')} 
                            alt={director.name}
                            fill
                            sizes="48px"
                            className="object-cover"
                          />
                        </div>
                        <div>
                          <p className="text-[10px] text-accent font-bold uppercase tracking-widest">Director</p>
                          <p className="text-sm font-bold text-white group-hover:text-accent transition-colors">{director.name}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4">
                  {movie.credits.cast.slice(0, 6).map((person: any) => (
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

              {collectionItems.length > 1 && (
                <FranchiseRow
                  title={movie.belongs_to_collection?.name || 'Related Movies'}
                  icon={<Layers size={20} className="text-accent" />}
                  items={collectionItems}
                  currentId={movie.id}
                />
              )}

              {/* Reviews Section */}
              <TitleDiscussion
                mediaType="movie"
                mediaId={movie.id}
                title={movie.title}
                posterPath={movie.poster_path}
                reviews={movie.reviews.results}
              />
            </div>
          </div>

          {/* Right Column: Recommendations & Ads */}
          <div className="space-y-8 flex flex-col">
            <h3 className="text-xl font-bold text-white tracking-tight pt-4">You might also like</h3>
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-6">
              {movie.recommendations.results.slice(0, 4).map((rec: any) => (
                <MovieCard 
                  key={rec.id}
                  id={rec.id}
                  title={rec.title}
                  posterPath={rec.poster_path}
                  rating={rec.vote_average}
                  date={(rec.release_date || '').split('-')[0]}
                  type="movie"
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
