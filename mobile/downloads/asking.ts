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
