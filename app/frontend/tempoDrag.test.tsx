// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { tempoDragRate, useTempoDrag } from './tempoDrag';

afterEach(() => { cleanup(); vi.useRealTimers(); });
test('both axes increase in the intended direction and accelerate with distance', () => {
  expect(tempoDragRate(44, 0)).toBe(1);
  expect(tempoDragRate(0, -44)).toBe(1);
  expect(tempoDragRate(-44, 0)).toBe(-1);
  expect(tempoDragRate(0, 44)).toBe(-1);
  expect(tempoDragRate(84, 0)).toBeGreaterThan(2);
  expect(tempoDragRate(2, 0)).toBe(0);
});
function Harness({ disabled = false, change, identity = 1 }: { disabled?: boolean; change: (value: number) => Promise<void>; identity?: number }) {
  const drag = useTempoDrag(120, 60, 240, disabled, change, identity);
  return <span onPointerDown={drag}>BPM</span>;
}
function pointer(target: Element | Window, type: string, x = 0, y = 0) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { button: 0, isPrimary: true, pointerId: 1, clientX: x, clientY: y });
  fireEvent(target, event);
}
test('holding away keeps changing, returning pauses, release and lock stop adjustment', async () => {
  vi.useFakeTimers();
  const change = vi.fn().mockResolvedValue(undefined);
  const { rerender } = render(<Harness change={change} />);
  pointer(screen.getByText('BPM'), 'pointerdown');
  pointer(window, 'pointermove', 44);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(change).toHaveBeenCalledTimes(4);
  expect(change.mock.calls[3][0]).toBeCloseTo(120.2);
  pointer(window, 'pointermove');
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(change).toHaveBeenCalledTimes(4);
  pointer(window, 'pointerup');
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(change).toHaveBeenCalledTimes(4);
  pointer(screen.getByText('BPM'), 'pointerdown');
  pointer(window, 'pointermove', 0, 44);
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(change.mock.calls[4][0]).toBeLessThan(120);
  rerender(<Harness disabled change={change} />);
  pointer(screen.getByText('BPM'), 'pointerdown');
  pointer(window, 'pointermove', 100);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(change).toHaveBeenCalledTimes(5);
});
