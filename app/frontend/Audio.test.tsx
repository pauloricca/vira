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
test('manual refresh updates connected devices without replacing pending output selections', async () => {
  invoke.mockResolvedValue(inventory);
  render(<Audio audio={audio} />);
  await screen.findAllByRole('option', { name: 'Headphones' });
  const cue = screen.getByLabelText('Cue headphones device') as HTMLSelectElement;
  fireEvent.change(cue, { target: { value: 'Headphones' } });
  invoke.mockResolvedValue({ ...inventory, devices: [{ id: 'USB', name: 'USB interface', supported: true }] });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh audio devices' }));
  await screen.findAllByRole('option', { name: 'USB interface' });
  expect(screen.queryAllByRole('option', { name: 'Speakers' })).toHaveLength(0);
  expect(cue.value).toBe('Headphones');
  expect(screen.getByRole('option', { name: 'Headphones · disconnected' })).toBeTruthy();
  expect(invoke).not.toHaveBeenCalledWith('set_audio_devices', expect.anything());
});

test('44.1 kHz selection explains restart and only permits cue devices at the same rate', async () => {
  invoke.mockResolvedValue({ ...inventory, sample_rate: 48000, devices: [
    { id: 'Speakers', name: 'Speakers', supported: true, sample_rate: 48000, rate_ranges: [[2, 44100, 96000]] },
    { id: 'Starlight', name: 'DJControl Starlight', supported: true, sample_rate: 44100, rate_ranges: [[4, 44100, 44100]] },
    { id: '48 only', name: '48 only', supported: true, sample_rate: 48000, rate_ranges: [[2, 48000, 48000]] },
  ] });
  render(<Audio audio={{ ...audio, telemetry: { sample_rate: 48000 } }} />);
  const master = screen.getByLabelText('Master out device');
  await screen.findAllByRole('option', { name: 'DJControl Starlight · 44.1 kHz' });
  fireEvent.change(master, { target: { value: 'Starlight' } });
  expect(screen.getByText(/Changing to 44.1 kHz restarts VIRA/)).toBeTruthy();
  expect((screen.getByRole('option', { name: '48 only · unavailable at 44.1 kHz' }) as HTMLOptionElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Apply outputs & restart VIRA' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('set_audio_devices', { master: 'Starlight', cue: null }));
});
