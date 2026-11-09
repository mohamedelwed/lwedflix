import React from 'react';
import MovieMap from '@/components/movieMap/MovieMap';

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // /map?film=550 opens the map on that film (the movie page links here).
  const { film } = await searchParams;
  const id = typeof film === 'string' && /^\d+$/.test(film) ? Number(film) : null;
  return <MovieMap initialFilmId={id} />;
}
