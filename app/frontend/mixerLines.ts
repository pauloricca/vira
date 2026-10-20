import { snapPatchGraph, snapPatch, type PatchPoint } from './Patching';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Graph, RoutingNode } from './Routing';

export const lineColours = ['#71b9ed', '#efab69', '#bc91ee', '#8ecc91', '#6cd9dc', '#e4d477', '#ef8189'];
export const lineName = (line: number) => String.fromCharCode(65 + line);
export const lineStages = ['trim', 'eq', 'filter', 'fader', 'cue_switch'] as const;
export function mixerLine(node: RoutingNode): number | null {
  if (!lineStages.includes(node.kind as typeof lineStages[number])) return null;
  if (node.deck !== null) return node.deck;
  const match = /^line-([2-6])-/.exec(node.id);
  return match ? Number(match[1]) : null;
}
export const lineId = (line: number, kind: string) => line < 2 ? `${line === 0 ? 'a' : 'b'}-${kind.replace('_', '-')}` : `line-${line}-${kind.replace('_', '-')}`;
export const mixerLines = (graph: Graph) => [...new Set(graph.nodes.map(mixerLine).filter((line): line is number => line !== null))].sort((a, b) => a - b);
export const lineOrder = (graph: Graph) => { const lines = mixerLines(graph); return [0, ...lines.filter(n => n > 1), 1].filter(n => lines.includes(n)); };

export const lineNodeWidth = (node: RoutingNode) => node.kind === 'fader' || node.kind === 'cue_switch' ? 80 : 180;
export function lineStagePosition(kind: string, origin: PatchPoint): PatchPoint {
  return {x:origin.x + (kind === 'cue_switch' ? 100 : 0),y:origin.y + (kind === 'fader' || kind === 'cue_switch' ? 200 : lineStages.indexOf(kind as typeof lineStages[number]) * 60)};
}
// Upgrade existing strips while keeping each container's chosen location.
export function compactMixerGraph(graph: Graph): Graph {
  const previousLayout = mixerLines(graph).some(line => {
    const fader = graph.nodes.find(n => mixerLine(n) === line && n.kind === 'fader');
    const cue = graph.nodes.find(n => mixerLine(n) === line && n.kind === 'cue_switch');
    return fader && cue && (fader.y !== cue.y || cue.x !== fader.x + 100);
  });
  if (previousLayout) graph = arrangeMixerLines(graph);
  const snapped = snapPatchGraph(graph);
  const origins = new Map<number,PatchPoint>();
  for (const line of mixerLines(snapped)) {
    const nodes = snapped.nodes.filter(n => mixerLine(n) === line);
    if (!lineStages.every(kind => nodes.some(n => n.kind === kind))) continue;
    const trim = nodes.find(n => n.kind === 'trim')!;
    origins.set(line,{x:snapPatch(trim.x),y:snapPatch(trim.y)});
  }
  return {...snapped,nodes:snapped.nodes.map(node => {
    const origin = origins.get(mixerLine(node) ?? -1);
    return origin ? {...node,...lineStagePosition(node.kind,origin)} : node;
  })};
}

// Arrange only the channel groups; arbitrary sources/effects keep their placements.
export function arrangeMixerLines(graph: Graph): Graph {
  const order = lineOrder(graph);
  const start = 300, gap = 260;
  return { ...graph, nodes: graph.nodes.map(node => {
    const line = mixerLine(node);
    if (line !== null) return { ...node, ...lineStagePosition(node.kind,{x:start + order.indexOf(line) * gap,y:120}) };
    if (node.kind === 'player') return { ...node, x: node.deck === 0 ? 60 : start + order.length * gap + 40, y: 120 };
    if (node.id === 'mix' || node.id === 'master') return { ...node, x: start, y: node.id === 'mix' ? 460 : 640 };
    if (node.id === 'headphones') return { ...node, x: start + Math.max(1, order.length - 1) * gap, y: 640 };
    return node;
  }) };
}
export function addMixerLine(graph: Graph): Graph {
  const line = [2, 3, 4, 5, 6].find(i => !mixerLines(graph).includes(i));
  if (line === undefined) throw new Error('All seven mixer lines are already added');
  if (graph.nodes.length + 5 > 128) throw new Error('Routing node limit reached (128)');
  const nodes: RoutingNode[] = lineStages.map(kind => ({ id: lineId(line, kind), kind, deck: null, label: kind === 'cue_switch' ? 'Cue switch' : kind.toUpperCase(), x: 0, y: 0, value: kind === 'fader' ? .8 : 0, ...(kind === 'eq' ? { eq: [.5, .5, .5] as [number, number, number] } : {}) }));
  const wire = (from: string, to: string, gain = 1) => ({ from, to, output: 'audio', input: 'audio', gain });
  return arrangeMixerLines({ nodes: [...graph.nodes, ...nodes], wires: [...graph.wires,
    ...['trim', 'eq', 'filter'].map((kind, i) => wire(lineId(line, kind), lineId(line, lineStages[i + 1]))),
    wire(lineId(line, 'filter'), lineId(line, 'cue_switch')),
    wire(lineId(line, 'fader'), 'master', .45), wire(lineId(line, 'cue_switch'), 'headphones', .45),
  ] });
}

export function useMixerGraph() {
  const [graph, setGraph] = useState<Graph>({ nodes: [], wires: [] });
  const current = useRef(graph), pending = useRef(false), queued = useRef(new Map<string, RoutingNode>());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    const refresh = async () => { if (pending.current) return; try { const g = await invoke<Graph>('get_routing_graph'); if (!stopped && !pending.current && g?.nodes) { current.current = g; setGraph(g); } } catch { /* Keep the last accepted controls available. */ } };
    refresh(); const timer = window.setInterval(refresh, 1000);
    window.addEventListener('vira-routing-applied', refresh);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener('vira-routing-applied', refresh); };
  }, []);
  const parameter = (id: string, change: Partial<Pick<RoutingNode, 'value' | 'eq'>> | ((node: RoutingNode) => Partial<Pick<RoutingNode, 'value' | 'eq'>>)) => {
    const node = current.current.nodes.find(n => n.id === id); if (!node) return;
    const next = { ...node, ...(typeof change === 'function' ? change(node) : change) };
    current.current = { ...current.current, nodes: current.current.nodes.map(n => n.id === id ? next : n) }; setGraph(current.current);
    queued.current.set(id,next);
    if (pending.current) return;
    pending.current = true;
    void (async () => {
      try {
        while (queued.current.size) {
          const nodes = [...queued.current.values()].map(n => ({id:n.id,value:n.value,...(n.eq ? {eq:n.eq} : {})}));
          queued.current.clear();
          await invoke('set_routing_parameters', {parameters:{nodes,wires:[]}});
        }
        setError(null);
      } catch (e) { queued.current.clear(); setError(String(e)); }
      finally { pending.current = false; }
    })();
  };
  return { graph, parameter, error };
}
