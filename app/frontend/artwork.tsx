import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

const artwork = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

function load(trackId: string) {
  const existing = pending.get(trackId);
  if (existing) return existing;
  const request = (async () => {
    try {
      const value = await invoke<string | null>('get_track_artwork', { trackId });
      const result = typeof value === 'string' && value.startsWith('data:image/') ? value : null;
      artwork.set(trackId, result);
      return result;
    } catch {
      artwork.set(trackId, null);
      return null;
    } finally {
      pending.delete(trackId);
    }
  })();
  pending.set(trackId, request);
  return request;
}

export function useArtwork(trackId: string | null | undefined, available = true) {
  const [source, setSource] = useState<string | null>(() => trackId ? artwork.get(trackId) ?? null : null);
  useEffect(() => {
    let active = true;
    if (!trackId || !available) { setSource(null); return () => { active = false; }; }
    if (artwork.has(trackId)) { setSource(artwork.get(trackId) ?? null); return () => { active = false; }; }
    void load(trackId).then(value => { if (active) setSource(value); });
    return () => { active = false; };
  }, [trackId, available]);
  return source;
}

export function TrackArtwork({ trackId, available = true, className, fallback = null, alt = '' }: { trackId: string; available?: boolean; className: string; fallback?: React.ReactNode; alt?: string }) {
  const source = useArtwork(trackId, available);
  return source ? <img className={className} src={source} alt={alt} /> : <span className={className} aria-hidden={alt ? undefined : true}>{fallback}</span>;
}
