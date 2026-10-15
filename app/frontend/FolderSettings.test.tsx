// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { FolderSettings } from './FolderSettings';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(() => { cleanup(); invoke.mockReset(); });
const paths = { music: '/Music', patches: '/Patches' };
const initial = { selected: paths, active: paths, restartRequired: false };
test('folder choices persist, display pending paths, and cancellation keeps them', async () => {
  const changed = { ...initial, selected: { ...paths, music: '/New music é' }, restartRequired: true };
  invoke.mockResolvedValueOnce(initial).mockResolvedValueOnce(changed).mockResolvedValueOnce(null);
  render(<FolderSettings />);
  await screen.findByText('/Music');
  fireEvent.click(screen.getByRole('button', { name: 'Choose music folder' }));
  await screen.findByText('/New music é');
  expect(screen.getByRole('status').textContent).toContain('Quit and reopen');
  expect(screen.getByText('Currently using: /Music')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Choose Teia patch folder' }));
  await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('choose_library_folder', { kind: 'patches' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Choose music folder' }) as HTMLButtonElement).disabled).toBe(false));
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
