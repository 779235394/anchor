import { describe, expect, it } from 'vitest';
import { rolloverPersonalTasks } from '../rollover';
import type { Meta, Task } from '../types';

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
    status: partial.done ? 'done' : 'todo',
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
      makeTask({ id: 'doneOld', due: '2026-11-18', status: 'done', done: true, doneAt: 2000 }),
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
