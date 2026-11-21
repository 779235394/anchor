import { isActive, type Meta, type Task } from './types';

export interface PersonalRolloverResult {
  tasks: Task[];
  meta: Meta;
  rolledCount: number;
  changed: boolean;
}

/**
 * Idempotent daily rollover for personal tasks:
 * Runs once per calendar day (when `meta.lastOpenDate < today`).
 * Increments `rolls` and tags `carriedDate = today` for uncompleted overdue tasks,
 * keeping `due` untouched so exact overdue day count stays accurate.
 */
export function rolloverPersonalTasks(
  tasks: Task[],
  meta: Meta,
  today: string,
  nowTs: number = Date.now(),
): PersonalRolloverResult {
  if (meta.lastOpenDate >= today) {
    return { tasks, meta, rolledCount: 0, changed: false };
  }

  let rolledCount = 0;
  const nextTasks = tasks.map((task) => {
    if (!isActive(task) || task.done || task.status === 'done' || !task.due || task.due >= today) {
      return task;
    }
    rolledCount += 1;
    return {
      ...task,
      rolls: (task.rolls || 0) + 1,
      carriedDate: today,
      updatedAt: nowTs,
    };
  });

  return {
    tasks: nextTasks,
    meta: { ...meta, lastOpenDate: today },
    rolledCount,
    changed: true,
  };
}
