import { NextResponse } from 'next/server';
import { fetchFromTMDB } from '@/lib/tmdb';

// What the movie map's panel shows beyond its own data: the overview,
// runtime and director of one film.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  try {
    const movie = await fetchFromTMDB(`/movie/${id}`, { append_to_response: 'credits' });
    return NextResponse.json({
      overview: movie.overview ?? '',
      tagline: movie.tagline ?? '',
      runtime: movie.runtime ?? 0,
      directors: (movie.credits?.crew ?? [])
        .filter((p: { job: string }) => p.job === 'Director')
        .map((p: { name: string }) => p.name),
    });
  } catch (error) {
    console.error('Movie brief API error:', error);
    return NextResponse.json({ error: 'Not available' }, { status: 502 });
  }
}
