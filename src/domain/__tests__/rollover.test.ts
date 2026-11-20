import { describe, expect, it } from 'vitest';
import { rolloverPersonalTasks, rolloverTeamDaily } from '../rollover';
import type { DailyItem, Meta, Task } from '../types';

const baseMeta: Meta = {
  schemaVersion: 1,
  lastOpenDate: '2026-11-19',
  hasSample: false,
  lastExportAt: null,
};

function makeTask(partial: Partial<Task>): Task {
  return {
    id: 't1',
    title: 'Sample',
    note: '',
    prio: 2,
    due: '2026-11-19',
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

describe('personal task rollover', () => {
  it('increments rolls once per day for uncompleted overdue tasks while preserving due date', () => {
    const tasks = [
      makeTask({ id: 'overdue', due: '2026-11-18', rolls: 1 }),
      makeTask({ id: 'dueToday', due: '2026-11-20', rolls: 0 }),
      makeTask({ id: 'doneOld', due: '2026-11-18', done: true, doneAt: 2000 }),
      makeTask({ id: 'noDue', due: '' }),
    ];

    const first = rolloverPersonalTasks(tasks, baseMeta, '2026-11-20', 5000);
    expect(first.changed).toBe(true);
    expect(first.rolledCount).toBe(1);
    expect(first.meta.lastOpenDate).toBe('2026-11-20');

    const rolled = first.tasks.find((t) => t.id === 'overdue')!;
    expect(rolled.rolls).toBe(2);
    expect(rolled.due).toBe('2026-11-18'); // keeps original due for accurate overdue count
    expect(rolled.carriedDate).toBe('2026-11-20');

    // Idempotent when called again on the same day
    const second = rolloverPersonalTasks(first.tasks, first.meta, '2026-11-20', 6000);
    expect(second.changed).toBe(false);
    expect(second.rolledCount).toBe(0);
    expect(second.tasks.find((t) => t.id === 'overdue')!.rolls).toBe(2);
  });
});

describe('team daily weekday rollover', () => {
  const fridayItem: DailyItem = {
    id: 'd1',
    date: '2026-11-20', // Friday
    title: 'Debug order cache',
    ownerId: 'm1',
    done: false,
    doneAt: null,
    carriedFromId: null,
    carriedToDate: null,
    carryCount: 0,
    createdAt: 1000,
    updatedAt: 1000,
  };

  it('does not generate carry-over items on weekends', () => {
    const sat = rolloverTeamDaily([fridayItem], '2026-11-21', 2000);
    expect(sat.changed).toBe(false);
    expect(sat.daily).toHaveLength(1);

    const sun = rolloverTeamDaily([fridayItem], '2026-11-22', 3000);
    expect(sun.changed).toBe(false);
    expect(sun.daily).toHaveLength(1);
  });

  it('carries Friday unfinished items into Monday once and preserves source history', () => {
    const mon = rolloverTeamDaily([fridayItem], '2026-11-23', 4000);
    expect(mon.changed).toBe(true);
    expect(mon.carriedCount).toBe(1);
    expect(mon.daily).toHaveLength(2);

    const source = mon.daily.find((d) => d.id === 'd1')!;
    const clone = mon.daily.find((d) => d.id !== 'd1')!;
    expect(source.carriedToDate).toBe('2026-11-23');
    expect(clone.date).toBe('2026-11-23');
    expect(clone.carriedFromId).toBe('d1');
    expect(clone.carryCount).toBe(1);

    // Calling again on Monday must not duplicate
    const monAgain = rolloverTeamDaily(mon.daily, '2026-11-23', 5000);
    expect(monAgain.changed).toBe(false);
    expect(monAgain.daily).toHaveLength(2);
  });
});
