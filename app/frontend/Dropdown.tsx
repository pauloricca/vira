import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

export function useOutsideDismiss(open: boolean, close: () => void, ...regions: RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!regions.some(region => region.current?.contains(event.target as Node))) close();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, close, ...regions]);
}

export function TrackActions({ title, children }: { title: string; children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => { if (details.current) details.current.open = false; setOpen(false); };
  useOutsideDismiss(open, close, details);
  return <details ref={details} className="row-actions" onToggle={event => setOpen(event.currentTarget.open)}
    onClick={event => { if (event.target instanceof HTMLButtonElement) close(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape' && details.current?.open) {
        event.preventDefault(); close(); details.current.querySelector('summary')?.focus();
      }
    }}>
    <summary aria-label={`Actions for ${title}`}>•••</summary>{children}
  </details>;
}
