// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Instruments } from './Instruments';
import type { Instrument } from './instrumentModel';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(() => { cleanup(); invoke.mockReset(); });
function setup(items: Instrument[] = []) {
  invoke.mockImplementation(command => Promise.resolve(command === 'get_instruments' ? items : command === 'get_instrument_devices' ? {inputs:[{id:'Interface', name:'Interface', channels:8}], outputs:[{id:'Interface', name:'Interface', channels:8}]} : command === 'patterns_state' ? {inputs:[{id:41,name:'Keyboard'}], outputs:[{id:42,name:'Synth'}]} : undefined));
  render(<Instruments />);
}
test('saves a named instrument with independent audio and MIDI devices and channels', async () => {
  setup(); await waitFor(() => expect((screen.getByText('+ New instrument') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText('+ New instrument'));
  fireEvent.change(screen.getByLabelText('Instrument name'), {target:{value:'My synth'}});
  fireEvent.change(screen.getByLabelText('Audio input device'), {target:{value:'Interface'}});
  fireEvent.change(screen.getByLabelText('Audio input left channel'), {target:{value:'3'}});
  fireEvent.change(screen.getByLabelText('Audio input right channel'), {target:{value:'4'}});
  fireEvent.change(screen.getByLabelText('Audio output device'), {target:{value:'Interface'}});
  fireEvent.change(screen.getByLabelText('Audio output mode'), {target:{value:'mono'}});
  fireEvent.change(screen.getByLabelText('Audio output channel'), {target:{value:'8'}});
  fireEvent.change(screen.getByLabelText('MIDI input device'), {target:{value:'41'}});
  fireEvent.change(screen.getByLabelText('MIDI input channel'), {target:{value:'2'}});
  fireEvent.change(screen.getByLabelText('MIDI output device'), {target:{value:'42'}});
  fireEvent.change(screen.getByLabelText('Instrument timing advance'), {target:{value:'1250'}});
  fireEvent.click(screen.getByText('Save instruments'));
  await screen.findByText('All changes saved');
  expect(invoke).toHaveBeenCalledWith('save_instruments', {items:[expect.objectContaining({name:'My synth', advance_ms:1250, audio_input:{device:'Interface',channels:[3,4]}, audio_output:{device:'Interface',channels:[8]}, midi_input:{device:41,channel:2}, midi_output:{device:42,channel:null}})]});
});
test('retains disconnected selections, reports save failures, and can revert deletion', async () => {
  const item: Instrument = {id:'synth',name:'Synth',audio_input:{device:'Missing',channels:[7,8]},audio_output:null,midi_input:null,midi_output:{device:99,channel:7}};
  setup([item]); await screen.findByLabelText('Instrument name');
  expect(screen.getByText('Missing · disconnected')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Instrument name'), {target:{value:'Renamed'}});
  invoke.mockImplementation(command => command === 'save_instruments' ? Promise.reject('Disk full') : Promise.resolve());
  fireEvent.click(screen.getByText('Save instruments')); await screen.findByRole('alert');
  expect(screen.getByText('Disk full')).toBeTruthy();
  expect(screen.getByText('Unsaved changes')).toBeTruthy();
  fireEvent.click(screen.getByText('Delete instrument'));
  fireEvent.click(screen.getByText('Revert edits'));
  expect((screen.getByLabelText('Instrument name') as HTMLInputElement).value).toBe('Synth');
});

test('manual device refresh preserves instrument edits and disconnected connections', async () => {
  setup([{id:'synth',name:'Synth',audio_input:{device:'Interface',channels:[3,4]},audio_output:null,midi_input:{device:41,channel:2},midi_output:null}]);
  await screen.findByLabelText('Instrument name');
  fireEvent.change(screen.getByLabelText('Instrument name'), {target:{value:'Edited synth'}});
  invoke.mockImplementation(command => Promise.resolve(command === 'get_instrument_devices' ? {inputs:[{id:'USB',name:'USB interface',channels:2}],outputs:[]} : {inputs:[{id:44,name:'New keyboard'}],outputs:[]}));
  fireEvent.click(screen.getByRole('button', {name:'Refresh audio input devices'}));
  await screen.findByRole('option', {name:'USB interface'});
  await screen.findByRole('option', {name:'New keyboard'});
  expect((screen.getByLabelText('Instrument name') as HTMLInputElement).value).toBe('Edited synth');
  expect((screen.getByLabelText('Audio input device') as HTMLSelectElement).value).toBe('Interface');
  expect(screen.getByRole('option', {name:'Interface · disconnected'})).toBeTruthy();
  expect(screen.getByRole('option', {name:'Disconnected device (41)'})).toBeTruthy();
});
