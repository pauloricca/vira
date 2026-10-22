import { useEffect, useSyncExternalStore, type ReactNode } from 'react';

const KEY = 'vira.pinned-components';
const EVENT = 'vira-pins-changed';
let cached = '', snapshot: string[] = [];
function read() {
  const raw = localStorage.getItem(KEY) ?? '[]';
  if (raw !== cached) {
    cached = raw;
    try { const value: unknown = JSON.parse(raw); snapshot = Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : []; }
    catch { snapshot = []; }
  }
  return snapshot;
}
function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener); window.addEventListener('storage', listener);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', listener); };
}
export const usePins = () => useSyncExternalStore(subscribe, read);
export function savePins(ids: string[]) {
  localStorage.setItem(KEY, JSON.stringify(ids)); window.dispatchEvent(new Event(EVENT));
}
export function PinButton({ id, name, text = false, disabled = false }: { id: string; name: string; text?: boolean; disabled?: boolean }) {
  const pins = usePins(), pinned = pins.includes(id);
  return <button className={text ? 'pin-instrument' : 'node-pin'} aria-label={text ? 'Pin instrument' : `Pin ${name}`} aria-pressed={pinned} title={pinned ? `Unpin ${name}` : `Pin ${name}`} disabled={disabled}
    onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); savePins(pinned ? pins.filter(value => value !== id) : [...pins, id]); }}>
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><g transform="rotate(45 12 12)" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3H8v6l-3 3v2h14v-2l-3-3V3Z" fill={pinned ? 'currentColor' : 'none'} /><path d="M12 14v8" fill="none" /></g></svg>{text && 'Pin instrument'}
  </button>;
}

type Source = { name: string; controls: ReactNode };
const sources = new Map<string, Map<symbol, Source>>();
const listeners = new Set<() => void>();
let version = 0;
function changed() { version++; listeners.forEach(listener => listener()); }
export function usePinnedSources() {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => version);
  return new Map([...sources].map(([id, owners]) => [id, [...owners.values()][0]]));
}
// Publish the same controls and edit callbacks used by the canvas. Sources stay
// mounted when their workspace is hidden, including after restoring saved pins.
export function PinnedSource({ id, name, children, controls = children, show = true }: { id: string; name: string; children: ReactNode; controls?: ReactNode; show?: boolean }) {
  useEffect(() => {
    const owner = Symbol();
    const owners = sources.get(id) ?? new Map<symbol, Source>();
    owners.set(owner, { name, controls }); sources.set(id, owners); changed();
    return () => { owners.delete(owner); if (!owners.size) sources.delete(id); changed(); };
  }, [id, name, controls]);
  return show ? children : null;
}
export const instrumentPin = (id: string) => `instrument:${id.replace(/^instrument-/, '')}`;
export const patchPin = (name: string) => `patch:${name}`;
