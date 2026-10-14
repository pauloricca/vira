// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { CpuUsage } from './CpuUsage';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test('shows process CPU as a percentage of one core between samples', () => {
  const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
  const view = render(<CpuUsage cpuSeconds={10} />);
  expect(screen.getByLabelText('VIRA CPU usage').textContent).toContain('CPU: —');

  now.mockReturnValue(2000);
  view.rerender(<CpuUsage cpuSeconds={10.5} />);
  expect(screen.getByLabelText('VIRA CPU usage').textContent).toContain('CPU: 50.0%');

  now.mockReturnValue(3000);
  view.rerender(<CpuUsage cpuSeconds={12} />);
  expect(screen.getByLabelText('VIRA CPU usage').textContent).toContain('CPU: 150.0%');

  view.rerender(<CpuUsage />);
  expect(screen.getByLabelText('VIRA CPU usage').textContent).toContain('CPU: —');
});
