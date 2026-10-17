export type TransitionPoints = [number, number, number, number, number];
export type TransitionPlan = {
  from: number; style: 'crossfade' | 'bass-swap' | 'smart'; started: boolean;
  points: [TransitionPoints, TransitionPoints]; remaining_beats: TransitionPoints;
  sampled_at?: number;
};
export type TransitionMarker = { id: string; label: string; seconds: number; remaining: number; colour: string; lane: number };
const EDGE = '#a8e6d1', BASS = '#ffd06d', FADE = '#dceaf0';
export function transitionMarkers(plan: TransitionPlan | null | undefined, deck: number): TransitionMarker[] {
  if (!plan?.points[deck]) return [];
  const points = plan.points[deck];
  const make = (index: number, id: string, label: string, colour: string, lane: number): TransitionMarker =>
    ({ id, label, colour, lane, seconds: points[index], remaining: plan.remaining_beats[index] });
  if (Math.abs(points[4] - points[0]) < 1e-6 && Math.abs(plan.remaining_beats[4] - plan.remaining_beats[0]) < 1e-6)
    return [make(0, 'handoff', 'HANDOFF', EDGE, 0)];
  return [make(0, 'start', 'AUTO START', EDGE, 0),
    ...(plan.style === 'crossfade'
      ? [make(1, 'out', 'OUT FADE', FADE, 1), make(2, 'in', 'IN FULL', FADE, 3)]
      : [make(3, 'bass', 'BASS SWAP', BASS, 2)]),
    make(4, 'end', 'AUTO END', EDGE, 4)];
}
function stamp(seconds: number) {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}
export function TransitionDescription({ plan, deck, rolling = false }: { plan?: TransitionPlan | null; deck: number; rolling?: boolean }) {
  const markers = transitionMarkers(plan, deck);
  if (!markers.length) return null;
  return <span className="sr-only" role="group" aria-label={`Automatic transition guides ${rolling ? 'rolling ' : ''}deck ${deck === 0 ? 'A' : 'B'}`}>
    {markers.map(marker => <span key={marker.id}>{marker.label} at {stamp(marker.seconds)}. </span>)}
  </span>;
}
export function TransitionOverview({ plan, deck, total, start = 0, looped = false }: { plan?: TransitionPlan | null; deck: number; total: number; start?: number; looped?: boolean }) {
  if (!plan || total <= start) return null;
  const markers = transitionMarkers(plan, deck), points = plan.points[deck];
  const x = (seconds: number) => seconds / total * 1024;
  const left = x(Math.max(start, points[0])), right = x(Math.min(total, points[4]));
  return <g className="transition-guides" data-transition-style={plan.style}>
    {!looped && right > left && <rect x={left} y={0} width={right-left} height={120} fill={EDGE} opacity={0.09} />}
    {markers.filter(marker => marker.seconds >= start && marker.seconds <= total && (!looped || marker.remaining >= 0)).map(marker => {
      const position = x(marker.seconds), padding = Math.min(48, (1024 - x(start)) / 2);
      const labelX = Math.max(x(start) + padding, Math.min(1024 - padding, position));
      const y = [15, 36, 62, 87, 111][marker.lane];
      return <g key={marker.id} data-transition-marker={marker.id}>
        <title>{marker.label} · {stamp(marker.seconds)}</title>
        <path d={`M${position},0V120`} stroke={marker.colour} strokeWidth={marker.id === 'bass' ? 2.5 : 1.5} strokeDasharray={marker.id === 'bass' ? undefined : '4 3'} vectorEffect="non-scaling-stroke" />
        <text x={labelX} y={y} fill={marker.colour} textAnchor="middle" fontSize={12} fontWeight="700">{marker.label}</text>
      </g>;
    })}
  </g>;
}
/** Canvas uses the same markers and colours as the overview SVG. */
export function drawTransitionGuides(ctx: CanvasRenderingContext2D, markers: TransitionMarker[], x: (marker: TransitionMarker) => number, width: number, height: number) {
  if (!markers.length) return;
  ctx.save();
  const first = x(markers[0]), last = x(markers[markers.length - 1]);
  if (last > first) {
    ctx.fillStyle = 'rgba(168,230,209,.09)';
    ctx.fillRect(Math.max(0, first), 0, Math.max(0, Math.min(width, last) - Math.max(0, first)), height);
  }
  for (const marker of markers) {
    const position = x(marker);
    if (position < 0 || position > width) continue;
    ctx.strokeStyle = marker.colour; ctx.lineWidth = marker.id === 'bass' ? 2.5 : 1.5;
    ctx.setLineDash(marker.id === 'bass' ? [] : [4, 3]);
    ctx.beginPath(); ctx.moveTo(position, 0); ctx.lineTo(position, height); ctx.stroke();
    ctx.font = 'bold 10px sans-serif';
    const textWidth = ctx.measureText(marker.label).width;
    const labelX = Math.max(2, Math.min(width - textWidth - 4, position + 4));
    const labelY = [12, 27, Math.max(12, height / 2 + 3), height - 18, height - 4][marker.lane];
    ctx.fillStyle = '#0d181dea'; ctx.fillRect(labelX - 2, labelY - 10, textWidth + 4, 13);
    ctx.fillStyle = marker.colour; ctx.fillText(marker.label, labelX, labelY);
  }
  ctx.restore();
}
