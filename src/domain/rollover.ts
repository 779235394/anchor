import { createId, isActive, type DailyItem, type Meta, type Task } from './types';
import { isWeekend, shiftDate } from './date';

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
    if (!isActive(task) || task.done || !task.due || task.due >= today) {
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

export interface DailyRolloverResult {
  daily: DailyItem[];
  carriedCount: number;
  touchedDates: string[];
  changed: boolean;
}

/**
 * Weekday rollover for Team Daily items:
 * - Weekends (Sat/Sun): does nothing (rest mode).
 * - Weekdays (Mon–Fri): finds uncompleted items within the previous 7 calendar days
 *   that haven't been carried yet (`!carriedToDate`), clones them into `today` with
 *   `carryCount + 1`, and marks source items `carriedToDate = today`.
 */
export function rolloverTeamDaily(
  daily: DailyItem[],
  today: string,
  nowTs: number = Date.now(),
): DailyRolloverResult {
  if (isWeekend(today)) {
    return { daily, carriedCount: 0, touchedDates: [], changed: false };
  }

  const limit = shiftDate(today, -7);
  const additions: DailyItem[] = [];
  const touched = new Set<string>();

  const updated = daily.map((item) => {
    if (
      !isActive(item) ||
      item.done ||
      item.carriedToDate ||
      item.date >= today ||
      item.date < limit
    ) {
      return item;
    }

    touched.add(item.date);
    touched.add(today);
    additions.push({
      id: createId(),
      date: today,
      title: item.title,
      ownerId: item.ownerId,
      done: false,
      doneAt: null,
      carriedFromId: item.id,
      carriedToDate: null,
      carryCount: (item.carryCount || 0) + 1,
      createdAt: nowTs,
      updatedAt: nowTs,
      deletedAt: null,
    });

    return {
      ...item,
      carriedToDate: today,
      updatedAt: nowTs,
    };
  });

  if (additions.length === 0) {
    return { daily, carriedCount: 0, touchedDates: [], changed: false };
  }

  return {
    daily: [...updated, ...additions],
    carriedCount: additions.length,
    touchedDates: [...touched],
    changed: true,
  };
}
