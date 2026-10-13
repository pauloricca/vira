// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { App, Library, duration } from './App';
const { invoke, audioInvoke } = vi.hoisted(() => ({ invoke: vi.fn(), audioInvoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (command: string, ...args: unknown[]) => ['get_audio_state', 'load_track', 'deck_control'].includes(command) ? audioInvoke(command, ...args) : invoke(command, ...args) }));
beforeEach(() => { audioInvoke.mockResolvedValue({ running: true, error: null, telemetry: {}, decks: [0, 1].map(deck => ({ deck, loading: false, error: null, track: null, position_seconds: 0, playing: false, gain: .8, generation: 0, requested_generation: 0 })) }); });
afterEach(() => { cleanup(); vi.useRealTimers(); invoke.mockReset(); audioInvoke.mockReset(); });
const library: Library = { schema_version: 2, revision: 1, instance_id: 'test', music_bin: '/fixed/music', tracks: [{
  id: 'one', filename: 'Artist - Filename.wav', title: 'Artist - Filename', artist: 'Unknown artist',
  duration_seconds: 125.4, size_bytes: 100, modified_ns: '123', status: 'ready', error: null,
  source_hash: 'hash', analysis: { state: 'not_analysed', result: null, error: null },
}] };
test('startup lists metadata and refresh reconciles removed files', async () => {
  invoke.mockResolvedValueOnce(library).mockResolvedValueOnce({ ...library, tracks: [] });
  render(<App />);
  await screen.findByText('Unknown artist');
  expect(screen.getByText('2:05')).toBeTruthy();
  expect(screen.getByText('Not analysed')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText(/No files in the music bin/);
  expect(invoke.mock.calls).toEqual([['refresh_library'], ['refresh_library']]);
});
test('unavailable service displays actionable error and Refresh retries', async () => {
  invoke.mockRejectedValueOnce('Start the preparation service: docker compose up -d preparation. Then click Refresh.')
    .mockResolvedValueOnce(library).mockRejectedValueOnce('Service stopped');
  render(<App />);
  await screen.findByRole('alert');
  expect(screen.getByText(/docker compose up/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('Unknown artist');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText(/last successful scan/);
  expect(screen.getByText('Unknown artist')).toBeTruthy();
});
test('refresh stays disabled until the scan completes', async () => {
  let finish!: (value: Library) => void;
  invoke.mockReturnValue(new Promise<Library>(resolve => { finish = resolve; }));
  render(<App />);
  expect((screen.getByRole('button', { name: 'Scanning…' }) as HTMLButtonElement).disabled).toBe(true);
  finish(library);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false));
});
test('unknown durations stay blank and long tracks are formatted', () => {
  expect(duration(null)).toBe('—');
  expect(duration(3723)).toBe('62:03');
});
test.each([
  ['first empty deck', [null, null], [false, false], 0],
  ['empty deck over stopped loaded deck', ['old', null], [false, false], 1],
  ['first stopped loaded deck', ['old', 'other'], [false, false], 0],
  ['stopped deck after playing deck', ['old', 'other'], [true, false], 1],
  ['no available deck', ['old', 'other'], [true, true], null],
] as const)('library double-click loads on %s', async (_description, tracks, playing, expectedDeck) => {
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'timing_waveform' ? { artifact_id: 'artifact-0', fine_peaks: [], fine_peak_frames: 0 } : library));
  audioInvoke.mockImplementation((command: string) => Promise.resolve(command === 'get_audio_state' ? {
    running: true, error: null, telemetry: {}, decks: [0, 1].map(deck => ({
      deck, loading: false, error: null, track: tracks[deck] ? { track_id: tracks[deck], artifact_id: `artifact-${deck}`, title: tracks[deck], artist: '', filename: '', duration_seconds: 1, frames: 1, peak_frames: 0, peaks: [] } : null,
      position_seconds: 0, playing: playing[deck], gain: .8, generation: 0, requested_generation: 0,
    })),
  } : undefined));
  render(<App />);
  await screen.findByText('Unknown artist');
  await waitFor(() => expect((screen.getByRole('button', { name: 'Load Artist - Filename on deck A' }) as HTMLButtonElement).disabled).toBe(false));
  await waitFor(() => expect(document.querySelectorAll('.deck-title')[0]?.textContent).toBe(tracks[0] ?? 'No track loaded'));
  await waitFor(() => expect(document.querySelectorAll('.deck-title')[1]?.textContent).toBe(tracks[1] ?? 'No track loaded'));
  const row = screen.getByText('Artist - Filename', { selector: 'span' }).closest('tr')!;
  fireEvent.doubleClick(row);
  if (expectedDeck === null) expect(audioInvoke.mock.calls.filter(([command]) => command === 'load_track')).toHaveLength(0);
  else await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('load_track', { deck: expectedDeck, trackId: 'one' }));
});
test('double-click prefers the deck that played least recently when both are stopped and loaded', async () => {
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'timing_waveform' ? { artifact_id: 'artifact-0', fine_peaks: [], fine_peak_frames: 0 } : library));
  let playing = [false, true];
  audioInvoke.mockImplementation((command: string) => Promise.resolve(command === 'get_audio_state' ? {
    running: true, error: null, telemetry: {}, decks: [0, 1].map(deck => ({
      deck, loading: false, error: null,
      track: { track_id: `old-${deck}`, artifact_id: `artifact-${deck}`, title: `Old ${deck}`, artist: '', filename: '', duration_seconds: 1, frames: 1, peak_frames: 0, peaks: [] },
      position_seconds: 0, playing: playing[deck], gain: .8, generation: 0, requested_generation: 0,
    })),
  } : undefined));
  render(<App />);
  await screen.findByRole('button', { name: 'Pause deck B' });
  playing = [true, false];
  await screen.findByRole('button', { name: 'Pause deck A' });
  playing = [false, false];
  await screen.findByRole('button', { name: 'Play deck A' });
  fireEvent.doubleClick(screen.getByText('Artist - Filename', { selector: 'span' }).closest('tr')!);
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('load_track', { deck: 1, trackId: 'one' }));
});
const estimate = {
  grid: { bpm: 121.25, offset_seconds: .12, residual_p95_ms: 55, end_minus_start_residual_ms: 32, tempo_spread_percent: 1.5, thirds_bpm: [120, 121, 122] },
  beats_seconds: [.12, .62, 1.12], keys: [{ key: 'D minor', correlation: .72 }, { key: 'F major', correlation: .68 }],
  window_keys: [], flags: ['ambiguous_key', 'grid_needs_review'], tempo_alternatives: [60.625, 121.25, 242.5],
};
function snapshot(state: Library['tracks'][number]['analysis']['state'], revision: number, result: typeof estimate | null = null): Library {
  return { ...library, revision, tracks: [{ ...library.tracks[0], analysis: { state, result, error: state === 'failed' ? 'Decode failed' : null } }] };
}
test('selected row queues by ID and polling fills the compact collection row', async () => {
  vi.useFakeTimers();
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'refresh_library' ? library : command === 'analyse_track' ? snapshot('queued', 2) : snapshot('needs_review', 3, estimate)));
  await act(async () => { render(<App />); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Analyse Artist - Filename' })); });
  expect(invoke).toHaveBeenCalledWith('analyse_track', { trackId: 'one' });
  expect(screen.getByText('Queued', { selector: 'span' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Reanalyse Artist - Filename' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText('121.25')).toBeTruthy();
  expect(screen.getByText('D minor')).toBeTruthy();
  expect(screen.getByText('Needs review')).toBeTruthy();
  expect(screen.getByText('1', { selector: 'td' })).toBeTruthy();
  expect(screen.queryByText(/Review estimates for/)).toBeNull();
});
test('failed jobs expose Retry and request errors remain local to the row', async () => {
  invoke.mockResolvedValueOnce(snapshot('failed', 1)).mockRejectedValueOnce('Queue unavailable').mockResolvedValueOnce(snapshot('queued', 2));
  render(<App />);
  await screen.findByText('Decode failed');
  fireEvent.click(screen.getByRole('button', { name: 'Retry Artist - Filename' }));
  await screen.findByText('Queue unavailable');
  expect(screen.queryByText('Library unavailable')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry Artist - Filename' }));
  await screen.findByText('Queued', { selector: 'span' });
});
test('late request cannot restore a removed source after Refresh', async () => {
  let finish!: (value: Library) => void;
  invoke.mockResolvedValueOnce(library).mockReturnValueOnce(new Promise<Library>(resolve => { finish = resolve; }))
    .mockResolvedValueOnce({ ...library, revision: 2, tracks: [] });
  render(<App />);
  await screen.findByText('Unknown artist');
  fireEvent.click(screen.getByRole('button', { name: 'Analyse Artist - Filename' }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText(/No files in the music bin/);
  await act(async () => { finish(snapshot('needs_review', 3, estimate)); });
  expect(screen.queryByText('D minor')).toBeNull();
});
test('older poll responses cannot replace newer queued state', async () => {
  vi.useFakeTimers();
  let finish!: (value: Library) => void;
  invoke.mockImplementation((command: string) => command === 'get_library_state' ? new Promise<Library>(resolve => { finish = resolve; }) : Promise.resolve(command === 'refresh_library' ? library : snapshot('queued', 2)));
  await act(async () => { render(<App />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Analyse Artist - Filename' })); });
  await act(async () => { finish(library); });
  expect(screen.getByText('Queued', { selector: 'span' })).toBeTruthy();
  expect(screen.queryByText(/service restarted/)).toBeNull();
});
test('successful state polling cannot hide a failed metadata Refresh', async () => {
  vi.useFakeTimers();
  let scans = 0;
  invoke.mockImplementation((command: string) => command === 'refresh_library' && ++scans > 1 ? Promise.reject('Music bin unavailable') : Promise.resolve(library));
  await act(async () => { render(<App />); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText('Music bin unavailable')).toBeTruthy();
  expect(screen.getByText(/last successful scan/)).toBeTruthy();
});

test('master BPM is independent of deck tempos and search filters title, artist and filename', async () => {
  invoke.mockResolvedValue(library);
  audioInvoke.mockResolvedValue({ running: true, error: null, telemetry: {}, master_bpm: 128.25, decks: [0, 1].map(deck => ({ deck, loading: false, error: null, track: null, position_seconds: 0, playing: false, gain: .8, generation: 0, requested_generation: 0, target_bpm: deck === 0 ? 110 : 90 })) });
  render(<App />);
  await screen.findByText('Unknown artist');
  expect(screen.getByLabelText('Master BPM').textContent).toBe('128.3');
  fireEvent.change(screen.getByRole('combobox', { name: 'Shared zoom' }), { target: { value: '4' } });
  expect(screen.getByText('Beat grid · 1.87 seconds output window')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search music library' }), { target: { value: 'missing' } });
  expect(screen.queryByText('Unknown artist')).toBeNull();
  expect(screen.getByText('No tracks match your search.')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search music library' }), { target: { value: 'FILENAME.WAV' } });
  expect(screen.getByText('Unknown artist')).toBeTruthy();
});
test('header buttons use original BPM even with adjusted tempo and locked decks', async () => {
  invoke.mockResolvedValue(library);
  audioInvoke.mockResolvedValue({ running: true, error: null, telemetry: {}, master_bpm: 120, decks: [0, 1].map(deck => ({ deck, loading: false, error: null, track: null, position_seconds: 0, playing: false, gain: .8, generation: 1, requested_generation: 1, synced: true, target_bpm: deck === 0 ? 110 : 130, grid: { bpm: 120, downbeat_seconds: 0, reviewed: false } })) });
  render(<App />);
  await screen.findByText('Unknown artist');
  const bpm = screen.getByLabelText('Master BPM');
  const a = screen.getByRole('button', { name: /Drift master tempo to deck A/ });
  expect(a.compareDocumentPosition(bpm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(a.textContent).toBe('A (120.0) →');
  expect((a as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole('button', { name: /Drift master tempo to deck B/ }).textContent).toBe('B (120.0) →');
  fireEvent.click(a, { detail: 1 });
  fireEvent.click(a, { detail: 2 });
  fireEvent.dblClick(a);
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('deck_control', { deck: 0, action: 'master_tempo', value: 120, generation: 1 }));
  await new Promise(resolve => setTimeout(resolve, 270));
  expect(audioInvoke.mock.calls.some(([command, args]) => command === 'deck_control' && args.action === 'drift')).toBe(false);
  const b = screen.getByRole('button', { name: /Drift master tempo to deck B/ });
  expect((b as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(b);
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('deck_control', { deck: 1, action: 'drift', value: null, generation: 1 }));
});
test('Settings opens from the workspace tabs and shares waveform zoom with Decks', async () => {
  invoke.mockResolvedValue(library);
  render(<App />);
  await screen.findByText('Unknown artist');
  fireEvent.click(screen.getByRole('button', { name: 'SETTINGS' }));
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
  expect(screen.getByText('/fixed/music')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByRole('button', { name: 'SETTINGS' }).getAttribute('aria-current')).toBe('page');
  fireEvent.change(screen.getByRole('combobox', { name: 'Shared waveform zoom' }), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: 'DECKS' }));
  expect((screen.getByRole('combobox', { name: 'Shared zoom' }) as HTMLSelectElement).value).toBe('4');
  expect(screen.getByRole('table')).toBeTruthy();
});
test('Settings saves beat or bar launch timing and sends it to the engine', async () => {
  invoke.mockResolvedValue(library);
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'SETTINGS' }));
  const selector = screen.getByRole('combobox', { name: 'Locked deck start' }) as HTMLSelectElement;
  expect(selector.value).toBe('4');
  fireEvent.change(selector, { target: { value: '1' } });
  expect(selector.value).toBe('1');
  expect(localStorage.getItem('vira.sync-quantum')).toBe('1');
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('deck_control', expect.objectContaining({ action: 'sync_quantum', value: 1 })));
  localStorage.removeItem('vira.sync-quantum');
});
test('workspace controls stay out of keyboard tab navigation', async () => {
  invoke.mockResolvedValue(library);
  render(<App />);
  await screen.findByText('Unknown artist');
  await waitFor(() => expect((screen.getByRole('button', { name: 'DECKS' }) as HTMLButtonElement).tabIndex).toBe(-1));
  expect((screen.getByRole('searchbox', { name: 'Search music library' }) as HTMLInputElement).tabIndex).toBe(-1);
  expect(screen.getByRole('slider', { name: 'Waveform seek deck A' }).getAttribute('tabindex')).toBe('-1');
  fireEvent.click(screen.getByRole('button', { name: 'SETTINGS' }));
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'Shared waveform zoom' }) as HTMLSelectElement).tabIndex).toBe(-1));
});
