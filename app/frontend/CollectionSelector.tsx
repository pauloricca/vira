import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { folderName } from './FolderSettings';

export function CollectionSelector({ collections, value, select, label = 'Music collection', menuLabel = 'Music collections', optionLabel = folderName }: {
  collections: string[]; value: string; select: (path: string) => void; label?: string; menuLabel?: string; optionLabel?: (value: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const container = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const typed = useRef({ text: '', time: 0 });
  useEffect(() => { setOpen(false); }, [value, collections.join('\n')]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div className="collection-dropdown" ref={container} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && !menu.current?.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' && open) { setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} className="key-trigger collection-trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open}
      disabled={!collections.length} title={value || 'Add a music folder in Settings'} onClick={() => {
        const rect = trigger.current!.getBoundingClientRect();
        setAnchor({ top: rect.bottom + 7, left: Math.max(8, Math.min(rect.left, window.innerWidth - 273)) });
        typed.current = { text: '', time: 0 };
        setOpen(!open);
      }}><span className="collection-name">{value ? optionLabel(value) : 'No collections'}</span><span aria-hidden="true"> ▾</span></button>
    {open && createPortal(<div ref={menu} className="key-menu collection-menu" style={{ top: anchor.top, left: anchor.left, maxHeight: `calc(100dvh - ${anchor.top + 8}px)` }} role="menu" aria-label={menuLabel} onKeyDown={event => {
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
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
      {collections.map(path => <button key={path} role="menuitemradio" aria-checked={path === value} className="key-option" title={path} data-name={optionLabel(path)}
        onClick={() => { select(path); setOpen(false); trigger.current?.focus(); }}>
        <span className="collection-name">{optionLabel(path)}</span><span className="key-selected" aria-hidden="true">{path === value ? '✓' : ''}</span>
      </button>)}
    </div>, document.body)}
  </div>;
}
