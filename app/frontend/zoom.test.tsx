// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { useWaveformZoom } from './zoom';

afterEach(cleanup);
function Harness() {
  const [beats, setBeats] = useState(16);
  const ref = useWaveformZoom(beats, setBeats);
  return <section ref={ref} aria-label="Waveforms"><div>A</div><div>B</div><output>{beats}</output></section>;
}
function gesture(type: string, scale = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { scale });
  fireEvent(screen.getByText('B'), event);
  return event;
}
test('trackpad pinch snaps through shared intervals, clamps and leaves ordinary scrolling alone', () => {
  render(<Harness />);
  fireEvent.wheel(screen.getByText('A'), { deltaY: -200 });
  expect(screen.getByRole('status').textContent).toBe('16');
  fireEvent.wheel(screen.getByText('A'), { ctrlKey: true, deltaY: -50 });
  expect(screen.getByRole('status').textContent).toBe('16');
  fireEvent.wheel(screen.getByText('B'), { ctrlKey: true, deltaY: -50 });
  expect(screen.getByRole('status').textContent).toBe('8');
  fireEvent.wheel(screen.getByText('A'), { ctrlKey: true, deltaY: -300 });
  expect(screen.getByRole('status').textContent).toBe('4');
  fireEvent.wheel(screen.getByText('B'), { ctrlKey: true, deltaY: 100 });
  expect(screen.getByRole('status').textContent).toBe('8');
  fireEvent.wheel(screen.getByText('B'), { ctrlKey: true, deltaY: 1000 });
  expect(screen.getByRole('status').textContent).toBe('32');
});
test('WebKit scale gestures zoom in and out and suppress duplicate wheel events', () => {
  render(<Harness />);
  expect(gesture('gesturestart').defaultPrevented).toBe(true);
  gesture('gesturechange', 1.4);
  expect(screen.getByRole('status').textContent).toBe('8');
  fireEvent.wheel(screen.getByText('A'), { ctrlKey: true, deltaY: -100 });
  expect(screen.getByRole('status').textContent).toBe('8');
  gesture('gestureend');
  gesture('gesturestart');
  gesture('gesturechange', 0.7);
  expect(screen.getByRole('status').textContent).toBe('16');
  gesture('gesturechange', 0);
  expect(screen.getByRole('status').textContent).toBe('16');
  gesture('gestureend');
});
