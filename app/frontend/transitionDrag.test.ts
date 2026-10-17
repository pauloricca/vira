import { expect, test } from 'vitest';
import { transitionHit } from './transitionDrag';
import type { TransitionPlan } from './TransitionGuides';
const plan: TransitionPlan = { from: 0, style: 'bass-swap', started: false,
  points: [[20,40,40,40,60], [10,30,30,30,50]], remaining_beats: [40,80,80,80,120] };
test('handles take priority over area dragging; inactive guides leave normal waveform gestures available', () => {
  expect(transitionHit(plan, 1, 31, 2)).toBe('auto_swap');
  expect(transitionHit(plan, 1, 20, 2)).toBe('auto_move');
  expect(transitionHit(plan, 1, 5, 2)).toBeNull();
  expect(transitionHit({ ...plan, started: true }, 1, 30, 2)).toBeNull();
  expect(transitionHit(null, 1, 30, 2)).toBeNull();
  expect(transitionHit({ ...plan, style: 'crossfade' }, 1, 30, 2)).toBe('auto_move');
  expect(transitionHit(plan, 0, 21, 2)).toBe('auto_start');
  expect(transitionHit(plan, 0, 59, 2)).toBe('auto_finish');
});
