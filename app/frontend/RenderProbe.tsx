import { useEffect, useRef } from 'react';
import { animate, animationMetrics } from './transport';
import { drawMetrics } from './RollingRow';
import { invoke } from '@tauri-apps/api/core';
/** Measures submitted visual updates and records rAF cadence separately; never schedules audio. */
export function RenderProbe({ active, stage }: { active: boolean; stage: string }) {
  const label = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    if (!active) { if (label.current) label.current.textContent = 'Display: paused'; return; }
    let id = 0, began = performance.now(), previous = began, shown = began, frames = 0;
    const gaps: number[] = [];
    function tick(now: number) {
      gaps.push(now - previous); previous = now; frames++;
      if (now - shown >= 1000) {
        if (label.current) label.current.textContent = `Display: ${(frames * 1000 / (now - began)).toFixed(1)} fps`;
        shown = now;
      }
      if (now - began >= 30000) {
        gaps.sort((a,b) => a-b);
        void invoke('record_render_metrics', { metrics: { stage, duration_ms: now - began, frames,
          fps: frames * 1000 / (now - began), p95_frame_ms: gaps[Math.floor(gaps.length * .95)], max_frame_ms: gaps[gaps.length-1],
          over_25_ms: gaps.filter(v => v > 25).length, visibility: document.visibilityState, focused: document.hasFocus(), animation_driver: animationMetrics.driver, raf_fps: animationMetrics.raf_count * 1000 / Math.max(1,now-animationMetrics.began), draw_mean_ms: drawMetrics.count ? drawMetrics.total_ms / drawMetrics.count : null, draw_max_ms: drawMetrics.max_ms } }).catch(() => {});
        began = now; frames = 0; gaps.length = 0;
      }
      if (stage !== 'canvas') id = requestAnimationFrame(tick);
    }
    if (stage === 'canvas') return animate(tick);
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [active, stage]);
  return <output ref={label} aria-label="Rendering performance">Display: paused</output>;
}
