import { expect, test } from 'vitest';
import { METER_POLL_MS, PeakMeter, meterDb } from './meter';

test('each beat raises the meter immediately, with a consistent fall between beats', () => {
  const meter = new PeakMeter();
  for (let beat = 0; beat < 8; beat++) {
    const now = beat * 500;
    const before = meter.at(now);
    meter.update(.8, now);
    expect(meter.at(now)).toBe(.8);
    expect(meter.at(now)).toBeGreaterThan(before);
    // Low readings between kicks must not pull the display down abruptly.
    meter.update(.01, now + 100);
    expect(meterDb(meter.at(now + 100))).toBeCloseTo(20 * Math.log10(.8) - 2.4);
    expect(meterDb(meter.at(now + 400))).toBeCloseTo(20 * Math.log10(.8) - 9.6);
  }
  expect(METER_POLL_MS).toBeLessThan(34);
});

test('release is independent of refresh rate, and stale or invalid input falls to silence', () => {
  const sparse = new PeakMeter();
  const frequent = new PeakMeter();
  sparse.update(1, 0); frequent.update(1, 0);
  for (let now = 10; now <= 500; now += 10) frequent.update(0, now);
  sparse.update(0, 500);
  expect(meterDb(sparse.at(500))).toBeCloseTo(-12);
  expect(frequent.at(500)).toBeCloseTo(sparse.at(500));
  sparse.update(NaN, 600); sparse.update(Infinity, 700); sparse.update(-1, 800);
  expect(sparse.at(2200)).toBe(0);
  frequent.reset(600);
  expect(frequent.at(600)).toBe(0);
  expect(meterDb(2)).toBe(0);
  expect(meterDb(0)).toBe(-48);
});
