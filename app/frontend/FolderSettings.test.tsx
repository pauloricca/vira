// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { FolderSettings } from './FolderSettings';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(() => { cleanup(); invoke.mockReset(); });
const paths = { music: '/Music', patches: '/Patches' };
const initial = { selected: paths, active: paths, restartRequired: false };
test('music folder choices apply immediately, use separate cards, and cancellation keeps them', async () => {
  const changed = { ...initial, selected: { ...paths, musicFolders: ['/Music', '/New music é'] }, restartRequired: false };
  invoke.mockResolvedValueOnce(initial).mockResolvedValueOnce(changed).mockResolvedValueOnce(null);
  const onMusicChange = vi.fn().mockResolvedValue(undefined);
  render(<FolderSettings onMusicChange={onMusicChange} />);
  await screen.findByText('/Music');
  fireEvent.click(screen.getByRole('button', { name: 'Add music folder…' }));
  await screen.findByText('/New music é');
  expect(onMusicChange).toHaveBeenCalledWith(['/Music', '/New music é']);
  expect(screen.queryByText(/Currently using/)).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('region', { name: 'Music collections settings' })).not.toBe(screen.getByRole('region', { name: 'Teia patch folder settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose Teia patch folder' }));
  await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('choose_library_folder', { kind: 'patches' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Add music folder…' }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByText('/New music é')).toBeTruthy();
});
test('failed selection retains paths and shows the host explanation', async () => {
  invoke.mockResolvedValueOnce(initial).mockRejectedValueOnce('The patch folder must be writable');
  render(<FolderSettings />);
  await screen.findByText('/Patches');
  fireEvent.click(screen.getByRole('button', { name: 'Choose Teia patch folder' }));
  expect((await screen.findByRole('alert')).textContent).toContain('must be writable');
  expect(screen.getByText('/Patches')).toBeTruthy();
  expect(screen.queryByRole('status')).toBeNull();
});

test('removing the final folder saves an empty collection list without touching files', async () => {
  invoke.mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, selected: { ...paths, musicFolders: [] }, restartRequired: false });
  render(<FolderSettings />);
  await screen.findByText('/Music');
  fireEvent.click(screen.getByRole('button', { name: 'Remove music folder /Music' }));
  await screen.findByText('No music folders. Add a folder to create a collection.');
  expect(invoke).toHaveBeenLastCalledWith('remove_music_folder', { path: '/Music' });
  expect(screen.queryByRole('status')).toBeNull();
});
