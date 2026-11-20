import { describe, expect, it } from 'vitest';
import {
  dayDiff,
  humanDate,
  isWeekend,
  isoWeekKey,
  monthEnd,
  shiftDate,
  weekEnd,
  weekStart,
} from '../date';

describe('date domain utilities', () => {
  it('computes Monday-based weekStart and weekEnd across month/year boundaries', () => {
    // 2026-11-20 is Friday
    expect(weekStart('2026-11-20', 0)).toBe('2026-11-16');
    expect(weekEnd('2026-11-20', 0)).toBe('2026-11-22');
    expect(weekStart('2026-11-20', -1)).toBe('2026-11-09');
    // Sunday belongs to the week starting the prior Monday
    expect(weekStart('2026-11-22', 0)).toBe('2026-11-16');
    // Year boundary: 2026-01-01 is Thursday -> Monday is 2025-12-29
    expect(weekStart('2026-01-01', 0)).toBe('2025-12-29');
  });

  it('computes ISO week keys accurately', () => {
    expect(isoWeekKey('2026-11-20')).toBe('2026-W47');
    expect(isoWeekKey('2026-11-16')).toBe('2026-W47');
    expect(isoWeekKey('2026-11-22')).toBe('2026-W47');
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
  });

  it('detects weekends and shifts dates cleanly', () => {
    expect(isWeekend('2026-11-20')).toBe(false); // Friday
    expect(isWeekend('2026-11-21')).toBe(true); // Saturday
    expect(isWeekend('2026-11-22')).toBe(true); // Sunday
    expect(isWeekend('2026-11-23')).toBe(false); // Monday
    expect(shiftDate('2026-11-30', 1)).toBe('2026-12-01');
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
    expect(dayDiff('2026-11-18', '2026-11-20')).toBe(2);
  });

  it('formats human dates in Chinese and English', () => {
    expect(humanDate('2026-11-20', 'zh', '2026-11-20')).toBe('今天');
    expect(humanDate('2026-11-18', 'zh', '2026-11-20')).toBe('逾期 2 天');
    expect(humanDate('2026-11-21', 'en', '2026-11-20')).toBe('Tomorrow');
    expect(humanDate('', 'en', '2026-11-20')).toBe('No due date');
  });
});
