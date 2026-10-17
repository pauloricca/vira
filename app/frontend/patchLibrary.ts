import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Patch } from '@pauloricca/teia-hosted';
import { gainPatch, prepare, type TeiaState } from './teiaModel';
export type PatchEntry = { slot: number; state: TeiaState };
export const emptyPatch = (name: string): Patch => ({ name, nodes: [
  { id: 'input', type: 'AudioInput', params: { gain: 1, level: 1 }, position: { x: 80, y: 160 } },
  { id: 'output', type: 'AudioOut', params: { level: 1 }, position: { x: 480, y: 160 } },
], links: [
  { from: { node: 'input', port: 'left' }, to: { node: 'output', port: 'left' } },
  { from: { node: 'input', port: 'right' }, to: { node: 'output', port: 'right' } },
] });
// An unconnected AudioOut is an editable draft, not an executable Teia graph.
// Keep that document intact and run silence until its first valid editor apply.
export function preparePatchInstance(document: Patch) {
  if (document.links.length === 0 && document.nodes.length === 2 && document.nodes.some(n => n.type === 'AudioInput') && document.nodes.some(n => n.type === 'AudioOut')) {
    const silent = { ...gainPatch, nodes: gainPatch.nodes.filter(n => n.type !== 'Params').map(n => n.type === 'AudioInput' ? { ...n, params: { ...n.params, gain: 0 } } : n), links: gainPatch.links.filter(l => l.from.node !== 'parameters') };
    const prepared = prepare(silent);
    return { prepared, draft: true };
  }
  return { prepared: prepare(document), draft: false };
}

// All three surfaces register the same session instance, so Decks and both
// canvases refer to the same running instrument and parameter state.
export async function addSessionPatch(file?: string): Promise<PatchEntry> {
  let name = file;
  if (!name) {
    const library = await invoke<{files:string[]}>('teia_library');
    let index = 1;
    while (library.files.includes(`New patch${index === 1 ? '' : ` ${index}`}.json`)) index++;
    name = `New patch${index === 1 ? '' : ` ${index}`}.json`;
    await invoke('teia_import', {name, document: emptyPatch(name.replace(/\.json$/, ''))});
  }
  const entries = await invoke<PatchEntry[]>('patches_state');
  let entry = entries?.find(e => e.state.record?.name === name);
  if (!entry) {
    const source = await invoke<{document:Patch; hash:string}>('teia_read', {name});
    const {prepared, draft} = preparePatchInstance(source.document);
    entry = await invoke<PatchEntry>('patches_add', {name, savedHash:source.hash, document:prepared.document, prepared, draft});
  }
  window.dispatchEvent(new Event('patches-changed'));
  if (!file) await invoke('teia_open_editor', {slot:entry.slot});
  return entry;
}
export function usePatchLibrary(active: boolean) {
  const [files, setFiles] = useState<string[]>([]);
  const [entries, setEntries] = useState<PatchEntry[]>([]);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const refresh = async () => {
      const result = await Promise.allSettled([invoke<{files:string[]}>('teia_library'), invoke<PatchEntry[]>('patches_state')]);
      if (stopped) return;
      if (result[0].status === 'fulfilled' && result[0].value) setFiles(result[0].value.files ?? []);
      if (result[1].status === 'fulfilled' && result[1].value) setEntries(result[1].value);
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 1500);
    window.addEventListener('patches-changed', refresh);
    return () => {stopped = true; clearInterval(timer); window.removeEventListener('patches-changed', refresh);};
  }, [active]);
  return {files, entries};
}

export function patchAudioInputs(document: unknown, prefix = ''): {id:string;label:string}[] {
  const graph = document as {nodes?: {id:string;type:string;customLabel?:string;subpatch?:unknown}[]};
  return (graph?.nodes ?? []).flatMap(node => node.type === 'Group' ? patchAudioInputs(node.subpatch, `${prefix}${node.id}__`) : node.type === 'AudioInput' ? [{id:`${prefix}${node.id}`,label:node.customLabel ?? `${prefix}${node.id}`}] : []).sort((a,b) => a.id.localeCompare(b.id));
}
