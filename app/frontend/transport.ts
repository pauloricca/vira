/** A display-only source clock. Audio owns seeks, tempo and event timing. */
export type PositionSnapshot = { position_seconds: number; speed?: number; playing: boolean; generation: number; position_epoch?: number; duration: number; start_seconds?: number; loop_in_seconds?: number | null; loop_out_seconds?: number | null };
export class DisplayPosition {
  private state: PositionSnapshot | null = null;
  private origin = 0;
  private atTime = 0;
  private correction = 0;
  private deadline = 0;
  private smoothing = .35;
  update(next: PositionSnapshot, received: number, sampled = received, smoothing = .35) {
    const current = this.at(received);
    const speed = next.speed ?? 1;
    const target = next.position_seconds + (next.playing ? Math.max(0, received - sampled) / 1000 * speed : 0);
    const discontinuity = !this.state || this.state.generation !== next.generation || this.state.position_epoch !== next.position_epoch
      || this.state.playing !== next.playing || Math.abs(target - current) / Math.max(speed, this.state.speed ?? 1) > .15;
    this.origin = discontinuity || !next.playing ? target : current;
    this.correction = discontinuity || !next.playing ? 0 : target - current;
    this.smoothing = Math.max(smoothing, -this.correction / speed * 2);
    this.atTime = received;
    this.deadline = Math.max(received, sampled + 500);
    this.state = next;
  }
  at(now: number) {
    if (!this.state) return 0;
    if (!this.state.playing) return Math.min(this.state.duration, Math.max(this.state.start_seconds ?? 0, this.origin));
    const elapsed = Math.max(0, Math.min(now, this.deadline) - this.atTime) / 1000;
    const value = this.origin + elapsed * (this.state.speed ?? 1) + this.correction * (1 - Math.exp(-elapsed / this.smoothing));
    const start = this.state.loop_in_seconds;
    const end = this.state.loop_out_seconds;
    const looped = start != null && end != null && end > start && value >= end
      ? start + (value - start) % (end - start) : value;
    return Math.min(this.state.duration, Math.max(this.state.start_seconds ?? 0, looped));
  }
}

/** One display loop; a paced timer handles WebKit's slow rAF delivery while visible.
 * Keep rAF cadence separately measurable. This is exclusively visual scheduling.
 */
const subscribers = new Set<(now: number) => void>();
export const animationMetrics = {driver: 'raf', raf_count:0, began:0};
let frame=0, timer: ReturnType<typeof setTimeout> | undefined, lastDraw=0, lastRaf=0, slowFrames=0;
const period=1000/60;
function draw(now:number) {
  if(now-lastDraw<period-1) return;
  lastDraw=now;
  for(const callback of subscribers) callback(now);
}
function timerTick() {
  timer=undefined;
  if(!subscribers.size || document.visibilityState==='hidden') return;
  draw(performance.now());
  timer=setTimeout(timerTick,Math.max(1,lastDraw+period-performance.now()));
}
function tick(now:number) {
  frame=0;
  animationMetrics.raf_count++;
  if(lastRaf && now-lastRaf>30) slowFrames++; else slowFrames=Math.max(0,slowFrames-1);
  lastRaf=now;
  if(slowFrames>=8 && !timer && document.visibilityState!=='hidden') {
    animationMetrics.driver='paced-timer'; timer=setTimeout(timerTick,period);
  }
  if(animationMetrics.driver==='raf') draw(now);
  if(subscribers.size && document.visibilityState!=='hidden') frame=requestAnimationFrame(tick);
}
function start() {
  if(!animationMetrics.began) animationMetrics.began=performance.now();
  if(!frame && subscribers.size && document.visibilityState!=='hidden') frame=requestAnimationFrame(tick);
  if(animationMetrics.driver==='paced-timer' && !timer && subscribers.size && document.visibilityState!=='hidden') timer=setTimeout(timerTick,period);
}
function stop() {
  if(frame) cancelAnimationFrame(frame); frame=0;
  if(timer) clearTimeout(timer); timer=undefined;
}
export function animate(draw: (now:number)=>void) {
  if(!subscribers.size) {animationMetrics.driver='raf';animationMetrics.raf_count=0;animationMetrics.began=0;lastDraw=0;lastRaf=0;slowFrames=0;}
  subscribers.add(draw); start();
  return () => {subscribers.delete(draw);if(!subscribers.size) stop();};
}
if(typeof document!=='undefined') document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden') stop(); else start();
});
