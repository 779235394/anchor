import { describe, expect, it } from 'vitest';
import {
  buildMonthGrid,
  buildWeekDates,
  formatTimeRange,
  getTaskDateRange,
  layoutMonthWeekBars,
  layoutTimedEvents,
  shiftTaskSchedule,
} from '../schedule';
import type { Task } from '../types';

function mkTask(partial: Partial<Task> & { id: string }): Task {
  return {
    title: partial.id,
    note: '',
    prio: 2,
    status: 'todo',
    due: '',
    done: false,
    doneAt: null,
    projectId: '',
    rolls: 0,
    carriedDate: null,
    attachments: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...partial,
  };
}

describe('schedule layout & date helpers', () => {
  it('normalizes task date ranges and preserves multi-day span when rescheduling', () => {
    const single = mkTask({ id: 't1', due: '2026-11-21' });
    expect(getTaskDateRange(single)).toEqual({ start: '2026-11-21', end: '2026-11-21' });
    expect(shiftTaskSchedule(single, '2026-11-25')).toEqual({
      startDate: '',
      due: '2026-11-25',
    });

    const multi = mkTask({ id: 't2', startDate: '2026-11-10', due: '2026-11-13' });
    expect(getTaskDateRange(multi)).toEqual({ start: '2026-11-10', end: '2026-11-13' });
    expect(shiftTaskSchedule(multi, '2026-11-20')).toEqual({
      startDate: '2026-11-20',
      due: '2026-11-23',
    });

    const unscheduled = mkTask({ id: 't3', due: '' });
    expect(getTaskDateRange(unscheduled)).toBeNull();
  });

  it('builds 7-column month grids starting on Sunday or Monday', () => {
    const novSun = buildMonthGrid(2026, 10, 0); // Nov 2026 starts on Sunday 2026-11-01
    expect(novSun[0][0]).toBe('2026-11-01');
    expect(novSun[0][6]).toBe('2026-11-07');
    expect(novSun).toHaveLength(5);

    const novMon = buildMonthGrid(2026, 10, 1);
    expect(novMon[0][0]).toBe('2026-10-26');
    expect(novMon[0][6]).toBe('2026-11-01');
    expect(novMon).toHaveLength(6);

    const week = buildWeekDates('2026-11-21', 0);
    expect(week[0]).toBe('2026-11-15');
    expect(week[6]).toBe('2026-11-21');
  });

  it('packs overlapping multi-day and single-day bars into collision-free lanes', () => {
    const week = buildWeekDates('2026-11-18', 0); // 2026-11-15 .. 2026-11-21
    const tasks = [
      mkTask({ id: 'span', startDate: '2026-11-14', due: '2026-11-18' }),
      mkTask({ id: 'single1', due: '2026-11-16' }),
      mkTask({ id: 'single2', due: '2026-11-19' }),
    ];

    const bars = layoutMonthWeekBars(week, tasks);
    const span = bars.find((b) => b.task.id === 'span')!;
    const s1 = bars.find((b) => b.task.id === 'single1')!;
    const s2 = bars.find((b) => b.task.id === 'single2')!;

    expect(span.colStart).toBe(0);
    expect(span.colSpan).toBe(4); // 15, 16, 17, 18
    expect(span.continuesLeft).toBe(true);
    expect(span.continuesRight).toBe(false);
    expect(span.lane).toBe(0);

    // single1 overlaps span on col 1 -> must go to lane 1
    expect(s1.lane).toBe(1);
    // single2 is on col 4 (free in lane 0) -> packs cleanly into lane 0
    expect(s2.lane).toBe(0);
  });

  it('places overlapping timed events into parallel columns and formats time ranges', () => {
    expect(formatTimeRange('09:30', '11:00')).toBe('09:30–11:00');
    expect(formatTimeRange('14:00')).toBe('14:00');
    expect(formatTimeRange('')).toBe('');

    const laid = layoutTimedEvents([
      mkTask({ id: 'a', due: '2026-11-21', startTime: '09:00', endTime: '11:00' }),
      mkTask({ id: 'b', due: '2026-11-21', startTime: '10:00', endTime: '12:00' }),
      mkTask({ id: 'c', due: '2026-11-21', startTime: '14:00', endTime: '15:00' }),
    ]);

    const a = laid.find((x) => x.task.id === 'a')!;
    const b = laid.find((x) => x.task.id === 'b')!;
    const c = laid.find((x) => x.task.id === 'c')!;

    expect(a.totalCols).toBe(2);
    expect(b.totalCols).toBe(2);
    expect(a.col).not.toBe(b.col);
    expect(c.totalCols).toBe(1);
    expect(c.col).toBe(0);
  });
});
