import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TRACK_MIME } from './Decks';
import type { Track } from './App';

export const TRACKS_MIME = 'application/x-vira-tracks';
export type Tag = { name: string; tracks: string[] };
export function useTags() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  async function load() {
    setLoading(true);
    try { setTags(await invoke<Tag[]>('get_tags')); setError(null); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function update(action: 'create' | 'delete' | 'assign' | 'unassign', name: string, trackId?: string | string[]) {
    if (saving.current || loading) return false;
    saving.current = true;
    setPending(true);
    try {
      const next = Array.isArray(trackId)
        ? await invoke<Tag[]>('update_tag_tracks', { action, name, trackIds: trackId })
        : await invoke<Tag[]>('update_tag', { action, name, trackId: trackId ?? null });
      setTags(next);
      setSelected(previous => previous.filter(name => next.some(tag => tag.name === name)));
      setError(null);
      return true;
    } catch (e) { setError(String(e)); return false; }
    finally { saving.current = false; setPending(false); }
  }
  return { tags, selected, setSelected, error, loading, pending, update, load };
}
export type TagsState = ReturnType<typeof useTags>;

function TagCheckbox({ tag, ids, disabled, update }: { tag: Tag; ids: string[]; disabled: boolean; update: TagsState['update'] }) {
  const count = ids.filter(id => tag.tracks.includes(id)).length;
  const mixed = count > 0 && count < ids.length;
  const all = ids.length > 0 && count === ids.length;
  return <label className="tag-select tag-checkbox-label" title={tag.name}>
    <input type="checkbox" aria-label={tag.name} aria-checked={mixed ? 'mixed' : all} checked={count > 0}
      ref={element => { if (element) element.indeterminate = mixed; }}
      disabled={disabled || !ids.length} onChange={() => void update(all ? 'unassign' : 'assign', tag.name, ids)} />
    <span className={`tag-checkbox-mark${mixed ? ' mixed' : ''}`} aria-hidden="true">{count > 0 ? '✓' : ''}</span>
    <span className="tag-name">{tag.name}</span>
  </label>;
}

export function TagsSidebar({ state, tracks, tagging = false, selectedIds = [] }: { state: TagsState; tracks: Track[]; tagging?: boolean; selectedIds?: string[] }) {
  const { tags, selected, setSelected, update, pending, loading, error } = state;
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const confirmation = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (removing !== null) confirmation.current?.showModal(); }, [removing]);
  return <aside className="tags-sidebar" aria-label="Track tags" onKeyDown={event => event.stopPropagation()}>
    <div className="tags-heading"><h3>Tags</h3><span>{tags.length}</span></div>
    {!tagging && <button className="tag-all" aria-pressed={selected.length === 0} onClick={() => setSelected([])}>All <span>{tracks.length}</span></button>}
    <div className="tag-list">{tags.map(tag => <div key={tag.name} className={`tag-row${!tagging && selected.includes(tag.name) ? ' selected' : ''}${over === tag.name ? ' tag-drop-target' : ''}`}
      onDragOver={event => {
        if (pending || loading || !event.dataTransfer.types.includes(TRACK_MIME) && !event.dataTransfer.types.includes(TRACKS_MIME)) return;
        event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setOver(tag.name);
      }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null); }}
      onDrop={event => {
        event.preventDefault(); setOver(null);
        let ids: unknown;
        const multiple = event.dataTransfer.getData(TRACKS_MIME);
        try { ids = multiple ? JSON.parse(multiple) : [event.dataTransfer.getData(TRACK_MIME)]; } catch { return; }
        if (!Array.isArray(ids)) return;
        const valid = [...new Set(ids.filter((id): id is string => typeof id === 'string' && tracks.some(track => track.id === id)))];
        if (valid.length && !pending && !loading) void update('assign', tag.name, valid);
      }}>
      {tagging ? <TagCheckbox tag={tag} ids={selectedIds} disabled={loading || pending} update={update} /> : <button className="tag-select" aria-pressed={selected.includes(tag.name)} title={tag.name} onClick={() => setSelected(previous => previous.includes(tag.name) ? previous.filter(name => name !== tag.name) : [...previous, tag.name])}>
        <span className="tag-marker" aria-hidden="true">#</span><span className="tag-name">{tag.name}</span><span className="tag-count">{tracks.filter(track => tag.tracks.includes(track.id)).length}</span>
      </button>}<button className="tag-remove" aria-label={`Delete tag ${tag.name}`} title={`Delete tag ${tag.name}`} disabled={pending} onClick={() => setRemoving(tag.name)}>×</button>
    </div>)}</div>
    <form className="tag-create" onSubmit={event => { event.preventDefault(); void update('create', name.trim()).then(ok => { if (ok) { setName(''); input.current?.focus(); } }); }}>
      <input ref={input} aria-label="New tag name" placeholder="New tag…" maxLength={80} value={name} onChange={event => setName(event.target.value)} disabled={loading || pending} />
      <button aria-label="Add tag" title="Add tag" disabled={loading || pending || !name.trim()}>+</button>
    </form>
    {loading && <p className="tags-hint">Loading tags…</p>}
    {error && <div className="tags-error" role="alert">{error}<button disabled={loading || pending} onClick={() => void state.load()}>Reload tags</button></div>}
    {removing !== null && <dialog ref={confirmation} className="patch-confirmation tag-confirmation" aria-labelledby="remove-tag-title" onCancel={event => { event.preventDefault(); if (!pending) setRemoving(null); }}>
      <h3 id="remove-tag-title">Delete tag “{removing}”?</h3><p>This removes the tag from all tracks. Your songs stay in the library and on disk.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="confirmation-actions"><button disabled={pending} onClick={() => setRemoving(null)}>Cancel</button><button disabled={pending} onClick={() => void update('delete', removing).then(ok => { if (ok) setRemoving(null); })}>{pending ? 'Deleting…' : 'Delete tag'}</button></div>
    </dialog>}
  </aside>;
}

export function TrackTags({ state, track }: { state: TagsState; track: Track }) {
  return <fieldset className="track-tags" onKeyDown={event => event.stopPropagation()}><legend>Tags</legend>{state.tags.length ? state.tags.map(tag => <label key={tag.name}><input type="checkbox" checked={tag.tracks.includes(track.id)} disabled={state.loading || state.pending} onChange={event => void state.update(event.target.checked ? 'assign' : 'unassign', tag.name, track.id)} />{tag.name}</label>) : null}</fieldset>;
}
