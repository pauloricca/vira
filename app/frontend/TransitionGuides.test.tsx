// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { drawTransitionGuides, transitionMarkers, TransitionOverview, type TransitionPlan } from './TransitionGuides';
afterEach(cleanup);
const plan: TransitionPlan = { from: 0, style: 'crossfade', started: false,
  points: [[16, 19.2, 28.8, 24, 32], [7, 10.2, 19.8, 15, 23]], remaining_beats: [8, 14.4, 33.6, 24, 40] };
test('crossfade and bass modes use the native event positions on each deck', () => {
  expect(transitionMarkers(plan, 0).map(m => m.seconds)).toEqual([16, 19.2, 28.8, 32]);
  expect(transitionMarkers(plan, 1).map(m => m.seconds)).toEqual([7, 10.2, 19.8, 23]);
  expect(transitionMarkers({ ...plan, style: 'bass-swap' }, 0).map(m => m.label)).toEqual(['AUTO START', 'BASS SWAP', 'AUTO END']);
  expect(transitionMarkers({ ...plan, style: 'smart' }, 1).map(m => m.label)).toEqual(['AUTO START', 'BASS SWAP', 'AUTO END']);
  expect(transitionMarkers({ ...plan, style: 'smart' }, 1).find(m => m.id === 'bass')?.seconds).toBe(15);
  expect(transitionMarkers(null, 0)).toEqual([]);
});
test('no overlap shows one handoff marker and looped overview hides passed events', () => {
  const zero: TransitionPlan = { ...plan, points: [[40,40,40,40,40], [7,7,7,7,7]], remaining_beats: [1,1,1,1,1] };
  expect(transitionMarkers(zero, 0).map(m => m.label)).toEqual(['HANDOFF']);
  const view = render(<svg><TransitionOverview plan={{ ...plan, remaining_beats: [-2,1,2,3,4] }} deck={0} total={60} looped /></svg>);
  expect(view.container.querySelector('[data-transition-marker="start"]')).toBeNull();
  expect(view.container.querySelector('[data-transition-marker="end"]')).toBeTruthy();
  expect(view.container.querySelector('rect')).toBeNull();
});
test('canvas guides draw bass markers at the same native positions as overview guides', () => {
  const ctx = { save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), measureText: () => ({ width: 50 }), fillText: vi.fn() };
  drawTransitionGuides(ctx as unknown as CanvasRenderingContext2D, transitionMarkers({ ...plan, style: 'smart' }, 1), marker => marker.seconds * 10, 600, 100);
  expect(ctx.moveTo).toHaveBeenCalledWith(150, 0);
  expect(ctx.fillText).toHaveBeenCalledWith('BASS SWAP', 154, 53);
  expect(ctx.restore).toHaveBeenCalledOnce();
});
