import { describe, expect, it } from 'vitest';
import { getLunarDate } from '../lunar';

describe('native Chinese lunar calendar helper', () => {
  it('computes accurate lunar month and day labels including first day of month and leap months', () => {
    const nov8 = getLunarDate('2026-11-08');
    expect(nov8?.dayLabel).toBe('三十');
    expect(nov8?.shortLabel).toBe('三十');

    const nov9 = getLunarDate('2026-11-09');
    expect(nov9?.isFirstDay).toBe(true);
    expect(nov9?.dayLabel).toBe('初一');
    expect(nov9?.shortLabel).toBe('十月');

    const nov21 = getLunarDate('2026-11-21');
    expect(nov21?.dayLabel).toBe('十三');
    expect(nov21?.shortLabel).toBe('十三');

    const leap = getLunarDate('2025-07-25');
    expect(leap?.isFirstDay).toBe(true);
    expect(leap?.shortLabel).toContain('闰');
  });

  it('returns null gracefully for empty or invalid date strings', () => {
    expect(getLunarDate('')).toBeNull();
    expect(getLunarDate('invalid')).toBeNull();
  });
});
