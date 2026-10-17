// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { App, type Library } from './App';
import { TRACK_MIME } from './Decks';
import { TRACKS_MIME, type Tag } from './Tags';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const library: Library = { schema_version: 2, revision: 1, instance_id: 'tags-test', music_bin: '/music', tracks: ['First', 'Second', 'Third'].map((title, i) => ({
  id: String(i + 1).repeat(64), title, artist: 'Artist', filename: `${title}.wav`, duration_seconds: 120, size_bytes: 100, modified_ns: '1', status: 'ready', error: null, source_hash: null, analysis: { state: 'not_analysed', result: null, error: null },
})) };
let tags: Tag[];
let failSave = false;
beforeEach(() => {
  localStorage.clear();
  tags = [{ name: 'House', tracks: [library.tracks[0].id] }, { name: 'Warm up', tracks: [library.tracks[1].id] }];
  failSave = false;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  invoke.mockImplementation(async (command: string, args?: { action: string; name: string; trackId: string; trackIds?: string[] }) => {
    if (command === 'get_tags') return tags;
    if (['update_tag', 'update_tag_tracks'].includes(command) && args) {
      if (failSave) throw new Error('Disk is full');
      tags = tags.map(tag => ({ ...tag, tracks: [...tag.tracks] }));
      if (args.action === 'create') tags.push({ name: args.name, tracks: [] });
      if (args.action === 'delete') tags = tags.filter(tag => tag.name !== args.name);
      const tag = tags.find(tag => tag.name === args.name);
      const ids = args.trackIds ?? [args.trackId];
      if (args.action === 'assign' && tag) tag.tracks = [...new Set([...tag.tracks, ...ids])];
      if (args.action === 'unassign' && tag) tag.tracks = tag.tracks.filter(id => !ids.includes(id));
      return tags;
    }
    if (['open_library', 'get_library_state', 'refresh_library'].includes(command)) return library;
    if (command === 'patches_state') return [];
    if (command === 'teia_library') return { files: [] };
    if (command === 'get_path_settings') return { selected: { music: '/music', patches: '/patches' }, active: { music: '/music', patches: '/patches' }, restartRequired: false };
    if (command === 'get_audio_levels') return { running: true, decks: [0, 0], master: [0, 0] };
    if (command === 'get_audio_state') return { running: true, telemetry: {}, decks: [0, 1].map(deck => ({ deck, loading: false, track: null, playing: false, gain: .8, generation: 0 })) };
  });
});
afterEach(() => { cleanup(); invoke.mockReset(); });
const row = (title: string) => screen.queryByText(title, { selector: '.title' });
const sidebar = () => within(screen.getByRole('complementary', { name: 'Track tags' }));
async function start() { render(<App />); await screen.findByText('Third', { selector: '.title' }); }

test('multiple tags match any selected tag and combine with search', async () => {
  await start();
  fireEvent.click(sidebar().getByRole('button', { name: 'House 1' }));
  expect(row('First')).toBeTruthy(); expect(row('Second')).toBeNull();
  fireEvent.click(sidebar().getByRole('button', { name: 'Warm up 1' }));
  expect(row('First')).toBeTruthy(); expect(row('Second')).toBeTruthy(); expect(row('Third')).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Second' } });
  expect(row('First')).toBeNull(); expect(row('Second')).toBeTruthy();
  fireEvent.click(sidebar().getByRole('button', { name: 'All 3' }));
  expect(row('First')).toBeNull(); expect(row('Second')).toBeTruthy();
});

test('create, drag to assign, and remove assignment in track actions', async () => {
  await start();
  fireEvent.change(sidebar().getByRole('textbox'), { target: { value: 'Late night' } });
  fireEvent.submit(sidebar().getByRole('textbox').closest('form')!);
  const target = await sidebar().findByRole('button', { name: 'Late night 0' });
  const data: Record<string, string> = {};
  const dataTransfer = { types: [TRACK_MIME], setData: (type: string, value: string) => { data[type] = value; }, getData: (type: string) => data[type], effectAllowed: '', dropEffect: '' };
  fireEvent.dragStart(row('First')!.closest('tr')!, { dataTransfer });
  fireEvent.drop(target.closest('.tag-row')!, { dataTransfer });
  await sidebar().findByRole('button', { name: 'Late night 1' });
  expect(tags.find(tag => tag.name === 'House')!.tracks).toContain(library.tracks[0].id);
  fireEvent.click(screen.getByLabelText('Actions for First'));
  const checkbox = within(row('First')!.closest('tr')!).getByRole('checkbox', { name: 'Late night' });
  expect((checkbox as HTMLInputElement).checked).toBe(true);
  fireEvent.click(checkbox);
  await sidebar().findByRole('button', { name: 'Late night 0' });
  expect(row('First')).toBeTruthy();
});

test('tag deletion requires confirmation, supports cancel, and leaves songs after remount', async () => {
  await start();
  fireEvent.click(sidebar().getByRole('button', { name: 'Delete tag House' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(tags).toHaveLength(2);
  fireEvent.click(sidebar().getByRole('button', { name: 'House 1' }));
  fireEvent.click(sidebar().getByRole('button', { name: 'Delete tag House' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete tag' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(row('First')).toBeTruthy(); expect(row('Second')).toBeTruthy(); expect(row('Third')).toBeTruthy();
  cleanup(); await start();
  expect(sidebar().queryByRole('button', { name: 'Delete tag House' })).toBeNull();
  expect(row('First')).toBeTruthy();
});

test('failed saves preserve tags and do not close the deletion confirmation', async () => {
  await start(); failSave = true;
  fireEvent.click(sidebar().getByRole('button', { name: 'Delete tag House' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete tag' }));
  await within(screen.getByRole('dialog')).findByText(/Disk is full/);
  expect(tags).toHaveLength(2);
  expect(row('First')).toBeTruthy();
});

const trackRow = (title: string) => row(title)!.closest('tr')!;
const isSelected = (title: string) => trackRow(title).getAttribute('aria-selected') === 'true';
const selected = () => ['First', 'Second', 'Third'].filter(title => row(title) && isSelected(title));
function dragToTag(title: string, tag: string) {
  const data: Record<string, string> = {};
  const dataTransfer = { types: [TRACK_MIME, TRACKS_MIME], setData: (type: string, value: string) => { data[type] = value; }, getData: (type: string) => data[type], effectAllowed: '', dropEffect: '' };
  fireEvent.dragStart(trackRow(title), { dataTransfer });
  fireEvent.drop(sidebar().getByRole('button', { name: tag }).closest('.tag-row')!, { dataTransfer });
  fireEvent.dragEnd(trackRow(title));
  return data;
}

test('compact Cmd and Shift selection drags the entire selection onto a tag', async () => {
  await start();
  expect(screen.queryByRole('button', { name: 'Tag tracks' })).toBeNull();
  fireEvent.click(trackRow('First'));
  fireEvent.click(trackRow('Third'), { metaKey: true });
  expect(selected()).toEqual(['First', 'Third']);
  const data = dragToTag('First', 'Warm up 1');
  expect(JSON.parse(data[TRACKS_MIME])).toEqual([library.tracks[0].id, library.tracks[2].id]);
  await sidebar().findByRole('button', { name: 'Warm up 3' });
  expect(selected()).toEqual(['First', 'Third']);
  fireEvent.click(trackRow('First'));
  fireEvent.click(trackRow('Third'), { shiftKey: true });
  expect(selected()).toEqual(['First', 'Second', 'Third']);
  fireEvent.click(trackRow('Second'), { metaKey: true });
  expect(selected()).toEqual(['First', 'Third']);
  fireEvent.click(trackRow('Second'));
  expect(selected()).toEqual(['Second']);
});

test('expanded tagging displays mixed grey ticks and applies or removes tags for all selected tracks', async () => {
  await start();
  fireEvent.click(screen.getByRole('button', { name: 'Expand music library' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tag tracks' }));
  fireEvent.click(trackRow('First'));
  fireEvent.click(trackRow('Second'), { metaKey: true });
  const house = sidebar().getByRole('checkbox', { name: 'House' }) as HTMLInputElement;
  expect(house.indeterminate).toBe(true);
  expect(house.getAttribute('aria-checked')).toBe('mixed');
  expect(house.nextElementSibling?.classList.contains('mixed')).toBe(true);
  fireEvent.click(house);
  await waitFor(() => expect(house.getAttribute('aria-checked')).toBe('true'));
  expect(tags[0].tracks).toEqual([library.tracks[0].id, library.tracks[1].id]);
  expect(selected()).toEqual(['First', 'Second']);
  fireEvent.click(house);
  await waitFor(() => expect(house.getAttribute('aria-checked')).toBe('false'));
  expect(tags[0].tracks).toEqual([]);
  fireEvent.click(trackRow('Third'), { shiftKey: true });
  expect(selected()).toEqual(['Second', 'Third']);
  expect(sidebar().getByRole('checkbox', { name: 'Warm up' }).getAttribute('aria-checked')).toBe('mixed');
  fireEvent.click(screen.getByRole('button', { name: 'Restore library size' }));
  expect(sidebar().queryByRole('checkbox')).toBeNull();
  expect(sidebar().getByRole('button', { name: 'All 3' })).toBeTruthy();
});

test('Shift range follows the current sort order, anchors repeated ranges, and prunes hidden selections', async () => {
  await start();
  fireEvent.click(screen.getByRole('button', { name: 'Sort by Title' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sort by Title' }));
  fireEvent.click(trackRow('Third'));
  fireEvent.click(trackRow('First'), { shiftKey: true });
  expect(selected()).toEqual(['First', 'Second', 'Third']);
  fireEvent.click(trackRow('Second'), { shiftKey: true });
  expect(selected()).toEqual(['Second', 'Third']);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'First' } });
  await waitFor(() => expect(selected()).toEqual(['First']));
});

test('tagging pauses the tag filter and failed bulk updates preserve every assignment', async () => {
  await start();
  fireEvent.click(sidebar().getByRole('button', { name: 'House 1' }));
  expect(row('Second')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Expand music library' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tag tracks' }));
  await screen.findByText('Third', { selector: '.title' });
  fireEvent.click(trackRow('First'));
  fireEvent.click(trackRow('Third'), { shiftKey: true });
  failSave = true;
  fireEvent.click(sidebar().getByRole('checkbox', { name: 'House' }));
  await sidebar().findByText(/Disk is full/);
  expect(tags[0].tracks).toEqual([library.tracks[0].id]);
  expect(sidebar().getByRole('checkbox', { name: 'House' }).getAttribute('aria-checked')).toBe('mixed');
  fireEvent.click(screen.getByRole('button', { name: 'Tag tracks' }));
  expect(row('Second')).toBeNull();
  expect(sidebar().getByRole('button', { name: 'House 1' }).getAttribute('aria-pressed')).toBe('true');
});

test('dragging an unselected track replaces the drag selection and helper messages are absent', async () => {
  await start();
  fireEvent.click(trackRow('First'));
  fireEvent.click(trackRow('Second'), { metaKey: true });
  const data = dragToTag('Third', 'House 1');
  expect(JSON.parse(data[TRACKS_MIME])).toEqual([library.tracks[2].id]);
  await sidebar().findByRole('button', { name: 'House 2' });
  expect(selected()).toEqual(['Third']);
  expect(screen.queryByText(/Select one or more|Create a tag|Added “/)).toBeNull();
});
