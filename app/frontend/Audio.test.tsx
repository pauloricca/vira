// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Audio } from './Audio';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(() => { cleanup(); invoke.mockReset(); });
const inventory = { devices: [{ id: 'Speakers', name: 'Speakers', supported: true }, { id: 'Headphones', name: 'Headphones', supported: true }], default_device: 'Speakers', routes: { master: null, cue: null } };
const audio = { running: true, error: null, telemetry: {}, decks: [] };
test('restores output selections, prevents speaker sharing and applies separate devices', async () => {
  invoke.mockImplementation(command => Promise.resolve(command === 'get_audio_devices' ? inventory : undefined));
  render(<Audio audio={audio} />);
  const cue = screen.getByRole('combobox', { name: 'Cue headphones device' });
  await waitFor(() => expect((cue as HTMLSelectElement).disabled).toBe(false));
  fireEvent.change(cue, { target: { value: 'Speakers' } });
  expect(screen.getByRole('alert').textContent).toContain('different devices');
  expect((screen.getByRole('button', { name: 'Apply outputs' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(cue, { target: { value: 'Headphones' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply outputs' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('set_audio_devices', { master: null, cue: 'Headphones' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Apply outputs' }) as HTMLButtonElement).disabled).toBe(true));
});
test('keeps disconnected saved devices visible and allows switching cue off', async () => {
  invoke.mockResolvedValue({ ...inventory, routes: { master: 'Speakers', cue: 'Missing headphones' } });
  render(<Audio audio={{ ...audio, routing: { master: 'Speakers', cue: 'Missing headphones', cue_running: false, cue_error: 'Device disconnected' } }} />);
  await screen.findByRole('option', { name: 'Missing headphones · disconnected' });
  expect((screen.getByRole('combobox', { name: 'Cue headphones device' }) as HTMLSelectElement).value).toBe('Missing headphones');
  expect(screen.getByRole('alert').textContent).toBe('Device disconnected');
  fireEvent.change(screen.getByRole('combobox', { name: 'Cue headphones device' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply outputs' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('set_audio_devices', { master: 'Speakers', cue: null }));
});
test('device errors are shown without reporting a successful selection', async () => {
  invoke.mockImplementation(command => command === 'get_audio_devices' ? Promise.resolve(inventory) : Promise.reject('Device disconnected'));
  render(<Audio audio={audio} />);
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'Cue headphones device' }) as HTMLSelectElement).disabled).toBe(false));
  fireEvent.change(screen.getByRole('combobox', { name: 'Cue headphones device' }), { target: { value: 'Headphones' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply outputs' }));
  await screen.findByText('Device disconnected');
  expect((screen.getByRole('button', { name: 'Apply outputs' }) as HTMLButtonElement).disabled).toBe(false);
});
