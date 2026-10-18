import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { keyChoices, shiftedKey } from './harmonic';
import { useOutsideDismiss } from './Dropdown';

export function KeySelector({ deck, generation, original, other, semitones, disabled, select }: {
  deck: number; generation: number; original?: string | null; other?: string | null;
  semitones: number; disabled: boolean; select: (semitones: number) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const choices = keyChoices(original, other);
  const current = shiftedKey(original, semitones);
  const name = deck === 0 ? 'A' : 'B';
  useEffect(() => { setOpen(false); }, [generation, original, disabled]);
  useOutsideDismiss(open, () => setOpen(false), container, menu);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [open]);
  return <div className="deck-key" ref={container} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && !menu.current?.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (open || event.key === ' ' || event.key === 'Enter') event.stopPropagation();
    if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} className="key-trigger" aria-label={`Key deck ${name}: ${current ?? original ?? 'unknown'}${semitones ? ', shifted' : ''}`}
      aria-haspopup="menu" aria-expanded={open} disabled={disabled || !current}
      title={current ? `Original: ${original}${semitones ? ` · ${semitones > 0 ? '+' : ''}${semitones} semitones` : ''}` : 'Analyse this track to select a key'}
      onClick={() => { const rect = trigger.current!.getBoundingClientRect(); setAnchor({ top: rect.bottom + 7, left: Math.max(8, Math.min(rect.right - 265, window.innerWidth - 273)) }); setOpen(!open); }}>{current ?? original ?? '—'}{semitones !== 0 ? '*' : ''}<span aria-hidden="true"> ▾</span></button>
    <small>KEY</small>
    {open && createPortal(<div ref={menu} className={`key-menu deck-${deck}`} style={{ top: anchor.top, left: anchor.left, maxHeight: `calc(100dvh - ${anchor.top + 8}px)` }} role="menu" aria-label={`Keys deck ${name}`} onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }}>
      {choices.map(choice => <button key={choice.key} role="menuitemradio" aria-checked={choice.semitones === semitones}
        className={`key-option${choice.original ? ' original-key' : ''}${choice.recommended ? ' recommended-key' : ''}`}
        onClick={() => { void select(choice.semitones); setOpen(false); trigger.current?.focus(); }}>
        <span>{choice.key}</span><span className="key-markers">
          {choice.original && <span className="key-original-marker">Original</span>}
          {choice.recommended && <span className="key-match-marker">Best match</span>}
          <span className="key-selected" aria-hidden="true">{choice.semitones === semitones ? '✓' : ''}</span>
        </span>
      </button>)}
    </div>, document.body)}
  </div>;
}
