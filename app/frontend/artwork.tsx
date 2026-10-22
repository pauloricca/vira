import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArtworkCache } from './artworkCache';
import { waitForDeckLoads } from './loadPriority';

const artwork = new ArtworkCache();
const pending = new Map<string, Promise<string | null>>();
const waiting: (() => void)[] = [];
let activeRequests = 0;

async function acquire() {
  await waitForDeckLoads();
  if (activeRequests < 4) { activeRequests++; return; }
  await new Promise<void>(resolve => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else activeRequests--;
}

function load(trackId: string) {
  const existing = pending.get(trackId);
  if (existing) return existing;
  const request = (async () => {
    await acquire();
    try {
      await waitForDeckLoads();
      const value = await invoke<string | null>('get_track_artwork', { trackId });
      await waitForDeckLoads();
      const result = typeof value === 'string' && value.startsWith('data:image/') ? value : null;
      artwork.set(trackId, result);
      return result;
    } catch {
      artwork.set(trackId, null);
      return null;
    } finally {
      release();
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
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  useEffect(() => {
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') { setNearViewport(true); return; }
    const observer = new IntersectionObserver(entries => {
      setNearViewport(entries.some(entry => entry.isIntersecting));
    }, { rootMargin: '200px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  const source = useArtwork(trackId, available && nearViewport);
  return source ? <img ref={setElement} className={className} src={source} alt={alt} /> : <span ref={setElement} className={className} aria-hidden={alt ? undefined : true}>{fallback}</span>;
}
