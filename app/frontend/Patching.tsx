import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, HTMLAttributes, PointerEventHandler, ReactNode } from 'react';
import './patching.css';

// Geometry and CSS consume the same node dimensions in both patching workspaces.
export const PATCH_NODE_WIDTH = 145;
export const patchPortTop = (row: number) => 44 + row * 26;
export const patchPortPoint = (node: { x: number; y: number }, row: number, output: boolean) => ({ x: node.x + (output ? PATCH_NODE_WIDTH : 0), y: node.y + patchPortTop(row) + 12 });

export function PatchingPage({ className = '', style, hidden, ...props }: HTMLAttributes<HTMLElement>) {
  return <section {...props} hidden={hidden} className={`routing-page ${className}`} style={{ ...style, '--patch-node-width': `${PATCH_NODE_WIDTH}px`, ...(hidden ? { display: 'none' } : {}) } as CSSProperties} />;
}

export function PatchingHeading({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="routing-heading"><div><h2>{title}</h2><p>{description}</p></div><div className="routing-actions">{children}</div></div>;
}

export function PatchingNodeHeader({ title, subtitle, onPointerDown, onRename, nameLabel, disabled }: { title: string; subtitle: string; onPointerDown: PointerEventHandler<HTMLDivElement>; onRename?: (name: string) => void; nameLabel?: string; disabled?: boolean }) {
  return <div className="routing-node-title" onPointerDown={onPointerDown}>{onRename ? <EditableNodeName title={title} onRename={onRename} nameLabel={nameLabel} disabled={disabled} /> : <span className="routing-node-name" title={title}>{title}</span>}<small title={subtitle}>{subtitle}</small></div>;
}

function EditableNodeName({ title, onRename, nameLabel, disabled }: { title: string; onRename: (name: string) => void; nameLabel?: string; disabled?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return <input className="routing-node-name routing-node-name-input" aria-label={nameLabel ?? 'Node name'} title={`${title} · Click to rename`} value={draft ?? title} maxLength={80} disabled={disabled}
    onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onFocus={() => { cancelled.current = false; setDraft(title); }} onChange={event => setDraft(event.target.value)}
    onBlur={() => { const name = draft?.trim(); if (!cancelled.current && name && name !== title) onRename(name); setDraft(null); }}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); cancelled.current = event.key === 'Escape'; event.currentTarget.blur(); } }} />;
}

export type PaletteItem = { id: string; label: string };
export type PaletteCategory = { label: string; items: PaletteItem[]; footer?: ReactNode };
export type PatchPoint = { x: number; y: number };
const NODE_MIME = 'application/x-vira-node';
export function NodePalette({ categories, actions, onAdd, disabled }: { categories: PaletteCategory[]; actions: ReactNode; onAdd: (id: string, point?: PatchPoint) => void; disabled?: boolean }) {
  const gesture = useRef<{id:string; label:string; pointer:number; x:number; y:number; moved:boolean} | null>(null);
  const [preview, setPreview] = useState<{label:string; x:number; y:number} | null>(null);
  const cancel = () => {gesture.current = null; setPreview(null);};
  useEffect(() => {window.addEventListener('blur',cancel); const key = (event:KeyboardEvent) => {if (event.key === 'Escape') cancel();}; window.addEventListener('keydown',key); return () => {window.removeEventListener('blur',cancel); window.removeEventListener('keydown',key);};}, []);
  return <aside className="patching-palette" aria-label="Node palette">{actions && <div className="patching-palette-actions">{actions}</div>}{categories.map(category => <section key={category.label}><h3>{category.label}</h3>{category.items.map(item => <button key={item.id} draggable={false} disabled={disabled} title="Drag onto canvas or double-click to add" onDoubleClick={() => onAdd(item.id)}
    onPointerDown={event => {if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); gesture.current = {id:item.id,label:item.label,pointer:event.pointerId,x:event.clientX,y:event.clientY,moved:false};}}
    onPointerMove={event => {const drag = gesture.current; if (!drag || drag.pointer !== event.pointerId) return; if (Math.hypot(event.clientX-drag.x,event.clientY-drag.y) > 6) drag.moved = true; if (drag.moved) setPreview({label:drag.label,x:event.clientX,y:event.clientY});}}
    onPointerUp={event => {const drag = gesture.current; if (!drag || drag.pointer !== event.pointerId) return; const page = event.currentTarget.closest('.routing-page'); const target = document.elementFromPoint(event.clientX,event.clientY)?.closest('.routing-scroll'); const canvas = page?.querySelector<HTMLElement>('.routing-canvas'); if (drag.moved && !disabled && target && page?.contains(target) && canvas) onAdd(drag.id,nodePlacement(canvas,canvas.offsetWidth,1,event)); cancel(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);}}
    onPointerCancel={cancel} onLostPointerCapture={cancel}
    onDragStart={event => {event.dataTransfer.setData(NODE_MIME,item.id); event.dataTransfer.effectAllowed = 'copy';}}>{item.label}</button>)}{!category.items.length && <small>None available</small>}{category.footer && <div className="patching-palette-actions">{category.footer}</div>}</section>)}{preview && <div className="patching-drag-preview" style={{left:preview.x+12,top:preview.y+12}}>{preview.label}</div>}</aside>;
}
export function nodePlacement(canvas: HTMLElement, width: number, zoom: number, event?: {clientX:number;clientY:number}): PatchPoint {
  const rect = canvas.getBoundingClientRect(), viewport = canvas.closest('.routing-scroll')!.getBoundingClientRect();
  const scale = rect.width > 0 ? rect.width / width : zoom;
  return {x: Math.max(10, Math.min(Math.min(1500, width - 160), ((event?.clientX ?? (viewport.left + viewport.width / 2)) - rect.left) / scale - (event ? 0 : PATCH_NODE_WIDTH / 2))), y: Math.max(10, Math.min(900, ((event?.clientY ?? (viewport.top + viewport.height / 2)) - rect.top) / scale - (event ? 0 : 60)))};
}
export function paletteDrop(event: import('react').DragEvent, add: (id:string, point:PatchPoint) => void, canvas: HTMLElement, width:number, zoom:number) {
  const id = event.dataTransfer.getData(NODE_MIME);
  if (!id) return;
  event.preventDefault(); add(id, nodePlacement(canvas, width, zoom, event));
}
export const paletteDragOver = (event: import('react').DragEvent) => { if (Array.from(event.dataTransfer.types).includes(NODE_MIME)) {event.preventDefault(); event.dataTransfer.dropEffect = 'copy';} };
export function withoutPatchNode<N extends {id:string}, W extends {from:string;to:string}>(graph: {nodes:N[];wires:W[]}, id:string) { return {nodes:graph.nodes.filter(n => n.id !== id), wires:graph.wires.filter(w => w.from !== id && w.to !== id)}; }

export function usePatchingKeys(active: boolean, actions: {cancel:()=>void; remove:()=>void; undo:()=>void; redo:()=>void; finish?:()=>void}, disabled = false) {
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]),select,textarea,[contenteditable=true],dialog')) return;
      if (event.key === 'Escape') {event.preventDefault(); actions.cancel();}
      else if (!disabled && !event.metaKey && !event.ctrlKey && !event.altKey && ['Delete','Backspace'].includes(event.key)) {event.preventDefault(); actions.remove();}
      else if (!disabled && event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'z') {event.preventDefault(); if (event.shiftKey) actions.redo(); else actions.undo();}
    };
    window.addEventListener('keydown', key); window.addEventListener('blur', actions.cancel);
    if (actions.finish) window.addEventListener('pointerup', actions.finish);
    return () => {window.removeEventListener('keydown', key); window.removeEventListener('blur', actions.cancel); if (actions.finish) window.removeEventListener('pointerup', actions.finish);};
  }, [active, disabled, actions.cancel, actions.remove, actions.undo, actions.redo, actions.finish]);
}
