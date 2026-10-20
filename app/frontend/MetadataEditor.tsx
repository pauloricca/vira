import { useEffect, useRef, useState } from 'react';
import type { Track } from './App';
import { metadataKey, camelotKey, keyRoots, shiftedKey } from './harmonic';

export type MetadataEdits = { title: string; artist: string; key?: string };
const keys = keyRoots.flatMap(root => ['major', 'minor'].map(mode => `${root} ${mode}`));

export function MetadataEditor({ track, save, close }: {
  track: Track; save: (edits: MetadataEdits) => Promise<void>; close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const originalKey = metadataKey(track) ?? '';
  const initialKey = shiftedKey(originalKey) ?? originalKey;
  const [key, setKey] = useState(initialKey);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    const previous = active?.closest('details')?.querySelector('summary') ?? active;
    dialog.current?.showModal();
    return () => { previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="patch-confirmation metadata-editor" aria-labelledby="metadata-title"
    onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); if (!saving) close(); }}>
    <form onSubmit={event => {
      event.preventDefault();
      if (saving) return;
      setSaving(true); setError('');
      const edits: MetadataEdits = { title: title.trim(), artist: artist.trim() };
      if (key !== initialKey) edits.key = key;
      void save(edits).then(close).catch(reason => { setError(String(reason)); setSaving(false); });
    }}>
      <h3 id="metadata-title">Edit metadata</h3>
      <p className="metadata-filename">{track.filename}</p>
      <fieldset disabled={saving}>
        <label>Title<input autoFocus required maxLength={300} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label>Artist<input maxLength={300} value={artist} onChange={event => setArtist(event.target.value)} /></label>
        <label>Key<select value={key} onChange={event => setKey(event.target.value)}>
          <option value="">Unknown</option>
          {initialKey && !keys.includes(initialKey) && <option value={initialKey}>{initialKey}</option>}
          {keys.map(value => { const wheel = camelotKey(value)!; return <option key={value} value={value}>{value} · {wheel.number}{wheel.letter}</option>; })}
        </select></label>
      </fieldset>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="confirmation-actions"><button type="button" disabled={saving} onClick={close}>Cancel</button><button type="submit" disabled={saving || !title.trim()}>{saving ? 'Saving…' : 'Save changes'}</button></div>
    </form>
  </dialog>;
}
