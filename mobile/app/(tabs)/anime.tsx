import React from 'react';
import BrowseScreen from '@/components/BrowseScreen';

// Japanese animation, series first (src/app/anime/page.tsx). Genre picks
// combine with Animation (16) rather than replacing it.
export default function AnimeScreen() {
  return (
    <BrowseScreen
      title="Anime"
      subtitle="Masterpieces of Japanese Animation"
      mediaType="tv"
      baseFilters={{ with_genres: '16', with_original_language: 'ja' }}
    />
  );
}
