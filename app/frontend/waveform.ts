import type { Prepared } from './Decks';
import type { Grid } from './Timing';
const cache = new WeakMap<NonNullable<Prepared['fine_peaks']>, Float32Array[]>();
/** Max pyramid makes a screen column query independent of zoom/track length. */
export function peakLevels(peaks: NonNullable<Prepared['fine_peaks']>) {
  let levels = cache.get(peaks);
  if (!levels) {
    const base = Float32Array.from(peaks, p => Math.min(1, Math.max(p[0], p[1])));
    levels = [base];
    while (levels[levels.length-1].length > 1) {
      const previous = levels[levels.length-1], next = new Float32Array(Math.ceil(previous.length / 2));
      for (let i=0; i<next.length; i++) next[i] = Math.max(previous[i*2], previous[i*2+1] ?? 0);
      levels.push(next);
    }
    cache.set(peaks, levels);
  }
  return levels;
}
export function rangePeak(levels: Float32Array[], first: number, last: number) {
  let peak = 0, index = Math.max(0, first), end = Math.min(levels[0].length, last);
  while (index < end) {
    const remaining = end - index;
    let level = Math.min(31 - Math.clz32(remaining), index ? 31 - Math.clz32(index & -index) : levels.length-1);
    level = Math.min(level, levels.length-1);
    peak = Math.max(peak, levels[level][index >> level]);
    index += 2 ** level;
  }
  return peak;
}
export function gridGeometry(grid: Grid | null | undefined, position: number, window: number, speed: number, width: number, duration: number) {
  if (!grid) return [];
  const sourceWindow = window * speed, start = position - sourceWindow / 2;
  const first = Math.ceil((Math.max(0,start) - grid.downbeat_seconds) * grid.bpm / 60);
  const last = Math.floor((Math.min(duration,start+sourceWindow) - grid.downbeat_seconds) * grid.bpm / 60);
  const result = [];
  for (let beat=first; beat<=last && result.length<2048; beat++) result.push({
    x: (grid.downbeat_seconds + beat * 60 / grid.bpm - start) / sourceWindow * width,
    bar: Math.floor(beat/4)+1, beat: ((beat%4)+4)%4+1,
  });
  return result;
}
/** Raster tiles are rebuilt only for a source/scale/size change or entering new audio. */
export class WaveTiles {
  private tiles = new Map<number, HTMLCanvasElement>();
  private key = '';
  private peaks: Prepared['fine_peaks'];
  draw(ctx: CanvasRenderingContext2D, track: Prepared | null, start: number, window: number, width: number, height: number, dpr: number, colour: string) {
    const peaks = track?.fine_peaks;
    if (!track || !peaks?.length || window<=0) { this.tiles.clear(); this.peaks=undefined; this.key=''; return; }
    const pixels = width * dpr / window;
    const key = `${pixels}:${height}:${dpr}:${colour}`;
    if (key !== this.key || this.peaks !== peaks) { this.tiles.clear(); this.key=key; this.peaks=peaks; }
    const levels = peakLevels(peaks), step = (track.fine_peak_frames ?? 240) / 48000;
    const tileWidth = 1024, origin = start * pixels;
    const first = Math.max(0, Math.floor(origin/tileWidth));
    const last = Math.min(Math.ceil(track.duration_seconds*pixels/tileWidth)-1, Math.floor((origin+width*dpr)/tileWidth));
    for (const index of this.tiles.keys()) if (index<first-1 || index>last+1) this.tiles.delete(index);
    for (let tile=first; tile<=last; tile++) {
      let bitmap=this.tiles.get(tile);
      if (!bitmap) {
        bitmap=document.createElement('canvas'); bitmap.width=tileWidth; bitmap.height=Math.round(height*dpr);
        const c=bitmap.getContext('2d'); if (!c) continue;
        c.strokeStyle=colour; c.lineWidth=1; c.beginPath();
        const center=height*dpr/2, amplitude=height*dpr/3;
        for (let x=0; x<tileWidth; x++) {
          const seconds=(tile*tileWidth+x)/pixels;
          if (seconds>=track.duration_seconds) break;
          const a=Math.floor(seconds/step), b=Math.max(a+1,Math.ceil((seconds+1/pixels)/step));
          const peak=rangePeak(levels,a,b)*amplitude;
          c.moveTo(x+.5,center-peak); c.lineTo(x+.5,center+peak);
        }
        c.stroke(); this.tiles.set(tile,bitmap);
      }
      ctx.drawImage(bitmap,(tile*tileWidth-origin)/dpr,0,tileWidth/dpr,height);
    }
  }
}
