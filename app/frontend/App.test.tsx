// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { App, Library, duration } from './App';
const { invoke, audioInvoke } = vi.hoisted(() => ({ invoke: vi.fn(), audioInvoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (command: string, ...args: unknown[]) => command === 'get_audio_levels' ? Promise.resolve({ running: true, decks: [0, 0], master: [0, 0] }) : ['get_audio_state', 'load_track', 'deck_control'].includes(command) ? audioInvoke(command, ...args) : invoke(command, ...args) }));
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
  else await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('load_track', { deck: expectedDeck, trackId: 'one', preserveLock: true, resetMixer: true }));
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
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('load_track', { deck: 1, trackId: 'one', preserveLock: true, resetMixer: true }));
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
  expect(screen.getByText('1', { selector: '.track-index' })).toBeTruthy();
  expect(screen.queryByText(/Review estimates for/)).toBeNull();
});
test('Analyse all queues only unanalysed readable tracks in the filtered view', async () => {
  const states = ['not_analysed', 'stale', 'failed', 'analysed', 'queued', 'not_analysed'] as const;
  const tracks = states.map((state, index) => ({
    ...library.tracks[0], id: `track-${index}`, title: index === 5 ? 'Outside' : `Mix ${index}`,
    status: index === 4 ? 'unreadable' as const : 'ready' as const,
    analysis: { state, result: null, error: null },
  }));
  let current: Library = { ...library, tracks };
  invoke.mockImplementation((command: string, args?: { trackId: string }) => {
    if (command === 'refresh_library') return Promise.resolve(current);
    if (command === 'analyse_track') {
      current = { ...current, revision: current.revision + 1, tracks: current.tracks.map(track =>
        track.id === args?.trackId ? { ...track, analysis: { ...track.analysis, state: 'queued' } } : track) };
    }
    return Promise.resolve(current);
  });
  render(<App />);
  await screen.findByText('Mix 0');
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search music library' }), { target: { value: 'Mix' } });
  fireEvent.click(screen.getByRole('button', { name: 'Analyse all' }));
  await waitFor(() => expect(invoke.mock.calls.filter(([command]) => command === 'analyse_track')).toHaveLength(3));
  expect(invoke.mock.calls.filter(([command]) => command === 'analyse_track').map(([, args]) => args)).toEqual([
    { trackId: 'track-0' }, { trackId: 'track-1' }, { trackId: 'track-2' },
  ]);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Analyse all' }) as HTMLButtonElement).disabled).toBe(true));
});
test('Analyse all waits for room in the analysis queue', async () => {
  let attempts = 0;
  invoke.mockImplementation((command: string) => {
    if (command === 'refresh_library') return Promise.resolve(library);
    if (command === 'analyse_track' && ++attempts === 1) return Promise.reject('Analysis queue is full. Wait for a job to finish and retry.');
    return Promise.resolve(snapshot('queued', 2));
  });
  render(<App />);
  await screen.findByText('Unknown artist');
  fireEvent.click(screen.getByRole('button', { name: 'Analyse all' }));
  expect(screen.getByRole('button', { name: 'Queueing…' })).toBeTruthy();
  await waitFor(() => expect(attempts).toBe(2), { timeout: 2500 });
  expect(screen.getByText('Queued', { selector: 'span' })).toBeTruthy();
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
test('library headers sort every data column in both directions and keep missing estimates last', async () => {
  const tracks: Library['tracks'] = [
    { ...library.tracks[0], id: 'z', title: 'Zebra', artist: 'Beta', duration_seconds: 90, artwork_available: true,
      analysis: { state: 'analysed', result: { ...estimate, grid: { ...estimate.grid, bpm: 120 }, keys: [{ key: 'C', correlation: .8 }] }, error: null } },
    { ...library.tracks[0], id: 'a', title: 'Alpha', artist: 'Gamma', duration_seconds: 180, artwork_available: false,
      analysis: { state: 'failed', result: { ...estimate, grid: { ...estimate.grid, bpm: 90 }, keys: [{ key: 'A', correlation: .8 }] }, error: null } },
    { ...library.tracks[0], id: 'm', title: 'Middle', artist: 'Alpha', duration_seconds: null, artwork_available: true,
      analysis: { state: 'needs_review', result: null, error: null } },
  ];
  invoke.mockResolvedValue({ ...library, tracks });
  render(<App />);
  await screen.findByText('Middle');
  const rowTitles = () => Array.from(document.querySelectorAll('.collection-table tbody tr'), row => row.querySelector('.title')?.textContent);
  const cases: [string, string[], string[]][] = [
    ['#', ['Zebra', 'Alpha', 'Middle'], ['Middle', 'Alpha', 'Zebra']],
    ['Cover', ['Alpha', 'Zebra', 'Middle'], ['Zebra', 'Middle', 'Alpha']],
    ['Title', ['Alpha', 'Middle', 'Zebra'], ['Zebra', 'Middle', 'Alpha']],
    ['Artist', ['Middle', 'Zebra', 'Alpha'], ['Alpha', 'Zebra', 'Middle']],
    ['BPM', ['Alpha', 'Zebra', 'Middle'], ['Zebra', 'Alpha', 'Middle']],
    ['Key', ['Alpha', 'Zebra', 'Middle'], ['Zebra', 'Alpha', 'Middle']],
    ['Length', ['Zebra', 'Alpha', 'Middle'], ['Alpha', 'Zebra', 'Middle']],
    ['Analysis', ['Zebra', 'Alpha', 'Middle'], ['Middle', 'Alpha', 'Zebra']],
  ];
  for (const [column, ascending, descending] of cases) {
    const header = screen.getByRole('button', { name: `Sort by ${column}` });
    fireEvent.click(header);
    expect(rowTitles()).toEqual(ascending);
    expect(header.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(header);
    expect(rowTitles()).toEqual(descending);
    expect(header.closest('th')?.getAttribute('aria-sort')).toBe('descending');
  }
  expect(screen.getByText('1', { selector: '.track-index' }).closest('tr')?.querySelector('.title')?.textContent).toBe('Zebra');
});
test('actions header groups rows by availability', async () => {
  invoke.mockResolvedValue({ ...library, tracks: [
    { ...library.tracks[0], id: 'ready-1', title: 'Ready one' },
    { ...library.tracks[0], id: 'unavailable', title: 'Unavailable', status: 'unsupported' },
    { ...library.tracks[0], id: 'ready-2', title: 'Ready two' },
  ] });
  render(<App />);
  await screen.findByText('Unavailable');
  const rowTitles = () => Array.from(document.querySelectorAll('.collection-table tbody tr'), row => row.querySelector('.title')?.textContent);
  const header = screen.getByRole('button', { name: 'Sort by Actions' });
  fireEvent.click(header);
  expect(rowTitles()).toEqual(['Unavailable', 'Ready one', 'Ready two']);
  fireEvent.click(header);
  expect(rowTitles()).toEqual(['Ready one', 'Ready two', 'Unavailable']);
});
test('library selection follows arrows, scrolls into view and follows filtered results', async () => {
  const tracks = ['Alpha', 'Beta', 'Gamma'].map((title, index) => ({
    ...library.tracks[0], id: String(index + 1), title, filename: `${title}.wav`, artist: `Artist ${title}`,
  }));
  invoke.mockResolvedValue({ ...library, tracks });
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  render(<App />);
  await screen.findByText('Gamma');
  await waitFor(() => expect(screen.getByText('Alpha').closest('tr')?.getAttribute('aria-selected')).toBe('true'));

  fireEvent.keyDown(window, { key: 'ArrowDown' });
  await waitFor(() => expect(screen.getByText('Beta').closest('tr')?.getAttribute('aria-selected')).toBe('true'));
  expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });

  fireEvent.keyDown(window, { key: 'g' });
  const search = screen.getByRole('searchbox', { name: 'Search music library' }) as HTMLInputElement;
  expect(search.value).toBe('g');
  expect(document.activeElement).toBe(search);
  await waitFor(() => expect(screen.getByText('Gamma').closest('tr')?.getAttribute('aria-selected')).toBe('true'));
  expect(screen.queryByText('Beta')).toBeNull();
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});
test('space does not start a library search', async () => {
  invoke.mockResolvedValue(library);
  render(<App />);
  await screen.findByText('Unknown artist');
  const search = screen.getByRole('searchbox', { name: 'Search music library' }) as HTMLInputElement;

  fireEvent.keyDown(window, { key: ' ' });
  expect(search.value).toBe('');
  expect(document.activeElement).not.toBe(search);
});
test('space plus an arrow toggles the corresponding loaded deck', async () => {
  invoke.mockResolvedValue(library);
  audioInvoke.mockImplementation((command: string) => Promise.resolve(command === 'get_audio_state' ? {
    running: true, error: null, telemetry: {}, decks: [0, 1].map(deck => ({
      deck, loading: false, error: null,
      track: { track_id: `loaded-${deck}`, artifact_id: `artifact-${deck}`, title: 'Loaded', artist: '', filename: '', duration_seconds: 1, frames: 1, peak_frames: 0, peaks: [] },
      position_seconds: 0, playing: deck === 1, gain: .8, generation: deck + 1, requested_generation: deck + 1,
    })),
  } : undefined));
  render(<App />);
  await screen.findByText('Unknown artist');

  const fader = screen.getByRole('slider', { name: 'Volume deck A' });
  act(() => { fader.focus(); });
  expect(document.activeElement).not.toBe(fader);
  fireEvent.keyDown(fader, { key: ' ' });
  fireEvent.keyDown(fader, { key: 'ArrowLeft' });
  fireEvent.keyUp(window, { key: ' ' });
  fireEvent.keyDown(window, { key: 'ArrowRight' });

  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('deck_control', { deck: 0, action: 'play_pause', value: null, generation: 1 }));
  expect(audioInvoke).not.toHaveBeenCalledWith('deck_control', expect.objectContaining({ deck: 1, action: 'pause' }));
  const dial = screen.getByRole('slider', { name: 'High EQ deck B' });
  act(() => { dial.focus(); });
  expect(document.activeElement).not.toBe(dial);
  fireEvent.keyDown(dial, { key: ' ' });
  fireEvent.keyDown(dial, { key: 'ArrowRight' });
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('deck_control', { deck: 1, action: 'play_pause', value: null, generation: 2 }));
});
test('command arrows load the selected track only onto a stopped target deck', async () => {
  invoke.mockResolvedValue(library);
  audioInvoke.mockImplementation((command: string) => Promise.resolve(command === 'get_audio_state' ? {
    running: true, error: null, telemetry: {}, decks: [0, 1].map(deck => ({
      deck, loading: false, error: null, track: null, position_seconds: 0, playing: deck === 1, gain: .8, generation: 0, requested_generation: 0,
    })),
  } : undefined));
  render(<App />);
  await screen.findByText('Unknown artist');
  await waitFor(() => expect(screen.getByText('Artist - Filename', { selector: 'span' }).closest('tr')?.getAttribute('aria-selected')).toBe('true'));

  fireEvent.keyDown(window, { key: 'ArrowLeft', metaKey: true });
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('load_track', { deck: 0, trackId: 'one', preserveLock: true, resetMixer: true }));
  fireEvent.keyDown(window, { key: 'ArrowRight', metaKey: true });
  expect(audioInvoke.mock.calls.filter(([command]) => command === 'load_track')).toHaveLength(1);
});
test('timing shortcuts use the last touched rolling waveform with the panel closed', async () => {
  const tracks = [0, 1].map(deck => ({ ...library.tracks[0], id: `loaded-${deck}`, analysis: { state: 'needs_review' as const, result: estimate, error: null } }));
  const current = { ...library, tracks };
  invoke.mockImplementation((command: string, args?: { trackId?: string; grid?: unknown; referenceBeats?: number[] }) => {
    if (command === 'timing_waveform') return Promise.resolve({ artifact_id: `artifact-${args?.trackId}`, fine_peaks: [], fine_peak_frames: 0 });
    if (command === 'track_timing') return Promise.resolve({ grid: args?.grid ?? { bpm: 120, downbeat_seconds: 0, reviewed: false }, reference_beats: args?.referenceBeats ?? [] });
    if (command === 'approve_track_analysis') return Promise.resolve({ ...current, revision: 2, tracks: tracks.map(track => track.id === args?.trackId ? { ...track, analysis: { ...track.analysis, state: 'approved' } } : track) });
    return Promise.resolve(current);
  });
  audioInvoke.mockImplementation((command: string) => Promise.resolve(command === 'get_audio_state' ? {
    running: true, error: null, telemetry: {}, decks: [0, 1].map(deck => ({
      deck, loading: false, error: null, track: { track_id: `loaded-${deck}`, artifact_id: `artifact-${deck}`, title: 'Loaded', artist: '', filename: '', duration_seconds: 100, frames: 4800000, peak_frames: 0, peaks: [] },
      grid: { bpm: 120, downbeat_seconds: 0, reviewed: false }, position_seconds: 12, playing: false, gain: .8, generation: 1, requested_generation: 1,
    })),
  } : undefined));
  render(<App />);
  await screen.findAllByText('Needs review');
  expect(document.querySelectorAll('.deck-badge.active')).toHaveLength(2);
  expect(document.querySelectorAll('.deck-0 .deck-badge.active')).toHaveLength(2);
  fireEvent.pointerDown(screen.getByRole('img', { name: 'Rolling waveform deck B' }));
  expect(document.querySelectorAll('.deck-1 .deck-badge.active')).toHaveLength(2);
  expect(document.querySelectorAll('.deck-0 .deck-badge.active')).toHaveLength(0);
  fireEvent.keyDown(window, { key: 'b', metaKey: true });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('track_timing', expect.objectContaining({ trackId: 'loaded-1', referenceBeats: [12] })));
  fireEvent.keyDown(window, { key: 'ArrowRight', metaKey: true, shiftKey: true });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('apply_timing', expect.objectContaining({ deck: 1, grid: expect.objectContaining({ downbeat_seconds: .5 }) })));
  fireEvent.keyDown(screen.getByRole('slider', { name: 'Waveform seek deck B' }), { key: 'ArrowLeft', metaKey: true, shiftKey: true });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('apply_timing', expect.objectContaining({ deck: 1, grid: expect.objectContaining({ downbeat_seconds: 0 }) })));
  fireEvent.keyDown(window, { key: 'a', metaKey: true, shiftKey: true });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('approve_track_analysis', { trackId: 'loaded-1' }));
  await screen.findAllByText('Approved');
  expect(audioInvoke.mock.calls.filter(([command]) => command === 'load_track')).toHaveLength(0);
});
test('command shift A approves the playing deck without enabling beat edits', async () => {
  const track = { ...library.tracks[0], id: 'playing-track', analysis: { state: 'needs_review' as const, result: estimate, error: null } };
  const current = { ...library, tracks: [track] };
  invoke.mockImplementation((command: string, args?: { trackId?: string }) => {
    if (command === 'timing_waveform') return Promise.resolve({ artifact_id: 'playing-artifact', fine_peaks: [], fine_peak_frames: 0 });
    if (command === 'track_timing') return Promise.resolve({ grid: { bpm: 120, downbeat_seconds: 0, reviewed: false }, reference_beats: [] });
    if (command === 'approve_track_analysis') return Promise.resolve({ ...current, revision: 2, tracks: [{ ...track, analysis: { ...track.analysis, state: 'approved' } }] });
    return Promise.resolve(current);
  });
  audioInvoke.mockImplementation((command: string) => Promise.resolve(command === 'get_audio_state' ? {
    running: true, error: null, telemetry: {}, decks: [0, 1].map(deck => ({
      deck, loading: false, error: null, track: deck === 1 ? { track_id: 'playing-track', artifact_id: 'playing-artifact', title: 'Playing', artist: '', filename: '', duration_seconds: 100, frames: 4800000, peak_frames: 0, peaks: [] } : null,
      grid: deck === 1 ? { bpm: 120, downbeat_seconds: 0, reviewed: false } : null,
      position_seconds: 12, playing: deck === 1, gain: .8, generation: 1, requested_generation: 1,
    })),
  } : undefined));
  render(<App />);
  await screen.findByRole('button', { name: 'Pause deck B' });
  fireEvent.pointerDown(screen.getByRole('img', { name: 'Rolling waveform deck B' }));
  fireEvent.keyDown(window, { key: 'b', metaKey: true });
  fireEvent.keyDown(window, { key: 'ArrowRight', metaKey: true, shiftKey: true });
  fireEvent.keyDown(window, { key: 'a', metaKey: true, shiftKey: true });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('approve_track_analysis', { trackId: 'playing-track' }));
  expect(invoke.mock.calls.filter(([command, args]) => command === 'apply_timing' || command === 'track_timing' && args?.grid != null)).toHaveLength(0);
});
test('deck membership marks only the row index while selection highlights the row', async () => {
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'timing_waveform' ? { artifact_id: 'artifact-0', fine_peaks: [], fine_peak_frames: 0 } : library));
  audioInvoke.mockImplementation((command: string) => Promise.resolve(command === 'get_audio_state' ? {
    running: true, error: null, telemetry: {}, decks: [0, 1].map(deck => ({
      deck, loading: false, error: null,
      track: { track_id: 'one', artifact_id: `artifact-${deck}`, title: 'Loaded', artist: '', filename: '', duration_seconds: 1, frames: 1, peak_frames: 0, peaks: [] },
      position_seconds: 0, playing: false, gain: .8, generation: 0, requested_generation: 0,
    })),
  } : undefined));
  render(<App />);
  const index = await screen.findByText('1', { selector: '.track-index' });
  expect(index.classList.contains('on-deck-a')).toBe(true);
  expect(index.classList.contains('on-deck-b')).toBe(true);
  expect(index.closest('tr')?.classList.contains('loaded-track')).toBe(false);
  await waitFor(() => expect(index.closest('tr')?.classList.contains('selected-track')).toBe(true));
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
test('Alt arrows select the active deck and Cmd L locks that deck without toggling off', async () => {
  invoke.mockResolvedValue(library);
  audioInvoke.mockImplementation((command: string) => Promise.resolve(command === 'get_audio_state' ? {
    running: true, error: null, telemetry: {}, decks: [0, 1].map(deck => ({
      deck, loading: false, error: null,
      track: { track_id: `loaded-${deck}`, artifact_id: `artifact-${deck}`, title: 'Loaded', artist: '', filename: '', duration_seconds: 100, frames: 4800000, peak_frames: 0, peaks: [] },
      grid: { bpm: 120, downbeat_seconds: 0, reviewed: false }, synced: deck === 1,
      position_seconds: 12, playing: deck === 1, gain: .8, generation: deck + 1, requested_generation: deck + 1,
    })),
  } : undefined));
  render(<App />);
  await screen.findByRole('button', { name: 'Pause deck B' });
  fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
  expect(document.querySelectorAll('.deck-1 .deck-badge.active')).toHaveLength(2);
  fireEvent.keyDown(window, { key: 'l', metaKey: true });
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('deck_control', { deck: 1, action: 'sync', value: 1, generation: 2 }));
  fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
  expect(document.querySelectorAll('.deck-0 .deck-badge.active')).toHaveLength(2);
  fireEvent.keyDown(window, { key: 'L', metaKey: true });
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('deck_control', { deck: 0, action: 'sync', value: 1, generation: 1 }));
  const calls = audioInvoke.mock.calls.filter(([command, args]) => command === 'deck_control' && args.action === 'sync');
  fireEvent.keyDown(window, { key: 'l', metaKey: true, repeat: true });
  fireEvent.keyDown(window, { key: 'l', metaKey: true, shiftKey: true });
  const search = screen.getByRole('searchbox');
  fireEvent.keyDown(search, { key: 'ArrowRight', altKey: true });
  fireEvent.keyDown(search, { key: 'l', metaKey: true });
  expect(document.querySelectorAll('.deck-0 .deck-badge.active')).toHaveLength(2);
  expect(audioInvoke.mock.calls.filter(([command, args]) => command === 'deck_control' && args.action === 'sync')).toEqual(calls);
  expect(audioInvoke.mock.calls.some(([command]) => command === 'load_track')).toBe(false);
});
test('Cmd L does not lock an empty active deck or fall back to the other deck', async () => {
  invoke.mockResolvedValue(library);
  render(<App />);
  await screen.findByText('Unknown artist');
  fireEvent.keyDown(window, { key: 'l', metaKey: true });
  expect(audioInvoke.mock.calls.some(([command, args]) => command === 'deck_control' && args.action === 'sync')).toBe(false);
});
test('Shortcuts sits to the right of Settings and lists workspace and local keyboard controls', async () => {
  invoke.mockResolvedValue(library);
  render(<App />);
  await screen.findByText('Unknown artist');
  const tab = screen.getByRole('button', { name: 'SHORTCUTS' });
  expect(screen.getByRole('button', { name: 'SETTINGS' }).nextElementSibling).toBe(tab);
  fireEvent.click(tab);
  expect(screen.getByRole('heading', { name: 'Shortcuts' })).toBeTruthy();
  expect(tab.getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('table', { name: 'App keyboard shortcuts' })).toBeTruthy();
  for (const key of ['Alt + ←', 'Alt + →', 'Cmd + L', 'Hold Space + ←', 'Hold Space + →', 'Cmd + B', 'Cmd + Shift + A', 'Shift + ← / →']) expect(screen.getByText(key)).toBeTruthy();
  fireEvent.keyDown(window, { key: 'l', metaKey: true });
  expect(audioInvoke.mock.calls.some(([command, args]) => command === 'deck_control' && args.action === 'sync')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'DECKS' }));
  expect(screen.getByRole('searchbox')).toBeTruthy();
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
test('track loading preferences are independent and persist across loads', async () => {
  invoke.mockResolvedValue(library);
  render(<App />);
  await screen.findByText('Unknown artist');
  fireEvent.click(screen.getByRole('button', { name: 'SETTINGS' }));
  const lock = screen.getByRole('checkbox', { name: 'Keep deck locked when loading a track' }) as HTMLInputElement;
  const mixer = screen.getByRole('checkbox', { name: 'Reset gain, EQ and filter when loading a track' }) as HTMLInputElement;
  expect(lock.checked).toBe(true);
  expect(mixer.checked).toBe(true);
  fireEvent.click(lock);
  expect(mixer.checked).toBe(true);
  fireEvent.click(mixer);
  expect(localStorage.getItem('vira.preserve-lock-on-load')).toBe('false');
  expect(localStorage.getItem('vira.reset-mixer-on-load')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'DECKS' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load Artist - Filename on deck A' }));
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('load_track', { deck: 0, trackId: 'one', preserveLock: false, resetMixer: false }));
  localStorage.removeItem('vira.preserve-lock-on-load');
  localStorage.removeItem('vira.reset-mixer-on-load');
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

test('crossfader visibility persists and hiding bypasses the native fader', async () => {
  localStorage.removeItem('vira.show-crossfader');
  invoke.mockResolvedValue(library);
  const { unmount } = render(<App />);
  await screen.findByText('Unknown artist');
  expect(screen.getByRole('slider', { name: 'Crossfader' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'SETTINGS' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Show crossfader' }));
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('deck_control', expect.objectContaining({ action: 'crossfader_enabled', value: 0 })));
  expect(localStorage.getItem('vira.show-crossfader')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'DECKS' }));
  expect(screen.queryByRole('slider', { name: 'Crossfader' })).toBeNull();
  unmount();
  render(<App />);
  expect(screen.queryByRole('slider', { name: 'Crossfader' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'SETTINGS' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Show crossfader' }));
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('deck_control', expect.objectContaining({ action: 'crossfader_enabled', value: 1 })));
  localStorage.removeItem('vira.show-crossfader');
});
