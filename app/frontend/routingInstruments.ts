import type { Graph, RoutingNode } from './Routing';
import type { Instrument } from './instrumentModel';

// Hardware capture and send remain separate engine endpoints, but share one
// placement on the routing canvas. This also folds older saved placements.
export function instrumentGraph(graph: Graph, instruments: Instrument[]): Graph {
  const nodes: RoutingNode[] = [];
  const ids = new Map<string, string>();
  for (const node of graph.nodes) {
    const match = /^instrument-(in|out)-(.+)$/.exec(node.id);
    if (!match && node.kind !== 'instrument') { nodes.push(node); continue; }
    const id = match ? `instrument-${match[2]}` : node.id;
    ids.set(node.id, id);
    const definition = instruments.find(i => id === `instrument-${i.id}`);
    const existing = nodes.find(n => n.id === id);
    const combined: RoutingNode = {
      ...node, id, kind: 'instrument',
      label: definition?.name ?? node.label.replace(/ · audio (from|to)$/, ''),
      instrument_input: definition ? !!definition.audio_output : !!node.instrument_input || match?.[1] === 'out',
      instrument_output: definition ? !!definition.audio_input : !!node.instrument_output || match?.[1] === 'in',
    };
    if (existing) {
      existing.instrument_input ||= combined.instrument_input;
      existing.instrument_output ||= combined.instrument_output;
    } else nodes.push(combined);
  }
  const wires = graph.wires.map(w => ({...w, from: ids.get(w.from) ?? w.from, to: ids.get(w.to) ?? w.to})).filter(w => {
    const source = nodes.find(n => n.id === w.from), target = nodes.find(n => n.id === w.to);
    return (source?.kind !== 'instrument' || source.instrument_output) && (target?.kind !== 'instrument' || target.instrument_input);
  });
  return {nodes, wires};
}

export function engineGraph(graph: Graph): Graph {
  return {
    nodes: graph.nodes.flatMap(node => {
      if (node.kind !== 'instrument') return [node];
      const {instrument_input, instrument_output, ...base} = node;
      const id = node.id.slice('instrument-'.length);
      return [
        ...(instrument_output ? [{...base, id:`instrument-in-${id}`, kind:'input' as const}] : []),
        ...(instrument_input ? [{...base, id:`instrument-out-${id}`, kind:'output' as const}] : []),
      ];
    }),
    wires: graph.wires.map(w => ({...w,
      from: graph.nodes.find(n => n.id === w.from)?.kind === 'instrument' ? w.from.replace('instrument-', 'instrument-in-') : w.from,
      to: graph.nodes.find(n => n.id === w.to)?.kind === 'instrument' ? w.to.replace('instrument-', 'instrument-out-') : w.to,
    })),
  };
}
