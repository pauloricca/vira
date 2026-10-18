// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { App, Library, duration } from './App';
const { invoke, audioInvoke } = vi.hoisted(() => ({ invoke: vi.fn(), audioInvoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (command: string, ...args: unknown[]) => command === 'get_audio_devices' ? Promise.resolve({ devices: [], default_device: null, routes: { master: null, cue: null } }) : command === 'get_tags' ? Promise.resolve([]) : command === 'patches_state' ? Promise.resolve([]) : command === 'teia_library' ? Promise.resolve({ files: [] }) : command === 'get_path_settings' ? Promise.resolve({ selected: { music: '/fixed/music', patches: '/fixed/patches' }, active: { music: '/fixed/music', patches: '/fixed/patches' }, restartRequired: false }) : command === 'get_audio_levels' ? Promise.resolve({ running: true, decks: [0, 0], master: [0, 0] }) : ['get_audio_state', 'load_track', 'deck_control'].includes(command) ? audioInvoke(command, ...args) : invoke(command, ...args) }));
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
  await screen.findByText(/No files in this collection/);
  expect(invoke.mock.calls).toEqual([['open_library'], ['refresh_library']]);
});
test('stale analysis displays only its short status', async () => {
  const detail = 'Source or analyzer version changed. Reanalyse this file.';
  invoke.mockResolvedValue({ ...library, tracks: [{ ...library.tracks[0], analysis: { state: 'stale', result: estimate, error: detail } }] });
  render(<App />);
  await screen.findByText('Stale');
  expect(screen.queryByText(detail)).toBeNull();
  expect(screen.getByText('121')).toBeTruthy();
});
test('expanding and restoring the library preserves its search, selection and mounted panels', async () => {
  invoke.mockResolvedValue(library);
  render(<App />);
  await screen.findByText('Unknown artist');
  const libraryPanel = screen.getByRole('region', { name: 'Music library' });
  const workspace = libraryPanel.closest('main')!;
  const decks = workspace.querySelector('.decks');
  const patches = workspace.querySelector('.performance-slots');
  const search = screen.getByRole('searchbox', { name: 'Search music library' }) as HTMLInputElement;
  fireEvent.change(search, { target: { value: 'Filename' } });
  const row = screen.getByText('Unknown artist').closest('tr')!;
  fireEvent.click(row);
  const expand = screen.getByRole('button', { name: 'Expand music library' });
  expect(screen.getByRole('button', { name: 'Refresh' }).nextElementSibling).toBe(expand);
  fireEvent.click(expand);
  expect(workspace.classList.contains('library-expanded')).toBe(true);
  expect(screen.getByRole('button', { name: 'Restore library size' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('region', { name: 'Music library' })).toBe(libraryPanel);
  expect(search.value).toBe('Filename');
  expect(row.getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Restore library size' }));
  expect(workspace.classList.contains('library-expanded')).toBe(false);
  expect(workspace.querySelector('.decks')).toBe(decks);
  expect(workspace.querySelector('.performance-slots')).toBe(patches);
  expect(search.value).toBe('Filename');
  expect(row.getAttribute('aria-selected')).toBe('true');
});
test('library track actions do not open the timing dialog', async () => {
  invoke.mockResolvedValue(library);
  render(<App />);
  await screen.findByText('Unknown artist');
  fireEvent.click(screen.getByLabelText('Actions for Artist - Filename'));
  expect(screen.queryByRole('button', { name: 'Timing' })).toBeNull();
  expect(screen.queryByRole('dialog', { name: /Edit timing/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Analyse Artist - Filename' })).toBeTruthy();
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
test('startup reconnects automatically after the preparation service becomes available', async () => {
  vi.useFakeTimers();
  invoke.mockRejectedValueOnce('Service starting').mockResolvedValue(library);
  await act(async () => { render(<App />); });
  expect(screen.getByText('Service starting')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(invoke.mock.calls.filter(([command]) => command === 'open_library')).toHaveLength(2);
  expect(screen.getByText('Unknown artist')).toBeTruthy();
  expect(screen.queryByText('Library unavailable')).toBeNull();
});
test('a failed Refresh reconnects and clears its transport warning', async () => {
  vi.useFakeTimers();
  invoke.mockImplementation((command: string) => command === 'refresh_library'
    ? Promise.reject('Preparation service unavailable or scan timed out. Start the preparation service.')
    : Promise.resolve(library));
  await act(async () => { render(<App />); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); });
  expect(screen.getByText('Library unavailable')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(invoke.mock.calls.filter(([command]) => command === 'open_library')).toHaveLength(2);
  expect(screen.queryByText('Library unavailable')).toBeNull();
});
test('a restarted preparation service is reopened before replacing the library', async () => {
  vi.useFakeTimers();
  let opens = 0;
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'open_library'
    ? ++opens === 1 ? library : { ...library, instance_id: 'restarted', scan_pending: true }
    : { ...library, instance_id: 'restarted', tracks: [] }));
  await act(async () => { render(<App />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(opens).toBe(2);
  expect(screen.getByText('Unknown artist')).toBeTruthy();
  expect(screen.getByText('Verifying files…')).toBeTruthy();
  expect(screen.queryByText('Library unavailable')).toBeNull();
});
test('background Refresh reports scan errors and clears them after successful verification', async () => {
  vi.useFakeTimers();
  let current = library;
  invoke.mockImplementation(() => Promise.resolve(current));
  await act(async () => { render(<App />); });
  current = { ...library, scan_pending: true };
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); });
  expect(screen.getByText('Verifying files…')).toBeTruthy();
  current = { ...library, scan_error: 'Music folder is unavailable' };
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText('Music folder is unavailable')).toBeTruthy();
  current = library;
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.queryByText('Library unavailable')).toBeNull();
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
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'open_library' ? library : command === 'analyse_track' ? snapshot('queued', 2) : snapshot('needs_review', 3, estimate)));
  await act(async () => { render(<App />); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Analyse Artist - Filename' })); });
  expect(invoke).toHaveBeenCalledWith('analyse_track', { trackId: 'one' });
  expect(screen.getByText('Queued', { selector: 'span' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Reanalyse Artist - Filename' }) as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(invoke.mock.calls.some(([command]) => command === 'get_library_state'), JSON.stringify(invoke.mock.calls)).toBe(true), { timeout: 2500 });
  expect(screen.getByText('121')).toBeTruthy();
  expect(screen.getByText('7A / Dmin')).toBeTruthy();
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
    if (command === 'open_library' || command === 'refresh_library') return Promise.resolve(current);
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
    if (command === 'open_library' || command === 'refresh_library') return Promise.resolve(library);
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
  await screen.findByText(/No files in this collection/);
  await act(async () => { finish(snapshot('needs_review', 3, estimate)); });
  expect(screen.queryByText('D minor')).toBeNull();
});
test('older poll responses cannot replace newer queued state', async () => {
  let finish!: (value: Library) => void;
  invoke.mockImplementation((command: string) => command === 'get_library_state' ? new Promise<Library>(resolve => { finish = resolve; }) : Promise.resolve(command === 'open_library' ? library : snapshot('queued', 2)));
  await act(async () => { render(<App />); });
  await waitFor(() => expect(finish, JSON.stringify(invoke.mock.calls)).toBeTypeOf('function'), { timeout: 2500 });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Analyse Artist - Filename' })); });
  await act(async () => { finish(library); });
  expect(screen.getByText('Queued', { selector: 'span' })).toBeTruthy();
  expect(screen.queryByText(/service restarted/)).toBeNull();
});
test('successful state polling cannot hide a failed metadata Refresh', async () => {
  vi.useFakeTimers();
  let scans = 0;
  invoke.mockImplementation((command: string) => command === 'refresh_library' && ++scans >= 1 ? Promise.reject('Music bin unavailable') : Promise.resolve(library));
  await act(async () => { render(<App />); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText('Music bin unavailable')).toBeTruthy();
  expect(screen.getByText(/last successful scan/)).toBeTruthy();
});

test('master BPM is unset at startup until playback establishes it', async () => {
  invoke.mockResolvedValue(library);
  audioInvoke.mockResolvedValue({ running: true, error: null, telemetry: {}, master_bpm: null, decks: [0, 1].map(deck => ({ deck, loading: false, error: null, track: null, position_seconds: 0, playing: false, gain: .8, generation: 0, requested_generation: 0 })) });
  render(<App />);
  await screen.findByText('Unknown artist');
  expect(screen.getByLabelText('Master BPM').textContent).toBe('—');
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
  expect(screen.getByText('No tracks match your search or selected tags.')).toBeTruthy();
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
test('library polling updates corrected BPM and sorts by it even without analysis', async () => {
  vi.useFakeTimers();
  const detected = { ...library.tracks[0], analysis: { state: 'analysed' as const, result: estimate, error: null } };
  let current = { ...library, tracks: [detected, { ...library.tracks[0], id: 'two', title: 'Manual only', timing_bpm: 130 }] };
  invoke.mockImplementation(() => Promise.resolve(current));
  await act(async () => { render(<App />); });
  const bpmCell = () => screen.getByText(detected.title, { selector: '.title' }).closest('tr')!.cells[5];
  expect(bpmCell().textContent).toBe(String(Math.round(estimate.grid.bpm)));
  current = { ...current, revision: 2, tracks: [{ ...detected, timing_bpm: 140.25 }, current.tracks[1]] };
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(bpmCell().textContent).toBe('140');
  fireEvent.click(screen.getByRole('button', { name: 'Sort by BPM' }));
  const titles = () => Array.from(document.querySelectorAll('.collection-table tbody .title'), row => row.textContent);
  expect(titles()).toEqual(['Manual only', detected.title]);
  fireEvent.click(screen.getByRole('button', { name: 'Sort by BPM' }));
  expect(titles()).toEqual([detected.title, 'Manual only']);
  current = { ...current, revision: 3, tracks: [detected, current.tracks[1]] };
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(bpmCell().textContent).toBe(String(Math.round(estimate.grid.bpm)));
});
test('library compatibility indicators follow loaded deck keys and sort numerically', async () => {
  const withKey = (id: string, title: string, key: string | null): Library['tracks'][number] => ({
    ...library.tracks[0], id, title,
    analysis: { state: 'analysed', result: key ? { ...estimate, keys: [{ key, correlation: .8 }] } : null, error: null },
  });
  const tracks = [withKey('c', 'Same A', 'C major'), withKey('g', 'Adjacent A', 'G major'),
    withKey('f-sharp', 'Same B', 'F# major'), withKey('unknown', 'Unknown', null)];
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'timing_waveform'
    ? { artifact_id: 'artifact', fine_peaks: [], fine_peak_frames: 0 } : { ...library, tracks }));
  audioInvoke.mockImplementation((command: string) => Promise.resolve(command === 'get_audio_state' ? {
    running: true, error: null, telemetry: {}, decks: [0, 1].map(deck => ({
      deck, loading: false, error: null, track: { track_id: deck === 0 ? 'c' : 'f-sharp', artifact_id: `artifact-${deck}`,
        title: '', artist: '', filename: '', duration_seconds: 1, frames: 1, peak_frames: 0, peaks: [] },
      position_seconds: 0, playing: false, gain: .8, generation: 0, requested_generation: 0,
    })),
  } : undefined));
  render(<App />);
  await screen.findByText('8B / Cmaj');
  await waitFor(() => expect(screen.getByLabelText('Deck A compatibility 100%')).toBeTruthy());
  expect(screen.getByLabelText('Deck B compatibility 100%')).toBeTruthy();
  expect(screen.getByLabelText('Deck A compatibility unavailable')).toBeTruthy();
  const rowTitles = () => Array.from(document.querySelectorAll('.collection-table tbody tr'), row => row.querySelector('.title')?.textContent);
  const header = screen.getByRole('button', { name: 'Sort by A comp' });
  fireEvent.click(header);
  expect(rowTitles()).toEqual(['Same A', 'Adjacent A', 'Same B', 'Unknown']);
  expect(header.closest('th')?.getAttribute('aria-sort')).toBe('descending');
  fireEvent.click(header);
  expect(rowTitles()).toEqual(['Same B', 'Adjacent A', 'Same A', 'Unknown']);
  const bHeader = screen.getByRole('button', { name: 'Sort by B comp' });
  fireEvent.click(bHeader);
  expect(rowTitles()[0]).toBe('Same B');
  expect(bHeader.closest('th')?.getAttribute('aria-sort')).toBe('descending');
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
test('typing BPM in either deck or the master field keeps focus and leaves library search unchanged', async () => {
  invoke.mockResolvedValue(library);
  audioInvoke.mockResolvedValue({ running: true, error: null, telemetry: {}, master_bpm: 120, decks: [0, 1].map(deck => ({
    deck, loading: false, error: null,
    track: { track_id: 'one', artifact_id: `artifact-${deck}`, title: 'Loaded track', artist: '', filename: '', duration_seconds: 125, frames: 6000000, peak_frames: 0, peaks: [] },
    position_seconds: 0, playing: false, gain: .8, generation: 1, requested_generation: 1,
    grid: { bpm: 120, downbeat_seconds: 0, reviewed: false },
  })) });
  render(<App />);
  await screen.findByText('Unknown artist');
  const search = screen.getByRole('searchbox', { name: 'Search music library' }) as HTMLInputElement;
  fireEvent.change(search, { target: { value: 'Filename' } });
  for (const name of ['A', 'B']) {
    const panel = screen.getByRole('region', { name: `Timing & tempo deck ${name}` });
    const input = panel.querySelector<HTMLInputElement>('input[type="number"]')!;
    await waitFor(() => expect(input.disabled).toBe(false));
    input.focus();
    for (const key of '130.5') expect(fireEvent.keyDown(input, { key })).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(search.value).toBe('Filename');
    fireEvent.change(input, { target: { value: '130.5' } });
    expect(input.value).toBe('130.5');
  }
  fireEvent.click(screen.getByLabelText('Master BPM'));
  const master = screen.getByRole('textbox', { name: 'Target master BPM' });
  for (const key of '130.5') expect(fireEvent.keyDown(master, { key })).toBe(true);
  expect(document.activeElement).toBe(master);
  expect(search.value).toBe('Filename');
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
  invoke.mockImplementation((command: string, args?: { trackId?: string; deck?: number; grid?: unknown; referenceBeats?: number[] }) => {
    if (command === 'timing_waveform') return Promise.resolve({ artifact_id: `artifact-${args?.deck}`, fine_peaks: [], fine_peak_frames: 0 });
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
  expect(document.querySelectorAll('.deck-1 .reference-beat')).toHaveLength(1);
  fireEvent.keyDown(window, { key: 'a', metaKey: true, shiftKey: true });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('approve_track_analysis', { trackId: 'loaded-1' }));
  await screen.findAllByText('Approved');
  await waitFor(() => expect(document.querySelectorAll('.deck-1 .reference-beat')).toHaveLength(0));
  fireEvent.keyDown(window, { key: 'b', metaKey: true });
  await waitFor(() => expect(invoke.mock.calls.filter(([command]) => command === 'track_timing').at(-1)?.[1]).toEqual(expect.objectContaining({ trackId: 'loaded-1', referenceBeats: [12] })));
  expect(audioInvoke.mock.calls.filter(([command]) => command === 'load_track')).toHaveLength(0);
});
test.each(['needs_review', 'stale'] as const)('solo playing %s deck supports bar shifts and approval but blocks reference beats', async state => {
  const track = { ...library.tracks[0], id: 'playing-track', analysis: { state, result: estimate, error: null } };
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
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('apply_timing', expect.objectContaining({ deck: 1, preserveSpeed: true, followClock: true, grid: expect.objectContaining({ downbeat_seconds: .5 }) })));
  expect(invoke.mock.calls.some(([command, args]) => command === 'track_timing' && args?.referenceBeats?.length)).toBe(false);
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
  audioInvoke.mockResolvedValue({ running: true, error: null, telemetry: {}, master_bpm: 123.3, decks: [0, 1].map(deck => ({ deck, loading: false, error: null, track: null, position_seconds: 0, playing: false, gain: .8, generation: 1, requested_generation: 1, synced: true, target_bpm: deck === 0 ? 110 : 130, grid: { bpm: 120, downbeat_seconds: 0, reviewed: false } })) });
  render(<App />);
  await screen.findByText('Unknown artist');
  const bpm = screen.getByLabelText('Master BPM');
  const a = screen.getByRole('button', { name: /Drift master tempo to deck A/ });
  expect(a.compareDocumentPosition(bpm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(a.textContent).toBe('A 120.0 ←');
  expect((a as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole('button', { name: /Drift master tempo to deck B/ }).textContent).toBe('→ 120.0 B');
  fireEvent.click(a, { detail: 1 });
  fireEvent.click(a, { detail: 2 });
  fireEvent.dblClick(a);
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('deck_control', { deck: 0, action: 'master_tempo', value: 120, generation: 1 }));
  await new Promise(resolve => setTimeout(resolve, 270));
  expect(audioInvoke.mock.calls.some(([command, args]) => command === 'deck_control' && args.action === 'drift')).toBe(false);
  const b = screen.getByRole('button', { name: /Drift master tempo to deck B/ });
  expect((b as HTMLButtonElement).disabled).toBe(false);
  expect(bpm.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(b);
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('deck_control', { deck: 1, action: 'drift', value: null, generation: 1 }));
});
test('header disables matching tempo targets and keeps zoom inside rolling waveforms', async () => {
  invoke.mockResolvedValue(library);
  audioInvoke.mockResolvedValue({ running: true, error: null, telemetry: {}, master_bpm: 120, decks: [0, 1].map(deck => ({ deck, loading: false, error: null, track: null, position_seconds: 0, playing: false, gain: .8, generation: 1, requested_generation: 1, grid: deck === 0 ? { bpm: 120.001, downbeat_seconds: 0, reviewed: false } : null })) });
  render(<App />);
  await screen.findByText('Unknown artist');
  for (const name of ['A', 'B']) expect((screen.getByRole('button', { name: new RegExp(`Drift master tempo to deck ${name}`) }) as HTMLButtonElement).disabled).toBe(true);
  const zoom = screen.getByRole('combobox', { name: 'Shared zoom' });
  expect(screen.getByRole('region', { name: 'Rolling waveforms' }).contains(zoom)).toBe(true);
  expect(document.querySelector('.app-header')?.contains(zoom)).toBe(false);
  expect(document.querySelector('.master-tempo')?.textContent).not.toContain('MASTER');
});
test('Alt arrows select the active deck; Cmd L locks and Cmd Shift L unlocks it', async () => {
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
  fireEvent.keyDown(window, { key: 'L', metaKey: true, shiftKey: true });
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('deck_control', { deck: 0, action: 'sync', value: 0, generation: 1 }));
  fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
  fireEvent.keyDown(window, { key: 'L', metaKey: true, shiftKey: true });
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('deck_control', { deck: 1, action: 'sync', value: 0, generation: 2 }));
  const calls = audioInvoke.mock.calls.filter(([command, args]) => command === 'deck_control' && args.action === 'sync');
  fireEvent.keyDown(window, { key: 'l', metaKey: true, repeat: true });
  fireEvent.keyDown(window, { key: 'L', metaKey: true, shiftKey: true, repeat: true });
  const search = screen.getByRole('searchbox');
  fireEvent.keyDown(search, { key: 'ArrowRight', altKey: true });
  fireEvent.keyDown(search, { key: 'l', metaKey: true });
  fireEvent.keyDown(search, { key: 'L', metaKey: true, shiftKey: true });
  expect(document.querySelectorAll('.deck-1 .deck-badge.active')).toHaveLength(2);
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
  fireEvent.click(screen.getByText('Deck playback & tempo'));
  expect(screen.getByRole('table', { name: 'Deck playback & tempo shortcuts' })).toBeTruthy();
  for (const key of ['Alt + ←', 'Alt + →', 'Cmd + L', 'Cmd + Shift + L', 'Hold Space + ←', 'Hold Space + →', 'Cmd + B', 'Cmd + Shift + A', 'Shift + ← / →']) expect(screen.getByText(key)).toBeTruthy();
  fireEvent.keyDown(window, { key: 'l', metaKey: true });
  expect(audioInvoke.mock.calls.some(([command, args]) => command === 'deck_control' && args.action === 'sync')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'DECKS' }));
  expect(screen.getByRole('searchbox')).toBeTruthy();
});
test('Settings opens from the workspace tabs without a duplicate waveform zoom control', async () => {
  invoke.mockResolvedValue(library);
  render(<App />);
  await screen.findByText('Unknown artist');
  fireEvent.click(screen.getByRole('button', { name: 'SETTINGS' }));
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
  expect(screen.getByText('/fixed/music')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByRole('button', { name: 'SETTINGS' }).getAttribute('aria-current')).toBe('page');
  expect(screen.queryByRole('heading', { name: 'Display' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Shared waveform zoom' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'DECKS' }));
  expect(screen.getByRole('combobox', { name: 'Shared zoom' })).toBeTruthy();
  expect(screen.getByRole('table')).toBeTruthy();
});
test('beat-grid loop alignment defaults on and can be saved in Settings', () => {
  localStorage.removeItem('vira.align-loops');
  localStorage.removeItem('vira.snap-loop-points');
  invoke.mockResolvedValue(library);
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'SETTINGS' }));
  const option = screen.getByRole('checkbox', { name: 'Align length loops to the beat grid' }) as HTMLInputElement;
  expect(option.checked).toBe(true);
  fireEvent.click(option);
  expect(option.checked).toBe(false);
  expect(localStorage.getItem('vira.align-loops')).toBe('false');
  const snap = screen.getByRole('checkbox', { name: 'Snap IN and OUT to nearest beat' }) as HTMLInputElement;
  expect(snap.checked).toBe(true);
  fireEvent.click(snap);
  expect(snap.checked).toBe(false);
  expect(localStorage.getItem('vira.snap-loop-points')).toBe('false');
  localStorage.removeItem('vira.align-loops');
  localStorage.removeItem('vira.snap-loop-points');
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
  const mixer = screen.getByRole('checkbox', { name: 'Reset volume, EQ and filter when loading a track' }) as HTMLInputElement;
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
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'Automatic transition mode' }) as HTMLSelectElement).tabIndex).toBe(-1));
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

test('Routing keeps an unapplied patch and undo history across workspace pages', async () => {
  const routing = { nodes: [{ id: 'a-player', label: 'PLAYER', kind: 'player', deck: 0, x: 40, y: 80, value: 1 }], wires: [] };
  invoke.mockImplementation(command => Promise.resolve(command === 'get_routing_graph' ? routing : library));
  render(<App />);
  await screen.findByText('Unknown artist');
  fireEvent.click(screen.getByRole('button', { name: 'ROUTING' }));
  await screen.findByRole('button', { name: 'a-player output audio' });
  fireEvent.doubleClick(screen.getByRole('button', {name:'Compressor'}));
  fireEvent.click(screen.getByRole('button', { name: 'SETTINGS' }));
  fireEvent.keyDown(window, { key: 'Backspace' });
  fireEvent.click(screen.getByRole('button', { name: 'ROUTING' }));
  expect(screen.getByRole('button', { name: /input sidechain/ })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Apply routing' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.keyDown(window, { key: 'z', metaKey: true });
  expect(screen.queryByRole('button', { name: /input sidechain/ })).toBeNull();
  expect(invoke.mock.calls.filter(([command]) => command === 'get_routing_graph')).toHaveLength(2);
  expect(invoke.mock.calls.some(([command]) => command === 'set_routing_graph')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'SHORTCUTS' }));
  for (const key of ['Delete / Backspace', 'Cmd + Z', 'Cmd + Shift + Z', 'Escape']) expect(screen.getAllByText(key).length).toBeGreaterThan(0);
});

test('deck key menus keep focus through the app focus policy and follow shifted native keys', async () => {
  let pitch = 0;
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'open_library'
    ? { ...library, tracks: [{ ...library.tracks[0], analysis: { state: 'analysed', error: null, result: { ...estimate, keys: [{ key: 'D minor', correlation: .9 }] } } }] }
    : {}));
  audioInvoke.mockImplementation((command: string, args?: { action: string; value: number }) => {
    if (command === 'deck_control' && args?.action === 'pitch') pitch = args.value;
    return Promise.resolve(command === 'get_audio_state' ? { running: true, error: null, telemetry: {}, decks: [0, 1].map(deck => ({
      deck, loading: false, error: null, track: deck === 0 ? { track_id: 'one', artifact_id: 'artifact', title: 'Song', artist: '', filename: '', duration_seconds: 1, frames: 48000, peak_frames: 0, peaks: [] } : null,
      position_seconds: 0, playing: false, gain: .8, generation: 1, requested_generation: 1, pitch_semitones: deck === 0 ? pitch : 0,
    })) } : undefined);
  });
  render(<App />);
  const trigger = await screen.findByRole('button', { name: 'Key deck A: D minor' });
  fireEvent.click(trigger);
  expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /D minor/ }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Eb minor' }));
  act(() => screen.getByRole('menuitemradio', { name: 'E minor' }).focus());
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'E minor' }));
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('deck_control', { deck: 0, action: 'pitch', value: 2, generation: 1 }));
  const shifted = await screen.findByRole('button', { name: 'Key deck A: E minor, shifted' });
  expect(shifted.textContent).toContain('E minor*');
});

test('the audition column follows the index and its button never loads a deck', async () => {
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'audition_track' ? 12 : library));
  render(<App />);
  const button = await screen.findByRole('button', { name: 'Audition Artist - Filename through cue headphones' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  expect(button.closest('td')?.previousElementSibling?.classList.contains('row-number')).toBe(true);
  fireEvent.click(button);
  fireEvent.doubleClick(button);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('audition_track', { trackId: 'one', output: 'cue' }));
  expect(screen.getByRole('group', { name: 'Library audition' })).toBeTruthy();
  expect(audioInvoke.mock.calls.some(([command]) => command === 'load_track')).toBe(false);
});

test('collection dropdown filters search and analysis while preserving the loaded deck', async () => {
  const first = { ...library.tracks[0], collection: '/fixed/music' };
  const second = { ...first, id: 'two', title: 'Second collection track', collection: '/other/Dance' };
  invoke.mockResolvedValue({ ...library, collections: ['/fixed/music', '/other/Dance', '/other/Empty'], tracks: [first, second] });
  render(<App />);
  await screen.findByText(first.title);
  audioInvoke.mockClear();
  expect(screen.queryByText(second.title)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Music collection' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dance' }));
  await screen.findByText(second.title);
  expect(screen.queryByText(first.title)).toBeNull();
  expect(localStorage.getItem('vira.collection')).toBe('/other/Dance');
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search music library' }), { target: { value: 'absent' } });
  expect(screen.queryByText(second.title)).toBeNull();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search music library' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Analyse all' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('analyse_track', { trackId: 'two' }));
  expect(invoke.mock.calls.filter(([command]) => command === 'analyse_track')).toHaveLength(1);
  expect(audioInvoke.mock.calls.some(([command]) => command === 'load_track' || command === 'deck_control')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Music collection' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Empty' }));
  expect(screen.getByText(/No files in this collection/)).toBeTruthy();
  localStorage.removeItem('vira.collection');
});

test('adding a music folder in Settings refreshes collections immediately', async () => {
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'choose_library_folder'
    ? { selected: { music: '/fixed/music', musicFolders: ['/fixed/music', '/other/Jazz'], patches: '/fixed/patches' }, active: { music: '/fixed/music', musicFolders: ['/fixed/music', '/other/Jazz'], patches: '/fixed/patches' }, restartRequired: false }
    : command === 'refresh_library' ? { ...library, collections: ['/fixed/music', '/other/Jazz'] } : library));
  render(<App />);
  await screen.findByText('Unknown artist');
  fireEvent.click(screen.getByRole('button', { name: 'SETTINGS' }));
  const add = await screen.findByRole('button', { name: 'Add music folder…' });
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(add);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('refresh_library'));
  fireEvent.click(screen.getByRole('button', { name: 'DECKS' }));
  fireEvent.click(screen.getByRole('button', { name: 'Music collection' }));
  expect(screen.getByRole('menuitemradio', { name: 'Jazz' })).toBeTruthy();
});

test('deck analysis refreshes BPM, key and grids on both loaded copies without reloading', async () => {
  let current = library;
  let applied = false;
  const grid = { bpm: estimate.grid.bpm, downbeat_seconds: estimate.grid.offset_seconds, reviewed: false };
  invoke.mockImplementation((command: string) => {
    if (command === 'timing_waveform') return Promise.resolve({ artifact_id: 'artifact', fine_peaks: [], fine_peak_frames: 0 });
    if (command === 'track_timing') return Promise.resolve({ grid: null, suggestion: current.tracks[0].analysis.result ? grid : null, reference_beats: [], state: 'unprepared' });
    if (command === 'apply_timing') { applied = true; return Promise.resolve(); }
    if (command === 'analyse_track') current = snapshot('queued', 2);
    return Promise.resolve(current);
  });
  audioInvoke.mockImplementation((command: string) => Promise.resolve(command === 'get_audio_state' ? {
    running: true, error: null, telemetry: {}, decks: [0, 1].map(deck => ({
      deck, loading: false, error: null, track: { track_id: 'one', artifact_id: 'artifact', title: 'Loaded', artist: '', filename: '', duration_seconds: 125.4, frames: 6019200, peak_frames: 0, peaks: [] },
      grid: applied ? grid : null, target_bpm: applied ? grid.bpm : undefined,
      position_seconds: 12, playing: true, gain: .8, generation: 1, requested_generation: 1,
    })),
  } : undefined));
  render(<App />);
  const button = await screen.findByRole('button', { name: 'Analyse deck A' });
  expect(button.nextElementSibling?.getAttribute('aria-label')).toBe('BPM deck A');
  fireEvent.click(button);
  await waitFor(() => expect(button.textContent).toBe('Analysing…'));
  expect((button as HTMLButtonElement).disabled).toBe(true);
  current = snapshot('needs_review', 3, estimate);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('apply_timing', { deck: 0, generation: 1, grid }), { timeout: 2500 });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('apply_timing', { deck: 1, generation: 1, grid }));
  expect(screen.queryByRole('button', { name: 'Analyse deck A' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Analyse deck B' })).toBeNull();
  expect(screen.getByLabelText('BPM deck A').textContent).toBe('121.3');
  expect(screen.getByLabelText('BPM deck B').textContent).toBe('121.3');
  expect(screen.getAllByText('7A / Dmin').length).toBeGreaterThan(0);
  expect(document.querySelector('.deck-overview .waveform path[opacity="0.25"]')).toBeTruthy();
  expect(audioInvoke.mock.calls.filter(([command]) => command === 'load_track')).toHaveLength(0);
});

test('expanded sort mode locks column sorting and persists drag order', async () => {
  localStorage.removeItem('vira.track-order');
  invoke.mockResolvedValue({ ...library, tracks: [...library.tracks, { ...library.tracks[0], id: 'two', title: 'Second song' }] });
  render(<App />);
  await screen.findByText('Second song');
  expect(screen.queryByRole('button', { name: /^Sort$/ })).toBeNull();
  fireEvent.click(screen.getByLabelText('Expand music library'));
  fireEvent.click(screen.getByRole('button', { name: /^Sort$/ }));
  expect((screen.getByLabelText('Sort by Title') as HTMLButtonElement).disabled).toBe(true);
  const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
  fireEvent.dragStart(screen.getByText('Second song').closest('tr')!, { dataTransfer: transfer });
  const dragged = screen.getByText('Second song').closest('tr')!;
  const target = screen.getAllByText('Unknown artist').find(element => element.closest('tr') !== dragged)!.closest('tr')!;
  fireEvent.dragOver(target, { dataTransfer: transfer, clientY: 0 });
  expect(dragged.parentElement!.firstElementChild).toBe(dragged);
  expect(localStorage.getItem('vira.track-order')).toBeNull();
  expect(dragged.classList.contains('track-dragging')).toBe(true);
  expect(screen.getByRole('button', { name: /^Sort$/ }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.drop(dragged, { dataTransfer: transfer });
  expect(JSON.parse(localStorage.getItem('vira.track-order')!)['/fixed/music']).toEqual(['two', 'one']);
  fireEvent.dragStart(target, { dataTransfer: transfer });
  fireEvent.dragOver(dragged, { dataTransfer: transfer, clientY: 0 });
  expect(target.parentElement!.firstElementChild).toBe(target);
  fireEvent.dragEnd(target);
  expect(dragged.parentElement!.firstElementChild).toBe(dragged);
  expect(JSON.parse(localStorage.getItem('vira.track-order')!)['/fixed/music']).toEqual(['two', 'one']);
  fireEvent.click(screen.getByRole('button', { name: /^Sort$/ }));
  expect((screen.getByLabelText('Sort by Title') as HTMLButtonElement).disabled).toBe(false);
  localStorage.removeItem('vira.track-order');
});

test('audition output uses the collection menu style only in the expanded library', async () => {
  invoke.mockResolvedValue(library);
  render(<App />);
  await screen.findByText('Unknown artist');
  expect(screen.queryByLabelText('Audition output')).toBeNull();
  fireEvent.click(screen.getByLabelText('Expand music library'));
  const trigger = screen.getByRole('button', { name: 'Audition output' });
  expect(trigger.classList.contains('collection-trigger')).toBe(true);
  fireEvent.click(trigger);
  expect(screen.getByRole('menu', { name: 'Audition outputs' }).classList.contains('collection-menu')).toBe(true);
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Play on Master' }));
  expect(trigger.textContent).toContain('Play on Master');
  fireEvent.click(screen.getByLabelText('Restore library size'));
  expect(screen.queryByLabelText('Audition output')).toBeNull();
});


test('the audition row button becomes Stop during loading and stops without loading a deck', async () => {
  let finish!: (generation: number) => void;
  invoke.mockImplementation((command: string) => command === 'audition_track'
    ? new Promise<number>(resolve => { finish = resolve; })
    : Promise.resolve(command === 'audition_control' ? undefined : library));
  render(<App />);
  const play = await screen.findByRole('button', { name: 'Audition Artist - Filename through cue headphones' });
  await waitFor(() => expect((play as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(play);
  const stop = screen.getByRole('button', { name: 'Stop auditioning Artist - Filename' });
  expect(stop.querySelector('rect')).toBeTruthy();
  fireEvent.click(stop);
  await screen.findByRole('button', { name: 'Audition Artist - Filename through cue headphones' });
  await act(async () => finish(9));
  expect(screen.queryByRole('group', { name: 'Library audition' })).toBeNull();
  expect(audioInvoke.mock.calls.some(([command]) => command === 'load_track')).toBe(false);
});

test('expanded Play All uses the shared overlap setting without a library selector', async () => {
  localStorage.setItem('vira.auto-bars', '32');
  const native = { running: true, error: null, telemetry: {}, decks: [0, 1].map(deck => ({ deck, playing: false, loading: false, track: null, generation: 0 })) };
  audioInvoke.mockImplementation((command: string) => Promise.resolve(command === 'audition_track' ? 8 : command === 'get_audio_state' ? native : undefined));
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'audition_track' ? 8 : command === 'audition_control' || command === 'queue_audition' ? undefined : library));
  const { unmount } = render(<App />);
  await screen.findByText('Unknown artist');
  expect(screen.queryByText('Play All')).toBeNull();
  fireEvent.click(screen.getByLabelText('Expand music library'));
  fireEvent.click(screen.getByRole('button', { name: 'Play All' }));
  expect(screen.queryByLabelText('Play All overlap')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Audition Artist - Filename through cue headphones' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('audition_control', expect.objectContaining({ action: 'sequence', value: 32 })));
  localStorage.removeItem('vira.auto-bars');
  unmount();
  audioInvoke.mockResolvedValue({ running: true, error: null, telemetry: {}, decks: [0, 1].map(deck => ({ deck, playing: deck === 0, loading: false, track: null, generation: 0 })) });
  render(<App />);
  await screen.findByText('Unknown artist');
  fireEvent.click(screen.getByLabelText('Expand music library'));
  expect(screen.queryByText('Play All')).toBeNull();
});

test('automatic transition settings persist overlap, mode and tempo choice and send them to the engine', async () => {
  localStorage.removeItem('vira.auto-bars');
  localStorage.removeItem('vira.auto-fast-bars');
  localStorage.removeItem('vira.auto-tempo');
  localStorage.removeItem('vira.auto-style');
  invoke.mockResolvedValue(library);
  const view = render(<App />);
  await screen.findByText('Unknown artist');
  fireEvent.click(screen.getByRole('button', { name: 'SETTINGS' }));
  const overlap = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Automatic transition overlap' });
  expect(Array.from(overlap.options).map(option => option.value)).toEqual(['0', '1', '2', '4', '8', '16', '32']);
  expect(overlap.value).toBe('8');
  const fastOverlap = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Fast transition overlap' });
  expect(fastOverlap.value).toBe('4');
  fireEvent.change(fastOverlap, { target: { value: '2' } });
  expect(localStorage.getItem('vira.auto-fast-bars')).toBe('2');
  const mode = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Automatic transition mode' });
  expect(Array.from(mode.options).map(option => option.textContent)).toEqual(['Crossfade', 'Bass swap', 'Smart']);
  expect(mode.value).toBe('crossfade');
  fireEvent.change(mode, { target: { value: 'smart' } });
  expect(localStorage.getItem('vira.auto-style')).toBe('smart');
  fireEvent.change(overlap, { target: { value: '4' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Automatic transition tempo' }), { target: { value: 'keep' } });
  expect(localStorage.getItem('vira.auto-bars')).toBe('4');
  expect(localStorage.getItem('vira.auto-tempo')).toBe('false');
  await waitFor(() => {
    expect(audioInvoke).toHaveBeenCalledWith('deck_control', expect.objectContaining({ action: 'auto_style', value: 2 }));
    expect(audioInvoke).toHaveBeenCalledWith('deck_control', expect.objectContaining({ action: 'auto_bars', value: 4 }));
    expect(audioInvoke).toHaveBeenCalledWith('deck_control', expect.objectContaining({ action: 'auto_tempo', value: 0 }));
  });
  view.unmount();
  render(<App />);
  await screen.findByText('Unknown artist');
  fireEvent.click(screen.getByRole('button', { name: 'SETTINGS' }));
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Automatic transition overlap' }).value).toBe('4');
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Fast transition overlap' }).value).toBe('2');
  localStorage.removeItem('vira.auto-fast-bars');
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Automatic transition tempo' }).value).toBe('keep');
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Automatic transition mode' }).value).toBe('smart');
  localStorage.removeItem('vira.auto-style');
  localStorage.removeItem('vira.auto-bars');
  localStorage.removeItem('vira.auto-tempo');
});


test('sessions track playback on both decks, retain history, sort and end', async () => {
  const tracks = [library.tracks[0], { ...library.tracks[0], id: 'two', title: 'Second track', artist: 'Second artist' }];
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'timing_waveform'
    ? { artifact_id: 'artifact', fine_peaks: [], fine_peak_frames: 0 } : { ...library, tracks }));
  let playing = [false, false];
  let pendingLaunch = false;
  let loaded = true;
  audioInvoke.mockImplementation((command: string) => Promise.resolve(command === 'get_audio_state' ? {
    running: true, error: null, telemetry: {}, decks: [0, 1].map(deck => ({
      deck, loading: false, error: null,
      track: loaded ? { track_id: tracks[deck].id, artifact_id: `artifact-${deck}`, title: tracks[deck].title,
        artist: '', filename: '', duration_seconds: 125, frames: 1, peak_frames: 0, peaks: [] } : null,
      position_seconds: 0, playing: playing[deck], launch_pending: deck === 1 && pendingLaunch,
      gain: .8, generation: 1, requested_generation: 1,
    })),
  } : undefined));
  render(<App />);
  await screen.findByText('Second artist');
  await waitFor(() => expect(document.querySelector('.deck-title')?.textContent).toBe(tracks[0].title));
  const row = (id: number) => screen.getByText(tracks[id].artist).closest('tr')!;
  const status = (id: number) => row(id).querySelector('.played-cell')?.textContent;
  expect(screen.queryByRole('button', { name: 'Sort by Played' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Start Session' }));
  expect([status(0), status(1)]).toEqual(['No', 'No']);
  playing = [true, true];
  pendingLaunch = true;
  await waitFor(() => expect(status(0)).toBe('Yes'));
  expect(status(1)).toBe('No');
  expect(row(0).classList.contains('played-track')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Sort by Played' }));
  expect(document.querySelector('.collection-table tbody .title')?.textContent).toBe('Second track');
  pendingLaunch = false;
  await waitFor(() => expect(status(1)).toBe('Yes'));
  playing = [false, false];
  loaded = false;
  await waitFor(() => expect(document.querySelector('.deck-title')?.textContent).toBe('No track loaded'));
  expect([status(0), status(1)]).toEqual(['Yes', 'Yes']);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false));
  expect(status(0)).toBe('Yes');
  loaded = true;
  playing = [true, false];
  await screen.findByRole('button', { name: 'Pause deck A' });
  fireEvent.click(screen.getByRole('button', { name: 'End Session' }));
  expect(screen.queryByRole('button', { name: 'Sort by Played' })).toBeNull();
  expect(row(0).classList.contains('played-track')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Start Session' }));
  expect([status(0), status(1)]).toEqual(['Yes', 'No']);
});

test('Play Next toggles plans by button and Cmd+N, renumbers and preserves order through filtering', async () => {
  const tracks = ['First', 'Second', 'Third'].map((title, index) => ({ ...library.tracks[0], id: `plan-${index}`, title, artist: `${title} artist` }));
  invoke.mockResolvedValue({ ...library, tracks });
  render(<App />);
  await screen.findByText('Third artist');
  expect(screen.queryByRole('button', { name: 'Sort by Next' })).toBeNull();
  const row = (index: number) => screen.getByText(tracks[index].artist).closest('tr')!;
  const number = (index: number) => row(index).querySelector('.next-cell')?.textContent;
  fireEvent.click(row(1));
  fireEvent.click(screen.getByRole('button', { name: 'Play Next' }));
  expect(number(1)).toBe('1');
  expect(row(1).classList.contains('next-track')).toBe(true);
  expect(screen.getByRole('button', { name: 'Cancel Play Next' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(row(0));
  fireEvent.keyDown(window, { key: 'n', metaKey: true });
  fireEvent.keyDown(window, { key: 'n', metaKey: true, repeat: true });
  fireEvent.click(row(2));
  fireEvent.keyDown(window, { key: 'N', metaKey: true });
  expect([number(0), number(1), number(2)]).toEqual(['2', '1', '3']);
  fireEvent.click(screen.getByRole('button', { name: 'Sort by Next' }));
  const titles = () => Array.from(document.querySelectorAll('.collection-table tbody .title'), element => element.textContent);
  expect(titles()).toEqual(['Second', 'First', 'Third']);
  fireEvent.click(row(0));
  fireEvent.keyDown(window, { key: 'n', metaKey: true });
  expect([number(0), number(1), number(2)]).toEqual(['—', '1', '2']);
  expect(row(0).classList.contains('next-track')).toBe(false);
  fireEvent.click(row(1));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Play Next' }));
  expect(number(2)).toBe('1');
  const search = screen.getByRole('searchbox', { name: 'Search music library' });
  fireEvent.change(search, { target: { value: 'Third' } });
  expect(number(2)).toBe('1');
  fireEvent.change(search, { target: { value: '' } });
  fireEvent.click(row(1));
  fireEvent.keyDown(window, { key: 'n', metaKey: true });
  expect(number(1)).toBe('2');
  fireEvent.click(screen.getByRole('button', { name: 'Sort by Next' }));
  expect(titles()).toEqual(['Second', 'Third', 'First']);
});

test('Cmd+N respects text fields, modifiers, dropdowns and the current page', async () => {
  invoke.mockResolvedValue(library);
  render(<App />);
  await screen.findByText('Unknown artist');
  const number = () => document.querySelector('.next-cell')?.textContent;
  const search = screen.getByRole('searchbox', { name: 'Search music library' });
  fireEvent.keyDown(search, { key: 'n', metaKey: true });
  fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
  fireEvent.keyDown(window, { key: 'N', metaKey: true, shiftKey: true });
  expect(number()).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: 'Music collection' }));
  fireEvent.keyDown(await screen.findByRole('menu', {name:'Music collections'}), { key: 'n', metaKey: true });
  expect(number()).toBeUndefined();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'SHORTCUTS' }));
  expect(screen.getByText('Cmd + N')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'n', metaKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'DECKS' }));
  expect(number()).toBeUndefined();
  fireEvent.keyDown(window, { key: 'n', metaKey: true });
  expect(number()).toBe('1');
});

test.each([0, 1])('playing a planned track on deck %i clears its marker and renumbers the remaining plans', async deckIndex => {
  const tracks = ['First', 'Second', 'Third'].map((title, index) => ({ ...library.tracks[0], id: `planned-${index}`, title, artist: `${title} artist` }));
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'timing_waveform'
    ? { artifact_id: 'artifact', fine_peaks: [], fine_peak_frames: 0 } : { ...library, tracks }));
  let playing = false;
  let launchPending = false;
  let trackIndex = 1;
  audioInvoke.mockImplementation((command: string) => Promise.resolve(command === 'get_audio_state' ? {
    running: true, error: null, telemetry: {}, decks: [0, 1].map(deck => ({
      deck, loading: false, error: null,
      track: deck === deckIndex ? { track_id: tracks[trackIndex].id, artifact_id: `artifact-${trackIndex}`, title: tracks[trackIndex].title,
        artist: '', filename: '', duration_seconds: 125, frames: 1, peak_frames: 0, peaks: [] } : null,
      position_seconds: 0, playing: deck === deckIndex && playing, launch_pending: launchPending,
      gain: .8, generation: trackIndex + 1, requested_generation: trackIndex + 1,
    })),
  } : undefined));
  render(<App />);
  await screen.findByText('Third artist');
  const row = (index: number) => screen.getByText(tracks[index].artist).closest('tr')!;
  const numbers = () => tracks.map((_, index) => row(index).querySelector('.next-cell')?.textContent);
  for (let index = 0; index < tracks.length; index++) {
    fireEvent.click(row(index));
    fireEvent.click(screen.getByRole('button', { name: 'Play Next' }));
  }
  await waitFor(() => expect(document.querySelectorAll('.deck-title')[deckIndex]?.textContent).toBe('Second'));
  expect(numbers()).toEqual(['1', '2', '3']);
  // Cover the same behavior with and without an active played-history session.
  if (deckIndex === 1) fireEvent.click(screen.getByRole('button', { name: 'Start Session' }));
  fireEvent.click(row(1));
  playing = true;
  launchPending = true;
  // Wait for an audio poll to observe the pending launch before allowing it to start.
  const calls = audioInvoke.mock.calls.filter(([command]) => command === 'get_audio_state').length;
  await waitFor(() => expect(audioInvoke.mock.calls.filter(([command]) => command === 'get_audio_state').length).toBeGreaterThan(calls));
  expect(numbers()).toEqual(['1', '2', '3']);
  launchPending = false;
  await waitFor(() => expect(numbers()).toEqual(['1', '—', '2']));
  expect(row(1).classList.contains('next-track')).toBe(false);
  expect(screen.getByRole('button', { name: 'Play Next' }).getAttribute('aria-pressed')).toBe('false');
  if (deckIndex === 1) expect(row(1).querySelector('.played-cell')?.textContent).toBe('Yes');
  // A different track playing on the same deck also consumes its plan.
  trackIndex = 0;
  await waitFor(() => expect(numbers()).toEqual(['—', '—', '1']));
  trackIndex = 2;
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Sort by Next' })).toBeNull());
  expect(document.querySelector('.next-col')).toBeNull();
  expect(document.querySelector('.next-cell')).toBeNull();
});

test('Autopilot follows the collection while ignoring search and marks its choice next', async () => {
  const current = library.tracks[0];
  const hidden = { ...current, id: 'hidden', title: 'Hidden candidate', filename: 'hidden.wav', artist: 'Candidate artist' };
  const other = { ...current, id: 'other-folder', collection: '/elsewhere', title: 'Other folder candidate' };
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'timing_waveform'
    ? { artifact_id: 'current', fine_peaks: [], fine_peak_frames: 0 } : { ...library, collections: ['/fixed/music', '/elsewhere'], tracks: [current, hidden, other] }));
  audioInvoke.mockImplementation((command: string) => Promise.resolve(command === 'get_audio_state' ? {
    running: true, error: null, telemetry: {}, auto_mode: [0, 0], decks: [0, 1].map(deck => ({
      deck, loading: false, error: null, track: deck === 0 ? { track_id: current.id, artifact_id: 'current', title: current.title,
        artist: '', filename: '', duration_seconds: 125, frames: 1, peak_frames: 0, peaks: [] } : null,
      position_seconds: 0, playing: deck === 0, gain: .8, generation: 1, requested_generation: 1,
    })),
  } : undefined));
  render(<App />);
  await screen.findByText('Candidate artist');
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search music library' }), { target: { value: current.title } });
  expect(screen.queryByText('Candidate artist')).toBeNull();
  const button = screen.getByRole('button', { name: 'Autopilot' });
  expect(screen.getByRole('button', { name: 'Play Next' }).nextElementSibling).toBe(button);
  fireEvent.click(button);
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('load_track', { deck: 1, trackId: 'hidden', preserveLock: true, resetMixer: true }));
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(button.classList.contains('auto-engaged')).toBe(true);
  expect(screen.getByRole('button', { name: 'End Session' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search music library' }), { target: { value: '' } });
  expect(screen.getByText('Candidate artist').closest('tr')!.querySelector('.next-cell')?.textContent).toBe('1');
  fireEvent.click(screen.getByRole('button', { name: 'End Session' }));
  expect(button.getAttribute('aria-pressed')).toBe('false');
});

test('Autopilot weight sliders persist independently in Settings', async () => {
  invoke.mockResolvedValue(library);
  render(<App />);
  await screen.findByText('Unknown artist');
  fireEvent.click(screen.getByRole('button', { name: 'SETTINGS' }));
  const names = ['bpm proximity', 'shared tags', 'harmonic compatibility', 'bpm direction', 'randomness'];
  names.forEach((name, index) => fireEvent.change(screen.getByRole('slider', { name: `Autopilot ${name} weight` }), { target: { value: String((index + 1) * 20) } }));
  expect(JSON.parse(localStorage.getItem('vira.autopilot-weights')!)).toEqual({ bpm: 20, tags: 40, harmonic: 60, direction: 80, randomness: 100 });
  cleanup();
  render(<App />);
  await screen.findByText('Unknown artist');
  fireEvent.click(screen.getByRole('button', { name: 'SETTINGS' }));
  names.forEach((name, index) => expect((screen.getByRole('slider', { name: `Autopilot ${name} weight` }) as HTMLInputElement).value).toBe(String((index + 1) * 20)));
  localStorage.removeItem('vira.autopilot-weights');
});

test('master BPM selects its text, applies a target on Enter and cancels on Escape or blur', async () => {
  invoke.mockResolvedValue(library);
  audioInvoke.mockResolvedValue({ running: true, error: null, telemetry: {}, master_bpm: 123.3, decks: [0, 1].map(deck => ({ deck, loading: false, track: null, position_seconds: 0, playing: false, gain: .8, generation: 1, requested_generation: 1 })) });
  render(<App />);
  await screen.findByText('Unknown artist');
  const edit = () => { fireEvent.click(screen.getByLabelText('Master BPM')); return screen.getByRole('textbox', { name: 'Target master BPM' }) as HTMLInputElement; };
  let input = edit();
  expect(document.activeElement).toBe(input);
  expect(input.value.slice(input.selectionStart!, input.selectionEnd!)).toBe('123.3');
  fireEvent.change(input, { target: { value: '130.25' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(audioInvoke).toHaveBeenCalledWith('deck_control', { deck: 0, action: 'master_target', value: 130.25, generation: 1 }));
  const targets = () => audioInvoke.mock.calls.filter(([command, args]) => command === 'deck_control' && args.action === 'master_target');
  input = edit();
  fireEvent.change(input, { target: { value: '140' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: 'Target master BPM' })).toBeNull();
  input = edit();
  fireEvent.change(input, { target: { value: '150' } });
  fireEvent.blur(input);
  expect(screen.queryByRole('textbox', { name: 'Target master BPM' })).toBeNull();
  input = edit();
  fireEvent.change(input, { target: { value: '601' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByRole('textbox', { name: 'Target master BPM' })).toBe(input);
  expect(targets()).toHaveLength(1);
});
