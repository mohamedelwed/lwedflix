// How a download asks a server for a stream: free of Expo, so tests run it.

/**
 * Other ways to ask, tried in turn when a server refuses: servers differ on
 * what they check (the page's origin, the bare site as Referer, none).
 */
export function headerVariants(base: Record<string, string>): Record<string, string>[] {
  const variants = [base];
  try {
    const origin = new URL(base.Referer).origin;
    variants.push({ ...base, Origin: origin }, { ...base, Referer: `${origin}/` }, { ...base, Referer: `${origin}/`, Origin: origin });
  } catch {
    // No page to vary.
  }
  const { Referer: _referer, ...bare } = base;
  variants.push(bare);
  return variants;
}

/**
 * A piece's address with the playlist's query carried over: some players
 * add the playlist's access token (`?token=…`) to every piece they load,
 * and their servers refuse the bare address the playlist lists. Only what
 * the piece lacks is added; null when there's nothing to add.
 */
export function withPlaylistQuery(url: string, playlistUrl: string): string | null {
  try {
    const piece = new URL(url);
    const from = new URL(playlistUrl);
    let added = false;
    from.searchParams.forEach((value, key) => {
      if (!piece.searchParams.has(key)) {
        piece.searchParams.append(key, value);
        added = true;
      }
    });
    return added ? piece.toString() : null;
  } catch {
    return null;
  }
}
