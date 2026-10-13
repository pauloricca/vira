export const METER_FLOOR_DB = -48;
export const METER_RELEASE_DB_PER_SECOND = 24;
export const METER_POLL_MS = 1000 / 30;

/** Display ballistics: attack immediately on a new peak, then fall in dB/time. */
export class PeakMeter {
  private level = 0;
  private sampledAt = 0;
  update(peak: number, now: number) {
    const value = Number.isFinite(peak) ? Math.max(0, peak) : 0;
    this.level = Math.max(this.at(now), value);
    this.sampledAt = now;
  }
  at(now: number) {
    const elapsed = Math.max(0, now - this.sampledAt) / 1000;
    const level = this.level * 10 ** (-METER_RELEASE_DB_PER_SECOND * elapsed / 20);
    return level >= 10 ** (METER_FLOOR_DB / 20) ? level : 0;
  }
  reset(now: number) { this.level = 0; this.sampledAt = now; }
}

export function meterDb(peak: number) {
  return peak > 0 ? Math.max(METER_FLOOR_DB, Math.min(0, 20 * Math.log10(peak))) : METER_FLOOR_DB;
}
