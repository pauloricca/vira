export const scales = ['Major', 'Natural minor', 'Dorian', 'Mixolydian'];
export const intervals = [[0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 3, 5, 7, 9, 10], [0, 2, 4, 5, 7, 9, 10]];
export const keys = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
export type PatternNote = { id: string; beat: number; duration: number; degree: number; octave: number; velocity: number; row?: string };
export type PercussionRow = { id: string; name: string; note: number; channel: number | null };
export type Pattern = { id: string; name: string; kind: 'melodic' | 'percussion' | 'cue'; rows?: PercussionRow[]; mode: 'relative'; output: number; channel: number; bars: number; steps?: number; stepDivision?: number; phraseSync?: boolean; grid: number; key: number; scale: number; octave: number; quantum: number; compensation: number | null; notes: PatternNote[] };
export type Bank = { patterns: Pattern[]; outputCompensation: Record<string, number>; graph?: MusicalGraph | null };
export const uid = () => crypto.randomUUID();
export function newPattern(kind: Pattern['kind'] = 'melodic'): Pattern { return { id: uid(), name: kind === 'cue' ? 'Untitled cue pattern' : kind === 'percussion' ? 'Untitled percussion' : 'Untitled pattern', kind, ...(kind === 'percussion' ? { rows: [] } : {}), mode: 'relative', output: 0, channel: 1, bars: 2, steps: 32, stepDivision: 4, phraseSync: true, grid: 4, key: 0, scale: 0, octave: 4, quantum: 4, compensation: null, notes: [] }; }
export function pitch(p: Pattern, degree: number, octave: number) { return (p.octave + octave + 1) * 12 + p.key + intervals[p.scale][degree - 1]; }
export function pitchLabel(midi: number) { return `${keys[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`; }
export function patternBeats(p: Pattern) { return p.steps == null ? p.bars * 4 : p.steps / (p.stepDivision ?? 4); }
export function patternSteps(p: Pattern) { return p.steps ?? p.bars * 4 * (p.stepDivision ?? 4); }
export function patternLengthLabel(p: Pattern) { return `${patternSteps(p)} steps · 1/${(p.stepDivision ?? 4) * 4}`; }
export function fitSteps(p: Pattern, steps: number, stepDivision = p.stepDivision ?? 4): Pattern {
  const beats = steps / stepDivision;
  return { ...p, steps, stepDivision, notes: p.notes.filter(n => n.beat < beats).map(n => ({ ...n, duration: Math.min(n.duration, beats - n.beat) })) };
}
export function fitLength(p: Pattern, bars: number): Pattern { return { ...fitSteps(p, bars * 4 * (p.stepDivision ?? 4)), bars }; }
export function snap(beat: number, grid: number) { return Math.round(beat * grid) / grid; }
export type Harmony = { key: number; scale: number };
export type Destination = { kind: 'vst'; id: string } | { kind: 'midi'; output: number } | { kind: 'teia'; slot: number };
export type Transformation = { kind: 'selector'; selected: string; ports: string[] } | { kind: 'octaveShift'; octaves: number } | { kind: 'filter'; direction: 'above' | 'below'; note: number };
export type MusicalNode = { id: string; kind: 'pattern' | 'deck' | 'instrument' | 'transformation'; transformation?: Transformation; custom_label?: string | null; label: string; x: number; y: number; pattern?: string | null; deck?: number | null; destination?: Destination | null; input?: number | null; channel?: number | null; harmony?: Harmony | null };
export type MusicalWire = { input?: string; id: string; from: string; to: string; kind: 'key' | 'root' | 'scale' | 'midi' | 'notes' | 'cue'; route?: number | null };
export type MusicalGraph = { nodes: MusicalNode[]; wires: MusicalWire[] };
export function normaliseBank(bank: Bank): Bank {
  if (bank.graph) return { ...bank, graph: { ...bank.graph, nodes: bank.graph.nodes.map(n => n.kind === 'pattern' ? {...n, label: bank.patterns.find(p => p.id === n.pattern)?.name ?? n.label} : n), wires: bank.graph.wires.flatMap(w => w.kind === 'key' ? [{ ...w, kind: 'notes' as const }, { ...w, id: `${w.id}-scale`, kind: 'scale' as const }] : [{ ...w, kind: w.kind === 'root' ? 'notes' as const : w.kind }]) } };
  const graph: MusicalGraph = { nodes: [0, 1].map(deck => ({ id: `deck-${deck}`, kind: 'deck', label: `Deck ${deck === 0 ? 'A' : 'B'}`, x: 60, y: 70 + deck * 200, deck })), wires: [] };
  bank.patterns.forEach((p, i) => {
    const id = `pattern-${p.id}`;
    graph.nodes.push({ id, kind: 'pattern', label: p.name, x: 430 + (Math.floor(i / 4) % 4) * 230, y: 70 + (i % 4) * 200, pattern: p.id });
    if (p.output) {
      const target = `midi-${p.output}`;
      if (!graph.nodes.some(n => n.id === target)) graph.nodes.push({ id: target, kind: 'instrument', label: `MIDI ${p.output}`, x: 1050, y: 70 + (graph.nodes.filter(n => n.kind === 'instrument').length % 5) * 180, destination: { kind: 'midi', output: p.output }, harmony: { key: 0, scale: 0 } });
      graph.wires.push({ id: `route-${p.id}`, from: id, to: target, kind: 'midi', route: graph.wires.length });
    }
  });
  return { ...bank, graph };
}
export function patternTargets(bank: Bank, id: string) {
  const graph = bank.graph; const node = graph?.nodes.find(n => n.pattern === id);
  if (!graph || !node) return [];
  const visit = (id: string, seen = new Set<string>()): MusicalNode[] => {
    if (seen.has(id)) return []; seen.add(id);
    return graph.wires.filter(w => {
      const target = graph.nodes.find(n => n.id === w.to);
      return ['midi', 'notes', 'cue'].includes(w.kind) && w.from === id && (target?.transformation?.kind !== 'selector' || target.transformation.selected === w.input);
    }).flatMap(w => {
      const target = graph.nodes.find(n => n.id === w.to);
      return !target ? [] : target.kind === 'transformation' ? visit(target.id, seen) : [target];
    });
  };
  return visit(node.id);
}
export const physicalDeck = (deck: number | null | undefined, active: number, selected: number) => deck === 2 ? active : deck === 3 ? selected : deck ?? 0;
export function linkedHarmony(bank: Bank, id: string, decks: (Harmony | null)[], component: 'root' | 'scale' = 'root', liveRoots: Record<string, number> = {}, activeDeck = 0, selectedDeck = 0): { source: string; harmony: Harmony | null } | null {
  const graph = bank.graph; const node = graph?.nodes.find(n => n.pattern === id);
  const wire = graph?.wires.find(w => (w.kind === (component === 'root' ? 'notes' : 'scale') || w.kind === component || w.kind === 'key') && w.to === node?.id);
  let source = graph?.nodes.find(n => n.id === wire?.from);
  const seen = new Set<string>();
  while (source?.transformation?.kind === 'selector' && !seen.has(source.id)) {
    seen.add(source.id); const selector = source;
    const selected = selector.transformation!.kind === 'selector' ? selector.transformation!.selected : '';
    const upstream = graph?.wires.find(w => w.to === selector.id && w.input === selected && (component === 'scale' ? w.kind === 'scale' : ['notes','midi'].includes(w.kind)));
    source = graph?.nodes.find(n => n.id === upstream?.from);
  }
  return source ? { source: source.label, harmony: source.kind === 'deck' ? decks[physicalDeck(source.deck, activeDeck, selectedDeck)] ?? null : liveRoots[node!.id] === undefined ? null : { key: liveRoots[node!.id] % 12, scale: bank.patterns.find(p => p.id === id)?.scale ?? 0 } } : null;
}
export function connectMusical(graph: MusicalGraph, wire: MusicalWire, replace?: string): MusicalGraph {
  const from = graph.nodes.find(n => n.id === wire.from), to = graph.nodes.find(n => n.id === wire.to);
  const signal = ['midi', 'notes'].includes(wire.kind);
  const valid = from && to && from.id !== to.id && (wire.kind === 'cue' ? from.kind === 'pattern' && to.kind === 'deck' : signal
    ? (from.kind === 'transformation' || ['pattern', 'instrument'].includes(from.kind) || from.kind === 'deck' && wire.kind === 'notes') && (to.kind === 'transformation' || ['instrument', 'deck'].includes(to.kind) || to.kind === 'pattern' && wire.kind === 'notes')
    : ['root', 'key', 'scale'].includes(wire.kind) && (from.kind === 'deck' || from.transformation?.kind === 'selector') && (to.kind === 'pattern' || to.transformation?.kind === 'selector'));
  if (!valid) throw new Error('Connect Note or MIDI through transformations, or scale → scale.');
  const wires = graph.wires.filter(w => w.id !== replace);
  if (wires.some(w => w.from === wire.from && w.to === wire.to && w.kind === wire.kind && w.input === wire.input)) throw new Error('This connection already exists.');
  if (to.transformation?.kind === 'selector' && (!wire.input || !to.transformation.ports.includes(wire.input) || wires.some(w => w.to === wire.to && w.input === wire.input))) throw new Error('Selector inputs accept one cable each.');
  if (to.transformation?.kind !== 'selector' && (!['midi', 'notes', 'cue'].includes(wire.kind) || to.kind === 'pattern') && wires.some(w => w.kind === wire.kind && w.to === wire.to)) throw new Error('Disconnect the existing input cable first, or reconnect its source.');
  if (['midi', 'notes', 'cue'].includes(wire.kind)) {
    const old = graph.wires.find(w => w.id === replace);
    const used = new Set(wires.filter(w => ['midi', 'notes', 'cue'].includes(w.kind)).map((w, i) => w.route ?? i));
    let route = old?.route ?? 0; while (used.has(route)) route++;
    if (route >= 256) throw new Error('Maximum MIDI route count reached.');
    wire = { ...wire, route };
  }
  const next = [...wires, wire];
  const reaches = (id: string, target: string, seen = new Set<string>()): boolean => {
    if (id === target) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return next.filter(w => w.from === id && graph.nodes.some(n => n.id === w.to && n.kind === 'transformation')).some(w => reaches(w.to, target, seen));
  };
  if (to.kind === 'transformation' && reaches(to.id, from.id)) throw new Error('Transformation feedback is not supported.');
  // Follow transformation chains when checking deck/pattern feedback.
  const destinations = (id: string, seen = new Set<string>()): MusicalNode[] => {
    if (seen.has(id)) return []; seen.add(id);
    return next.filter(w => w.from === id && ['notes', 'midi'].includes(w.kind)).flatMap(w => {
      const n = graph.nodes.find(n => n.id === w.to)!;
      return n.kind === 'transformation' ? destinations(n.id, seen) : [n];
    });
  };
  for (const deck of graph.nodes.filter(n => n.kind === 'deck')) {
    for (const pattern of destinations(deck.id).filter(n => n.kind === 'pattern')) {
      if (destinations(pattern.id).some(n => n.kind === 'deck' && (deck.deck === n.deck || (deck.deck ?? 0) >= 2 || (n.deck ?? 0) >= 2))) throw new Error('A deck cannot drive a pattern root while that pattern controls its pitch.');
    }
  }
  if (next.some(w => ['root', 'notes'].includes(w.kind) && graph.nodes.some(n => n.id === w.from && n.kind === 'deck') && next.some(out => ['midi', 'notes'].includes(out.kind) && out.from === w.to && graph.nodes.some(target => target.id === out.to && target.kind === 'deck' && graph.nodes.some(source => source.id === w.from && (source.deck === target.deck || (source.deck ?? 0) >= 2 || (target.deck ?? 0) >= 2)))))) throw new Error('A deck cannot drive a pattern root while that pattern controls its pitch.');
  return { ...graph, wires: next };
}
