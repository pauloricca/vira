// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { RollingWaveforms, type AudioState } from './Decks';
import { masterGridGeometry } from './LiveWaveforms';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(() => { cleanup(); localStorage.clear(); invoke.mockReset(); });
const audio: AudioState = { decks: [0, 1].map(deck => ({ deck, loading: false, error: null, track: null, position_seconds: 0, playing: false, gain: 1, generation: 0, requested_generation: 0 })), running: false, error: null, telemetry: {} };
test('picker toggles decks and routed sources, persists choices, and dismisses with Escape', async () => {
  invoke.mockResolvedValue({ sources: [{ id: 'patch-0', label: 'Drum machine', peaks: [] }], output_frame: 48000, peak_frames: 240, generation: 1 });
  render(<RollingWaveforms audio={audio} beats={16} onZoomChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sources ▾' }));
  const drums = await screen.findByRole('checkbox', { name: 'Drum machine' });
  expect((screen.getByRole('checkbox', { name: 'Deck A' }) as HTMLInputElement).checked).toBe(true);
  expect((drums as HTMLInputElement).checked).toBe(false);
  fireEvent.click(drums);
  expect(screen.getByRole('img', { name: 'Rolling waveform Drum machine, past audio only' })).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Deck A' }));
  expect(screen.queryByRole('img', { name: 'Rolling waveform deck A' })).toBeNull();
  expect(screen.getByRole('img', { name: 'Rolling waveform deck B' })).toBeTruthy();
  expect(JSON.parse(localStorage.getItem('vira.rolling-sources')!)).toEqual(['deck-1', 'patch-0']);
  fireEvent.keyDown(drums, { key: 'Escape' });
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sources ▾' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('get_rolling_waveforms', expect.anything()));
});
test('empty selection keeps the controls available', () => {
  localStorage.setItem('vira.rolling-sources', '[]');
  invoke.mockResolvedValue({ sources: [], output_frame: 0, peak_frames: 240, generation: 1 });
  render(<RollingWaveforms audio={audio} />);
  expect(screen.getByText('Choose waveform sources above')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Sources ▾' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Deck A' }));
  expect(screen.getByRole('img', { name: 'Rolling waveform deck A' })).toBeTruthy();
});

test('master grid follows the shared beat phase across the whole output window', () => {
  const marks = masterGridGeometry(4.5, 120, 4, 800);
  expect(marks.find(mark => mark.bar === 2 && mark.beat === 1)?.x).toBeCloseTo(350);
  expect(marks.find(mark => mark.bar === 2 && mark.beat === 2)?.x).toBeCloseTo(450);
  expect(masterGridGeometry(4.5, 120, 2, 800).find(mark => mark.bar === 2 && mark.beat === 1)?.x).toBeCloseTo(300);
  expect(masterGridGeometry(-.5, 120, 4, 800).find(mark => mark.bar === 1 && mark.beat === 1)?.x).toBeCloseTo(450);
  expect(masterGridGeometry(0, null, 4, 800)).toEqual([]);
});
