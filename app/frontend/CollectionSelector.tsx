import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { folderName } from './FolderSettings';
import { useOutsideDismiss } from './Dropdown';

export function CollectionSelector({ collections, value, select, label = 'Music collection', menuLabel = 'Music collections', optionLabel = folderName, values, selectMany, loading = false }: {
  collections: string[]; value: string; select: (path: string) => void; label?: string; menuLabel?: string; optionLabel?: (value: string) => string; values?: string[]; selectMany?: (paths: string[]) => void; loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const container = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const typed = useRef({ text: '', time: 0 });
  useEffect(() => { setOpen(false); }, [values ? '' : value, collections.join('\n')]);
  useOutsideDismiss(open, () => setOpen(false), container, menu);
  useEffect(() => {
    if (!open) return;
    (menu.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.current?.querySelector<HTMLElement>('[data-name]'))?.focus();
  }, [open]);
  return <div className="collection-dropdown" ref={container} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && !menu.current?.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' && open) { setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} className="key-trigger collection-trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open}
      disabled={loading || !collections.length} title={loading ? 'Loading collections…' : values?.join('\n') || value || 'Add a music folder in Settings'} onClick={() => {
        const rect = trigger.current!.getBoundingClientRect();
        setAnchor({ top: rect.bottom + 7, left: Math.max(8, Math.min(rect.left, window.innerWidth - 273)) });
        typed.current = { text: '', time: 0 };
        setOpen(!open);
      }}><span className="collection-name">{loading ? 'Loading…' : values && values.length !== 1 ? `${values.length} categories` : value ? optionLabel(value) : 'No collections'}</span><span aria-hidden="true"> ▾</span></button>
    {open && createPortal(<div ref={menu} className="key-menu collection-menu" style={{ top: anchor.top, left: anchor.left, maxHeight: `calc(100dvh - ${anchor.top + 8}px)` }} role="menu" aria-label={menuLabel} onKeyDown={event => {
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-name]'));
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      } else if (event.key.length === 1 && event.key !== ' ' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        const now = Date.now();
        typed.current = { text: (now - typed.current.time < 700 ? typed.current.text : '') + event.key.toLowerCase(), time: now };
        items.find(item => item.dataset.name?.toLowerCase().startsWith(typed.current.text))?.focus();
      }
    }}>
      {collections.map(path => <div key={path} className={values ? 'collection-option-row' : undefined}>
        {values && <input type="checkbox" role="menuitemcheckbox" aria-label={optionLabel(path)} aria-checked={values.includes(path)} checked={values.includes(path)} data-name={optionLabel(path)} onChange={() => selectMany?.(values.includes(path) ? values.filter(value => value !== path) : [...values, path])} />}
        <button key={path} role={values ? 'menuitem' : 'menuitemradio'} aria-checked={values ? undefined : path === value} className="key-option" title={path} data-name={optionLabel(path)}
        onClick={() => { select(path); setOpen(false); trigger.current?.focus(); }}>
        <span className="collection-name">{optionLabel(path)}</span><span className="key-selected" aria-hidden="true">{!values && path === value ? '✓' : ''}</span>
      </button></div>)}
    </div>, document.body)}
  </div>;
}
