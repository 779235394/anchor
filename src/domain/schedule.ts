import { dayDiff, formatDate, parseLocalDate, shiftDate } from './date';
import type { Task } from './types';

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD (>= start)
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Normalizes a task's scheduled date range. Returns null when the task has no scheduled date. */
export function getTaskDateRange(task: Pick<Task, 'startDate' | 'due'>): DateRange | null {
  const s = (task.startDate || '').trim();
  const e = (task.due || '').trim();
  if (!s && !e) return null;
  if (s && !e) return { start: s, end: s };
  if (!s && e) return { start: e, end: e };
  return s <= e ? { start: s, end: e } : { start: e, end: s };
}

export function isMultiDayTask(task: Pick<Task, 'startDate' | 'due'>): boolean {
  const range = getTaskDateRange(task);
  return !!range && range.start < range.end;
}

/** Shifts a task's schedule so it starts on `targetStartYmd`, preserving multi-day span length. */
export function shiftTaskSchedule(
  task: Pick<Task, 'startDate' | 'due'>,
  targetStartYmd: string,
): { startDate: string; due: string } {
  const range = getTaskDateRange(task);
  if (!range || range.start === range.end) {
    return { startDate: '', due: targetStartYmd };
  }
  const spanDays = Math.max(0, dayDiff(range.start, range.end));
  return {
    startDate: targetStartYmd,
    due: shiftDate(targetStartYmd, spanDays),
  };
}

export function parseTimeToMinutes(hhmm?: string): number | null {
  if (!hhmm) return null;
  const trimmed = hhmm.trim();
  const m = HHMM_RE.exec(trimmed);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatMinutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const hh = String(Math.floor(clamped / 60)).padStart(2, '0');
  const mm = String(clamped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatTimeRange(startTime?: string, endTime?: string): string {
  const s = parseTimeToMinutes(startTime);
  if (s === null) return '';
  const e = parseTimeToMinutes(endTime);
  if (e !== null && e > s) {
    return `${startTime!.trim()}–${endTime!.trim()}`;
  }
  return startTime!.trim();
}

/**
 * Generates full calendar rows (5 or 6 rows × 7 days) covering the target month.
 * Defaults to Sunday-start (`weekStartsOn = 0`) to match the calendar view layout.
 */
export function buildMonthGrid(
  year: number,
  monthIndex0: number,
  weekStartsOn: 0 | 1 = 0,
): string[][] {
  const firstOfMonth = new Date(year, monthIndex0, 1);
  const lastOfMonth = new Date(year, monthIndex0 + 1, 0);
  const firstDow = firstOfMonth.getDay();
  const leadDays = (firstDow - weekStartsOn + 7) % 7;

  const gridStart = new Date(year, monthIndex0, 1 - leadDays);
  const totalDaysInMonth = lastOfMonth.getDate();
  const rowCount = Math.ceil((leadDays + totalDaysInMonth) / 7);
  const weeks: string[][] = [];

  for (let r = 0; r < rowCount; r++) {
    const row: string[] = [];
    for (let c = 0; c < 7; c++) {
      const cur = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + r * 7 + c);
      row.push(formatDate(cur));
    }
    weeks.push(row);
  }
  return weeks;
}

/** Builds the 7 dates of the week containing `anchorYmd`. */
export function buildWeekDates(anchorYmd: string, weekStartsOn: 0 | 1 = 0): string[] {
  const d = parseLocalDate(anchorYmd);
  const offset = (d.getDay() - weekStartsOn + 7) % 7;
  const startYmd = shiftDate(anchorYmd, -offset);
  return Array.from({ length: 7 }, (_, i) => shiftDate(startYmd, i));
}

export interface WeekBarSegment {
  task: Task;
  colStart: number; // 0..6
  colSpan: number;  // 1..7
  lane: number;     // 0-based vertical slot
  continuesLeft: boolean;
  continuesRight: boolean;
}

/**
 * Packs tasks overlapping a 7-day calendar row into non-overlapping horizontal lanes.
 * Multi-day bars are placed first so they align cleanly across cells.
 */
export function layoutMonthWeekBars(weekDays: string[], tasks: Task[]): WeekBarSegment[] {
  if (weekDays.length !== 7) return [];
  const weekStartYmd = weekDays[0];
  const weekEndYmd = weekDays[6];

  const candidates: Array<{
    task: Task;
    colStart: number;
    colEnd: number;
    continuesLeft: boolean;
    continuesRight: boolean;
    span: number;
  }> = [];

  for (const task of tasks) {
    const range = getTaskDateRange(task);
    if (!range) continue;
    if (range.end < weekStartYmd || range.start > weekEndYmd) continue;

    const clampedStart = range.start < weekStartYmd ? weekStartYmd : range.start;
    const clampedEnd = range.end > weekEndYmd ? weekEndYmd : range.end;
    const colStart = Math.max(0, Math.min(6, dayDiff(weekStartYmd, clampedStart)));
    const colEnd = Math.max(colStart, Math.min(6, dayDiff(weekStartYmd, clampedEnd)));

    candidates.push({
      task,
      colStart,
      colEnd,
      continuesLeft: range.start < weekStartYmd,
      continuesRight: range.end > weekEndYmd,
      span: colEnd - colStart + 1,
    });
  }

  candidates.sort((a, b) => {
    if (a.colStart !== b.colStart) return a.colStart - b.colStart;
    if (b.span !== a.span) return b.span - a.span; // longer bars first
    if (a.task.done !== b.task.done) return a.task.done ? 1 : -1;
    const at = parseTimeToMinutes(a.task.startTime) ?? 9999;
    const bt = parseTimeToMinutes(b.task.startTime) ?? 9999;
    if (at !== bt) return at - bt;
    return a.task.prio - b.task.prio || a.task.createdAt - b.task.createdAt;
  });

  // Track occupied columns per lane
  const laneOccupied: boolean[][] = [];
  const result: WeekBarSegment[] = [];

  for (const cand of candidates) {
    let assignedLane = -1;
    for (let l = 0; l < laneOccupied.length; l++) {
      let free = true;
      for (let c = cand.colStart; c <= cand.colEnd; c++) {
        if (laneOccupied[l][c]) {
          free = false;
          break;
        }
      }
      if (free) {
        assignedLane = l;
        break;
      }
    }
    if (assignedLane === -1) {
      assignedLane = laneOccupied.length;
      laneOccupied.push(Array(7).fill(false));
    }
    for (let c = cand.colStart; c <= cand.colEnd; c++) {
      laneOccupied[assignedLane][c] = true;
    }

    result.push({
      task: cand.task,
      colStart: cand.colStart,
      colSpan: cand.span,
      lane: assignedLane,
      continuesLeft: cand.continuesLeft,
      continuesRight: cand.continuesRight,
    });
  }

  return result;
}

export interface TimedEventLayout {
  task: Task;
  startMin: number;
  endMin: number;
  col: number;
  totalCols: number;
}

/**
 * Lays out timed tasks on a single day's 00:00–24:00 vertical timeline so overlapping
 * events render cleanly side-by-side without occluding each other.
 */
export function layoutTimedEvents(tasks: Task[]): TimedEventLayout[] {
  const items = tasks
    .map((task) => {
      const s = parseTimeToMinutes(task.startTime);
      if (s === null) return null;
      const eRaw = parseTimeToMinutes(task.endTime);
      const endMin = eRaw !== null && eRaw > s ? Math.min(1440, eRaw) : Math.min(1440, s + 60);
      return { task, startMin: s, endMin: Math.max(s + 25, endMin) };
    })
    .filter((x): x is { task: Task; startMin: number; endMin: number } => x !== null)
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.task.prio - b.task.prio);

  if (items.length === 0) return [];

  // Partition into overlap clusters
  const clusters: Array<typeof items> = [];
  let current: typeof items = [];
  let clusterEnd = -1;

  for (const item of items) {
    if (current.length === 0 || item.startMin < clusterEnd) {
      current.push(item);
      clusterEnd = Math.max(clusterEnd, item.endMin);
    } else {
      clusters.push(current);
      current = [item];
      clusterEnd = item.endMin;
    }
  }
  if (current.length > 0) clusters.push(current);

  const laid: TimedEventLayout[] = [];
  for (const cluster of clusters) {
    const colEnds: number[] = [];
    const placed: Array<{ item: (typeof items)[number]; col: number }> = [];
    for (const item of cluster) {
      let col = colEnds.findIndex((end) => end <= item.startMin);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(item.endMin);
      } else {
        colEnds[col] = item.endMin;
      }
      placed.push({ item, col });
    }
    const totalCols = Math.max(1, colEnds.length);
    for (const p of placed) {
      laid.push({
        task: p.item.task,
        startMin: p.item.startMin,
        endMin: p.item.endMin,
        col: p.col,
        totalCols,
      });
    }
  }
  return laid;
}

/** Checks if a timestamp falls on the given local YYYY-MM-DD date. */
export function isTimestampOnDate(ts: number | null | undefined, ymd: string): boolean {
  if (!ts) return false;
  return formatDate(new Date(ts)) === ymd;
}
