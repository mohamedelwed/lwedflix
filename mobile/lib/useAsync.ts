import { useCallback, useEffect, useRef, useState } from 'react';

// Data for a screen: loads once per key, cached for the session so going
// back to a screen is instant (TMDB data changes hourly at most).
const cache = new Map<string, { at: number; value: unknown }>();
const TTL_MS = 30 * 60 * 1000;

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
}

export function useAsync<T>(key: string | null, load: () => Promise<T>): AsyncState<T> {
  const cached = key ? (cache.get(key) as { at: number; value: T } | undefined) : undefined;
  const fresh = cached && Date.now() - cached.at < TTL_MS ? cached.value : undefined;
  const [data, setData] = useState<T | undefined>(fresh);
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(fresh === undefined && key !== null);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (key === null) return;
    const hit = cache.get(key) as { at: number; value: T } | undefined;
    if (nonce === 0 && hit && Date.now() - hit.at < TTL_MS) {
      setData(hit.value);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setError(undefined);
    loadRef.current().then(
      (value) => {
        cache.set(key, { at: Date.now(), value });
        if (live) {
          setData(value);
          setLoading(false);
        }
      },
      (err: unknown) => {
        if (live) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      }
    );
    return () => {
      live = false;
    };
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
