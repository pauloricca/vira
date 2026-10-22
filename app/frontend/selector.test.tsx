// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { selectorLabel, selectorPorts, SelectorControl } from './selector';
afterEach(cleanup);
test('labels continue past Z and spare pins survive holes and empty selections', () => {
  expect([0,25,26,27,51,52].map(selectorLabel)).toEqual(['A','Z','AA','AB','AZ','BA']);
  expect(selectorPorts(['A','B'])).toEqual(['A','B','C']);
  expect(selectorPorts(['C'])).toEqual(['A','B','C','D']);
  expect(selectorPorts([], 'B')).toEqual(['A','B']);
});
test('pinned buttons and diagram dropdown select the same input', () => {
  const change = vi.fn(); const view = render(<SelectorControl id="test" ports={['A','B','C']} selected="B" onChange={change} buttons />);
  expect(screen.getByRole('button',{name:'B'}).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button',{name:'A'})); expect(change).toHaveBeenLastCalledWith('A');
  view.rerender(<SelectorControl id="test" ports={['A','B','C']} selected="B" onChange={change} />);
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'C'}}); expect(change).toHaveBeenLastCalledWith('C');
});
test('empty or disconnected selections do not display another input as selected', () => {
  const view = render(<SelectorControl id="test" ports={[]} selected="A" onChange={vi.fn()} />);
  const select = screen.getByRole('combobox') as HTMLSelectElement;
  expect(select.disabled).toBe(true);
  expect(select.value).toBe('');
  view.rerender(<SelectorControl id="test" ports={['B']} selected="A" onChange={vi.fn()} />);
  expect(select.value).toBe('');
  expect(screen.queryByRole('option',{name:'A'})).toBeNull();
  view.rerender(<SelectorControl id="test" ports={['B']} selected="A" onChange={vi.fn()} buttons />);
  expect(screen.queryByRole('button',{name:'A'})).toBeNull();
  expect(screen.getByRole('button',{name:'B'}).getAttribute('aria-pressed')).toBe('false');
});
