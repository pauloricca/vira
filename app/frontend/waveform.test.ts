import { expect, test } from 'vitest';
import { snapTappedBeat } from './waveform';
import type { Prepared } from './Decks';

test('tapped beats snap only to strong nearby local attacks using the source sample rate', () => {
  const track = { frames: 44100, duration_seconds: 1, fine_peak_frames: 441,
    fine_features: Array.from({ length: 100 }, (_, i) => [0, i === 30 ? .9 : i === 40 ? .2 : 0]),
  } as Prepared;
  expect(snapTappedBeat(track, .32)).toBe(.3);
  expect(snapTappedBeat(track, .37)).toBe(.37);
  expect(snapTappedBeat(track, .4)).toBe(.4);
  expect(snapTappedBeat({ ...track, fine_features: undefined }, .32)).toBe(.32);
});
