// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { TrackActions } from './Dropdown';

afterEach(cleanup);
test('track actions remain open inside and dismiss on outside pointer or Escape', async () => {
  render(<TrackActions title="Song"><label><input type="checkbox" />Tag</label><button>Approve</button></TrackActions>);
  const trigger = screen.getByLabelText('Actions for Song');
  const details = trigger.closest('details')!;
  fireEvent.click(trigger);
  fireEvent(details, new Event('toggle'));
  await waitFor(() => expect(details.open).toBe(true));
  fireEvent.pointerDown(screen.getByLabelText('Tag'));
  expect(details.open).toBe(true);
  fireEvent.pointerDown(document.body);
  expect(details.open).toBe(false);
  fireEvent.click(trigger);
  await waitFor(() => expect(details.open).toBe(true));
  fireEvent.keyDown(trigger, { key: 'Escape' });
  expect(details.open).toBe(false);
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  expect(details.open).toBe(false);
});
