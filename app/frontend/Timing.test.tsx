// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { TimingEditor, markers, validGrid } from './Timing';
import { RollingWaveforms, type AudioState } from './Decks';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(() => { cleanup(); invoke.mockReset(); });
const grid = { bpm: 120, downbeat_seconds: 2, reviewed: true };
test('numbering remains consistent before anchor and unsupported grids fail locally', () => {
  expect(markers(grid, 0, 2).map(m => `${m.bar}.${m.beat}`)).toEqual(['0.1','0.2','0.3','0.4','1.1']);
  expect(markers(null,0,10)).toEqual([]);
  expect(validGrid({ ...grid, bpm: NaN }, 10)).toBe(false);
  expect(validGrid({ ...grid, downbeat_seconds: 10 }, 10)).toBe(false);
});
test('reset clears reviewed assertion; saving never applies to another deck', async () => {
  const record = { grid, state: 'reviewed', suggestion: { ...grid, bpm: 100, reviewed: false }, source_hash: 'c'.repeat(64) };
  invoke.mockResolvedValue(record);
  await act(async () => render(<TimingEditor trackId="id" title="Song" duration={100} prepared={{ track_id:'id', artifact_id:'wave', title:'Song',artist:'Artist',filename:'song.wav', duration_seconds:100,frames:4800000,peak_frames:100,peaks:[] }} position={4} deck={1} generation={7} close={vi.fn()} />));
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByText('Reset to analysis suggestion'));
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  await act(async () => fireEvent.click(screen.getByText('Save timing')));
  expect(invoke.mock.calls.some(call => call[0] === 'apply_timing')).toBe(false);
  await act(async () => fireEvent.click(screen.getByText('Apply to deck')));
  expect(invoke).toHaveBeenCalledWith('apply_timing', { deck:1,generation:7,grid:{bpm:100,downbeat_seconds:2,reviewed:false} });
  fireEvent.change(screen.getByRole('spinbutton',{name:'Source BPM'}),{target:{value:'0'}});
  expect((screen.getByText('Apply to deck') as HTMLButtonElement).disabled).toBe(true);
});
test('rolling rows share output scale and keep unequal target beat spacing visible', () => {
  const deck = {deck:0,loading:false,error:null,playing:false,gain:.8,generation:1,requested_generation:1,position_seconds:5,
    track:{track_id:'id',artifact_id:'wave',title:'Song',artist:'Artist',filename:'song.wav',duration_seconds:100,frames:4800000,peak_frames:100,peaks:[],fine_peak_frames:240,fine_peaks:[]},grid:{...grid,downbeat_seconds:0},target_bpm:120,speed:1};
  const audio:AudioState = {master_bpm:120,running:true,error:null,telemetry:{},decks:[deck,{...deck,deck:1,target_bpm:96,speed:.8}]};
  const {container}=render(<RollingWaveforms audio={audio}/>);
  expect(container.querySelectorAll('.rolling-row canvas')).toHaveLength(2);
  expect(container.querySelectorAll('.rolling-playhead')).toHaveLength(2);
  expect(screen.getByText('Beat grid · 16.00 seconds output window')).toBeTruthy();
});
