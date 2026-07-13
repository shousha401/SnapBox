import { describe, it, expect } from 'vitest';
import { parseShifts, shiftIdFor } from '../server/shift.js';

describe('parseShifts', () => {
  it('defaults to a single daily shift', () => {
    expect(parseShifts('')).toEqual([0]);
    expect(parseShifts(undefined)).toEqual([0]);
  });

  it('parses HH:MM into sorted minutes and dedupes', () => {
    expect(parseShifts('18:00,06:00')).toEqual([360, 1080]);
    expect(parseShifts('06:00,06:00')).toEqual([360]);
  });

  it('ignores garbage / out-of-range entries', () => {
    expect(parseShifts('25:00, ,06:00')).toEqual([360]);
  });
});

describe('shiftIdFor', () => {
  it('single shift -> the calendar date', () => {
    const d = new Date(2026, 6, 13, 10, 30); // 2026-07-13 10:30 local
    expect(shiftIdFor(d, [0])).toBe('2026-07-13');
  });

  it('two shifts -> date + index', () => {
    const starts = [360, 1080]; // 06:00, 18:00
    expect(shiftIdFor(new Date(2026, 6, 13, 10, 0), starts)).toBe('2026-07-13#0');
    expect(shiftIdFor(new Date(2026, 6, 13, 19, 0), starts)).toBe('2026-07-13#1');
  });

  it('early-morning hours roll back to the previous day night shift', () => {
    const starts = [360, 1080]; // 06:00, 18:00
    // 02:00 is before the first start -> previous day's last shift
    expect(shiftIdFor(new Date(2026, 6, 13, 2, 0), starts)).toBe('2026-07-12#1');
  });

  it('boundary time belongs to the shift that starts at it', () => {
    const starts = [360, 1080];
    expect(shiftIdFor(new Date(2026, 6, 13, 6, 0), starts)).toBe('2026-07-13#0');
    expect(shiftIdFor(new Date(2026, 6, 13, 18, 0), starts)).toBe('2026-07-13#1');
  });
});
