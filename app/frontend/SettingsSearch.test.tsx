// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { SettingsCard, SettingsSearchContext } from './SettingsSearch';
import { Shortcuts } from './Shortcuts';

afterEach(cleanup);

test('settings search filters individual rows, hides empty cards, and restores controls and values', () => {
  function Settings({ query }: { query: string }) {
    return <SettingsSearchContext.Provider value={query}>
      <SettingsCard><h3>Tempo</h3>
        <div className="settings-row"><strong>Master tempo drift</strong><p>Moves toward a target.</p><input aria-label="Drift rate" defaultValue="2" /></div>
        <div className="settings-row"><strong>Locked deck start</strong><select aria-label="Start boundary"><option>Beat</option><option>Bar</option></select></div>
      </SettingsCard>
      <SettingsCard><h3>Mixer</h3><div className="settings-row">Show crossfader</div></SettingsCard>
    </SettingsSearchContext.Provider>;
  }
  const { rerender } = render(<Settings query="  DRIFT  " />);
  expect(screen.getByRole('textbox', { name: 'Drift rate' })).toBeTruthy();
  expect(screen.queryByText('Locked deck start')).toBeNull();
  expect(screen.queryByText('Mixer')).toBeNull();
  rerender(<Settings query="bar" />);
  expect(screen.getByRole('combobox')).toBeTruthy();
  expect(screen.queryByText('Master tempo drift')).toBeNull();
  rerender(<Settings query="missing term" />);
  expect(screen.queryByRole('heading')).toBeNull();
  rerender(<Settings query=" " />);
  expect(screen.getAllByRole('heading')).toHaveLength(2);
  expect((screen.getByRole('textbox', { name: 'Drift rate' }) as HTMLInputElement).value).toBe('2');
});

test('settings search includes new dynamic device rows', () => {
  function Devices({ names }: { names: string[] }) {
    return <SettingsSearchContext.Provider value="synth"><SettingsCard><h3>MIDI controllers</h3>{names.map(name => <label className="settings-row" key={name}>{name}<input type="checkbox" /></label>)}</SettingsCard></SettingsSearchContext.Provider>;
  }
  const { rerender } = render(<Devices names={['Keyboard']} />);
  expect(screen.queryByRole('heading')).toBeNull();
  rerender(<Devices names={['Keyboard', 'Synth']} />);
  expect(screen.getByText('Synth')).toBeTruthy();
  expect(screen.queryByText('Keyboard')).toBeNull();
});

test('shortcuts search matches actions and availability, expands results, and hides empty categories', () => {
  render(<Shortcuts />);
  const search = screen.getByRole('searchbox', { name: 'Search shortcuts' });
  expect(search.closest('.settings-heading')).toBeTruthy();
  fireEvent.change(search, { target: { value: '  PIN ANY BEAT  ' } });
  expect(screen.getByText('Track timing & analysis').closest('details')?.open).toBe(true);
  expect(screen.getByText(/Pin any beat as the scaling centre/)).toBeTruthy();
  expect(screen.queryByText('Library & collections')).toBeNull();
  expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
  fireEvent.change(search, { target: { value: 'New tag name field' } });
  expect(screen.getByText('Create a tag')).toBeTruthy();
  fireEvent.change(search, { target: { value: 'unfindable search term' } });
  expect(screen.getByRole('status').textContent).toBe('No shortcuts match your search.');
  expect(document.querySelector('details')).toBeNull();
  fireEvent.change(search, { target: { value: '' } });
  expect(screen.getByText('Library & collections')).toBeTruthy();
  expect(document.querySelector('details')?.open).toBe(false);
});
