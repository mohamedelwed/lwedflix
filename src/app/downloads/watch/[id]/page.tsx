import React from 'react';
import OfflinePlayer from '@/components/downloads/OfflinePlayer';

export default async function WatchDownloadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OfflinePlayer id={id} />;
}
