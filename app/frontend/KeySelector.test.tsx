// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { KeySelector } from './KeySelector';
afterEach(cleanup);

test('marks original and best match independently, sends pitch, and reflects native state with an asterisk', () => {
  const select = vi.fn().mockResolvedValue(undefined);
  const props = { deck: 0, generation: 1, original: 'A minor', other: 'D major', semitones: 0, disabled: false, select };
  const { rerender } = render(<KeySelector {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Key deck A: A minor' }));
  const menu = screen.getByRole('menu');
  expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(12);
  expect(within(menu).getByRole('menuitemradio', { name: /A minor/ }).className).toContain('original-key');
  const match = within(menu).getByRole('menuitemradio', { name: /B minor/ });
  expect(match.className).toContain('recommended-key');
  // Safari can blur the focused option to the document before dispatching a mouse click.
  fireEvent.blur(within(menu).getByRole('menuitemradio', { name: /A minor/ }), { relatedTarget: null });
  expect(screen.getByRole('menu')).toBeTruthy();
  fireEvent.click(match);
  expect(select).toHaveBeenCalledWith(2);
  expect(screen.queryByRole('menu')).toBeNull();
  rerender(<KeySelector {...props} semitones={2} />);
  expect(screen.getByRole('button').textContent).toContain('B minor*');
  fireEvent.click(screen.getByRole('button'));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /A minor/ }));
  expect(select).toHaveBeenLastCalledWith(0);
  rerender(<KeySelector {...props} />);
  expect(screen.getByRole('button').textContent).not.toContain('*');
});

test('shows both coloured labels for original best match and supports keyboard and dismissal', () => {
  render(<KeySelector deck={1} generation={1} original="C major" other="A minor" semitones={0} disabled={false} select={vi.fn()} />);
  fireEvent.click(screen.getByRole('button'));
  const selected = screen.getByRole('menuitemradio', { name: /C major/ });
  expect(selected.className).toContain('original-key recommended-key');
  expect(document.activeElement).toBe(selected);
  fireEvent.keyDown(selected, { key: 'ArrowDown' });
  expect(document.activeElement?.textContent).toContain('C# major');
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(screen.getByRole('button'));
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
});

test('unknown keys cannot open a selector and replacing a track dismisses the menu', () => {
  const props = { deck: 0, generation: 1, original: null, semitones: 0, disabled: false, select: vi.fn() };
  const { rerender } = render(<KeySelector {...props} />);
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  rerender(<KeySelector {...props} original="C major" />);
  fireEvent.click(screen.getByRole('button'));
  rerender(<KeySelector {...props} original="C major" generation={2} />);
  expect(screen.queryByRole('menu')).toBeNull();
});
