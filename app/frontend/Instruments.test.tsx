// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Patches } from './Patches';
import { Instruments } from './Instruments';
import type { Instrument } from './instrumentModel';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(() => { cleanup(); invoke.mockReset(); localStorage.clear(); });
function setup(items: Instrument[] = []) {
  invoke.mockImplementation(command => Promise.resolve(command === 'get_instruments' ? items : command === 'get_instrument_devices' ? {inputs:[{id:'Interface', name:'Interface', channels:8}], outputs:[{id:'Interface', name:'Interface', channels:8}]} : command === 'patterns_state' ? {inputs:[{id:41,name:'Keyboard'}], outputs:[{id:42,name:'Synth'}]} : undefined));
  render(<Instruments />);
}
test('restores the selected instrument after leaving and returning, with a fallback if removed', async () => {
  const items: Instrument[] = ['First', 'Second'].map(name => ({id:name, name, audio_input:null, audio_output:null, midi_input:null, midi_output:null}));
  setup(items);
  await screen.findByLabelText('Instrument name');
  fireEvent.click(screen.getByRole('button', {name:'Second'}));
  cleanup();
  setup(items);
  await waitFor(() => expect((screen.getByLabelText('Instrument name') as HTMLInputElement).value).toBe('Second'));
  expect(screen.getByRole('button', {name:'Second'}).className).toBe('active');
  cleanup();
  setup([items[0]]);
  await waitFor(() => expect((screen.getByLabelText('Instrument name') as HTMLInputElement).value).toBe('First'));
});
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


test('MIDI sync options default off, save independently and survive device changes', async () => {
  setup([{id:'synth',name:'Synth',audio_input:null,audio_output:null,midi_input:null,midi_output:{device:42,channel:7}}]);
  await screen.findByLabelText('Instrument name');
  const clock = screen.getByRole('checkbox', {name:'Send MIDI clock'}) as HTMLInputElement;
  const transport = screen.getByRole('checkbox', {name:'Send transport messages'}) as HTMLInputElement;
  expect(clock.checked).toBe(false);
  expect(transport.checked).toBe(false);
  expect(screen.queryByLabelText('Transport play interval')).toBeNull();
  fireEvent.click(clock);
  fireEvent.click(transport);
  const interval = screen.getByLabelText('Transport play interval') as HTMLSelectElement;
  expect(interval.value).toBe('1');
  expect(Array.from(interval.options).map(o => o.value)).toEqual(['1','2','4','16','32']);
  fireEvent.change(interval, {target:{value:'16'}});
  fireEvent.change(screen.getByLabelText('MIDI output channel'), {target:{value:'3'}});
  fireEvent.click(screen.getByText('Save instruments'));
  await screen.findByText('All changes saved');
  expect(invoke).toHaveBeenCalledWith('save_instruments', {items:[expect.objectContaining({midi_output:{device:42,channel:3,send_clock:true,send_transport:true,transport_bars:16}})]});
  fireEvent.click(clock);
  expect(transport.checked).toBe(true);
  fireEvent.click(screen.getByText('Revert edits'));
  expect(clock.checked).toBe(true);
  expect((screen.getByLabelText('Transport play interval') as HTMLSelectElement).value).toBe('16');
  fireEvent.click(transport);
  expect(screen.queryByLabelText('Transport play interval')).toBeNull();
  fireEvent.click(transport);
  expect((screen.getByLabelText('Transport play interval') as HTMLSelectElement).value).toBe('16');
  fireEvent.change(screen.getByLabelText('MIDI output device'), {target:{value:'0'}});
  expect(clock.disabled).toBe(true);
  expect(transport.disabled).toBe(true);
});

test('instrument pin toggle persists independently of instrument edits', async () => {
  setup([{id:'synth',name:'Synth',audio_input:null,audio_output:null,midi_input:null,midi_output:null}]);
  const pin = await screen.findByRole('button', {name:'Pin instrument'});
  expect(pin.previousElementSibling?.textContent).toBe('Delete instrument');
  fireEvent.click(pin);
  expect(pin.getAttribute('aria-pressed')).toBe('true');
  expect(JSON.parse(localStorage.getItem('vira.pinned-components')!)).toEqual(['instrument:synth']);
  expect(invoke).not.toHaveBeenCalledWith('save_instruments', expect.anything());
  cleanup();
  setup([{id:'synth',name:'Synth',audio_input:null,audio_output:null,midi_input:null,midi_output:null}]);
  expect((await screen.findByRole('button', {name:'Pin instrument'})).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', {name:'Pin instrument'}));
  expect(JSON.parse(localStorage.getItem('vira.pinned-components')!)).toEqual([]);
});

test('pinned timing changes preserve the latest instrument connections', async () => {
  const item: Instrument = {id:'synth',name:'Synth',audio_input:null,audio_output:null,midi_input:null,midi_output:null};
  localStorage.setItem('vira.pinned-components',JSON.stringify(['instrument:synth']));
  let items = [item];
  invoke.mockImplementation((cmd,args) => { if (cmd === 'get_instruments') return Promise.resolve(items); if (cmd === 'save_instruments') items = args.items; return Promise.resolve([]); });
  render(<Patches />);
  const timing = await screen.findByRole('slider',{name:'Synth timing advance'});
  items = [{...item,midi_output:{device:42,channel:2}}];
  for (let i = 0; i < 35; i++) fireEvent.keyDown(timing,{key:'ArrowUp'});
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('save_instruments',{items:[{...items[0],advance_ms:35}]}));
});
