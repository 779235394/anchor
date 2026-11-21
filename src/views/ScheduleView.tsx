import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Lightbulb,
  PanelLeft,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  isActive,
  TASK_STATUS_ORDER,
  type Note,
  type Priority,
  type Task,
  type TaskStatus,
} from '@/domain/types';
import {
  formatClock,
  formatDate,
  isoWeekKey,
  parseLocalDate,
  shiftDate,
  todayStr,
  weekdayLabel,
} from '@/domain/date';
import { getLunarDate } from '@/domain/lunar';
import {
  buildMonthGrid,
  buildWeekDates,
  formatMinutesToTime,
  formatTimeRange,
  getTaskDateRange,
  isTimestampOnDate,
  layoutMonthWeekBars,
  layoutTimedEvents,
  shiftTaskSchedule,
} from '@/domain/schedule';
import { markdownToPlainText } from '@/domain/markdown';
import { getDict, taskStatusLabel } from '@/i18n';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { CircularCheck, PRIO_COLORS } from '@/components/CircularCheck';
import { SegmentedControl } from '@/components/SegmentedControl';
import { STATUS_COLORS, TaskInspector } from '@/components/TaskInspector';

type CalendarMode = 'day' | 'week' | 'month';

const HOUR_HEIGHT = 54;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const WEEKDAY_HEADERS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAY_HEADERS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MINI_HEADERS_ZH = ['日', '一', '二', '三', '四', '五', '六'];
const MINI_HEADERS_EN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const PROJECT_DOT_PALETTE = [
  '#007AFF',
  '#5856D6',
  '#0D9488',
  '#FF9500',
  '#AF52DE',
  '#FF2D55',
  '#34C759',
];

function projectDotColor(index: number): string {
  return PROJECT_DOT_PALETTE[index % PROJECT_DOT_PALETTE.length];
}

export function ScheduleView() {
  const {
    config,
    data,
    inspector,
    openInspector,
    setView,
    addTask,
    toggleTask,
    scheduleTask,
    pushToast,
  } = useWorkbenchStore();

  const t = getDict(config.lang);
  const zh = config.lang === 'zh';
  const today = todayStr();

  const [mode, setMode] = useState<CalendarMode>('month');
  const [cursorDate, setCursorDate] = useState<string>(today);
  const [miniMonthOffset, setMiniMonthOffset] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Layer checkboxes
  const [showTasksLayer, setShowTasksLayer] = useState(true);
  const [showDoneLayer, setShowDoneLayer] = useState(true);
  const [showNotesLayer, setShowNotesLayer] = useState(false);
  const [showLunar, setShowLunar] = useState(true);
  const [hiddenProjectIds, setHiddenProjectIds] = useState<Set<string>>(() => new Set());
  const [unscheduledOpen, setUnscheduledOpen] = useState(true);

  // Drag state
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragHoverDate, setDragHoverDate] = useState<string | null>(null);

  // Day overflow popover & Quick Schedule create modal
  const [overflowDay, setOverflowDay] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState<{
    title: string;
    startDate: string;
    due: string;
    startTime: string;
    endTime: string;
    prio: Priority;
    status: TaskStatus;
    projectId: string;
  } | null>(null);

  const timelineScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if ((mode === 'week' || mode === 'day') && timelineScrollRef.current) {
      timelineScrollRef.current.scrollTop = 7.5 * HOUR_HEIGHT;
    }
  }, [mode]);

  const activeTasks = useMemo(() => data.tasks.filter(isActive), [data.tasks]);
  const activeProjects = useMemo(() => data.projects.filter(isActive), [data.projects]);
  const activeNotes = useMemo(() => data.notes.filter(isActive), [data.notes]);

  const projectIndexMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    activeProjects.forEach((p, idx) => {
      map.set(p.id, { name: p.name, color: projectDotColor(idx) });
    });
    return map;
  }, [activeProjects]);

  const selectedTask =
    inspector?.kind === 'task'
      ? activeTasks.find((k) => k.id === inspector.id) || null
      : null;

  const cursorObj = parseLocalDate(cursorDate);
  const cursorYear = cursorObj.getFullYear();
  const cursorMonth = cursorObj.getMonth();

  const miniDateObj = new Date(cursorYear, cursorMonth + miniMonthOffset, 1);
  const miniWeeks = useMemo(
    () => buildMonthGrid(miniDateObj.getFullYear(), miniDateObj.getMonth(), 0),
    [miniDateObj.getFullYear(), miniDateObj.getMonth()],
  );

  const monthWeeks = useMemo(
    () => buildMonthGrid(cursorYear, cursorMonth, 0),
    [cursorYear, cursorMonth],
  );

  const weekDates = useMemo(() => buildWeekDates(cursorDate, 0), [cursorDate]);

  const toggleProjectFilter = (key: string) => {
    setHiddenProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const qLower = searchQuery.trim().toLowerCase();

  const visibleTasks = useMemo(() => {
    return activeTasks.filter((task) => {
      const projKey = task.projectId || '__none';
      if (hiddenProjectIds.has(projKey)) return false;
      if (qLower) {
        const pName = task.projectId ? projectIndexMap.get(task.projectId)?.name || '' : '';
        if (
          !task.title.toLowerCase().includes(qLower) &&
          !task.note.toLowerCase().includes(qLower) &&
          !pName.toLowerCase().includes(qLower)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [activeTasks, hiddenProjectIds, qLower, projectIndexMap]);

  const scheduledTasks = useMemo(() => {
    if (!showTasksLayer) return [];
    return visibleTasks.filter((task) => {
      const hasRange = !!getTaskDateRange(task);
      if (!hasRange) return false;
      if (task.done && !showDoneLayer) return false;
      return true;
    });
  }, [visibleTasks, showTasksLayer, showDoneLayer]);

  const unscheduledTasks = useMemo(() => {
    return visibleTasks
      .filter((task) => !task.done && !getTaskDateRange(task))
      .sort((a, b) => a.prio - b.prio || b.updatedAt - a.updatedAt);
  }, [visibleTasks]);

  const visibleNotes = useMemo(() => {
    if (!showNotesLayer) return [];
    if (!qLower) return activeNotes;
    return activeNotes.filter(
      (n) =>
        n.text.toLowerCase().includes(qLower) ||
        n.tags.some((tg) => tg.toLowerCase().includes(qLower)),
    );
  }, [activeNotes, showNotesLayer, qLower]);

  const notesByDate = useMemo(() => {
    const map = new Map<string, Note[]>();
    for (const n of visibleNotes) {
      const ymd = formatDate(new Date(n.createdAt));
      const arr = map.get(ymd) || [];
      arr.push(n);
      map.set(ymd, arr);
    }
    return map;
  }, [visibleNotes]);

  const doneByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    if (!showDoneLayer) return map;
    for (const task of visibleTasks) {
      if (!task.done || !task.doneAt) continue;
      const ymd = formatDate(new Date(task.doneAt));
      const arr = map.get(ymd) || [];
      arr.push(task);
      map.set(ymd, arr);
    }
    return map;
  }, [visibleTasks, showDoneLayer]);

  // Dates that have any scheduled task for mini-calendar dots
  const busyDates = useMemo(() => {
    const set = new Set<string>();
    for (const task of scheduledTasks) {
      const r = getTaskDateRange(task);
      if (!r) continue;
      let cur = r.start;
      let guard = 0;
      while (cur <= r.end && guard < 62) {
        set.add(cur);
        cur = shiftDate(cur, 1);
        guard++;
      }
    }
    return set;
  }, [scheduledTasks]);

  const navigatePeriod = (delta: -1 | 1) => {
    if (mode === 'month') {
      const d = new Date(cursorYear, cursorMonth + delta, 1);
      setCursorDate(formatDate(d));
      setMiniMonthOffset(0);
    } else if (mode === 'week') {
      setCursorDate(shiftDate(cursorDate, delta * 7));
      setMiniMonthOffset(0);
    } else {
      setCursorDate(shiftDate(cursorDate, delta));
      setMiniMonthOffset(0);
    }
  };

  const jumpToday = () => {
    setCursorDate(today);
    setMiniMonthOffset(0);
  };

  const openQuickCreate = (ymd: string, startTime = '', endTime = '') => {
    setCreateDraft({
      title: '',
      startDate: '',
      due: ymd,
      startTime,
      endTime,
      prio: 2,
      status: 'todo',
      projectId: '',
    });
  };

  const submitQuickCreate = () => {
    if (!createDraft || !createDraft.title.trim()) return;
    const task = addTask({
      title: createDraft.title,
      startDate: createDraft.startDate,
      due: createDraft.due,
      startTime: createDraft.startTime,
      endTime: createDraft.endTime,
      prio: createDraft.prio,
      status: createDraft.status,
      projectId: createDraft.projectId,
    });
    setCreateDraft(null);
    openInspector({ kind: 'task', id: task.id });
  };

  const handleTaskDragStart = (e: DragEvent, taskId: string) => {
    setDragTaskId(taskId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/anchor-sched-task', taskId);
    e.dataTransfer.setData('text/plain', taskId);
  };

  const handleDropOnDate = (e: DragEvent, targetYmd: string, hour?: number) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/anchor-sched-task') || dragTaskId;
    setDragTaskId(null);
    setDragHoverDate(null);
    if (!id) return;
    const task = activeTasks.find((k) => k.id === id);
    if (!task) return;
    const shifted = shiftTaskSchedule(task, targetYmd);
    if (hour !== undefined) {
      const startMin = hour * 60;
      const startTime = formatMinutesToTime(startMin);
      const endTime = formatMinutesToTime(Math.min(23 * 60 + 45, startMin + 60));
      scheduleTask(task.id, {
        startDate: '',
        due: targetYmd,
        startTime,
        endTime,
      });
    } else {
      scheduleTask(task.id, {
        startDate: shifted.startDate,
        due: shifted.due,
        startTime: task.startTime,
        endTime: task.endTime,
      });
    }
    pushToast(t.scheduleDraggedToast(targetYmd));
  };

  const periodTitle = useMemo(() => {
    if (mode === 'month') {
      return zh
        ? `${cursorYear}年${cursorMonth + 1}月`
        : cursorObj.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    }
    if (mode === 'week') {
      const s = weekDates[0].slice(5).replace('-', '/');
      const e = weekDates[6].slice(5).replace('-', '/');
      return zh
        ? `${cursorYear}年${cursorMonth + 1}月 · ${isoWeekKey(cursorDate)} (${s}–${e})`
        : `${isoWeekKey(cursorDate)} · ${s} – ${e}`;
    }
    const lunar = showLunar ? getLunarDate(cursorDate) : null;
    const wd = weekdayLabel(cursorDate, config.lang);
    return zh
      ? `${cursorYear}年${cursorMonth + 1}月${cursorObj.getDate()}日 ${wd}${lunar ? ` · ${lunar.fullLabel}` : ''}`
      : `${cursorDate} · ${wd}`;
  }, [mode, zh, cursorYear, cursorMonth, cursorObj, weekDates, cursorDate, showLunar, config.lang]);

  const nowDate = new Date();
  const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();

  const barColorForTask = (task: Task) => {
    if (task.done) {
      return {
        bg: 'var(--bg-subtle)',
        color: 'var(--text-3)',
        accent: 'var(--status-green)',
      };
    }
    if (task.projectId && projectIndexMap.has(task.projectId)) {
      const c = projectIndexMap.get(task.projectId)!.color;
      return {
        bg: `color-mix(in srgb, ${c} 13%, var(--bg-card))`,
        color: 'var(--text-1)',
        accent: c,
      };
    }
    return {
      bg: PRIO_COLORS[task.prio].soft,
      color: 'var(--text-1)',
      accent: PRIO_COLORS[task.prio].color,
    };
  };

  const weekdayHeaders = zh ? WEEKDAY_HEADERS_ZH : WEEKDAY_HEADERS_EN;
  const miniHeaders = zh ? MINI_HEADERS_ZH : MINI_HEADERS_EN;

  // Compute day tasks/logs for Day view or Overflow modal
  const getDayDetails = (ymd: string) => {
    const tasksOnDay = scheduledTasks.filter((task) => {
      const r = getTaskDateRange(task);
      return !!r && r.start <= ymd && r.end >= ymd;
    });
    const doneExtra = (doneByDate.get(ymd) || []).filter(
      (d) => !tasksOnDay.some((x) => x.id === d.id),
    );
    const notesOnDay = notesByDate.get(ymd) || [];
    return { tasksOnDay, doneExtra, notesOnDay };
  };

  return (
    <div className="flex h-full min-w-0">
      {/* Left Collapsible Mini Calendar & Layers Sidebar */}
      {sidebarOpen && (
        <aside
          className="w-[228px] shrink-0 h-full flex flex-col overflow-y-auto px-3.5 py-4 space-y-4 select-none"
          style={{
            background: 'var(--bg-card)',
            borderRight: '1px solid var(--hairline)',
          }}
        >
          {/* Search */}
          <div className="relative">
            <Search
              className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--text-3)' }}
            />
            <input
              id="quick-capture-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.scheduleSearchPh}
              className="ap-input w-full pl-8 py-1.5 text-[12.5px]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-3)' }}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Mini Month Calendar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-[13px] font-semibold">
                {zh
                  ? `${miniDateObj.getFullYear()}年 ${miniDateObj.getMonth() + 1}月`
                  : miniDateObj.toLocaleString('en-US', { month: 'short', year: 'numeric' })}
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setMiniMonthOffset((o) => o - 1)}
                  className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center hover:bg-[var(--bg-subtle-hover)]"
                  style={{ color: 'var(--text-3)' }}
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setMiniMonthOffset((o) => o + 1)}
                  className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center hover:bg-[var(--bg-subtle-hover)]"
                  style={{ color: 'var(--text-3)' }}
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 text-center text-[11px]" style={{ color: 'var(--text-3)' }}>
              {miniHeaders.map((h, i) => (
                <div key={i} className="py-1 font-medium">
                  {h}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-y-0.5 text-center">
              {miniWeeks.flat().map((ymd) => {
                const d = parseLocalDate(ymd);
                const inMiniMonth = d.getMonth() === miniDateObj.getMonth();
                const isToday = ymd === today;
                const isSelected = ymd === cursorDate;
                const hasItems = busyDates.has(ymd);
                return (
                  <button
                    key={ymd}
                    type="button"
                    onClick={() => {
                      setCursorDate(ymd);
                      setMiniMonthOffset(0);
                    }}
                    className="relative h-7 w-7 mx-auto rounded-full text-[11.5px] font-medium inline-flex flex-col items-center justify-center ap-ease"
                    style={{
                      background: isToday
                        ? 'var(--accent)'
                        : isSelected
                          ? 'var(--accent-soft)'
                          : 'transparent',
                      color: isToday
                        ? '#ffffff'
                        : isSelected
                          ? 'var(--accent)'
                          : inMiniMonth
                            ? 'var(--text-1)'
                            : 'var(--text-4)',
                    }}
                  >
                    <span>{d.getDate()}</span>
                    {hasItems && (
                      <span
                        className="w-1 h-1 rounded-full absolute bottom-0.5"
                        style={{
                          background: isToday ? '#ffffff' : 'var(--accent)',
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Display Layers */}
          <div
            className="pt-3 space-y-2"
            style={{ borderTop: '1px solid var(--hairline-soft)' }}
          >
            <div
              className="text-[11px] font-semibold uppercase tracking-wider px-1"
              style={{ color: 'var(--text-3)' }}
            >
              {t.scheduleLayerTitle}
            </div>
            {[
              { label: t.scheduleLayerTasks, checked: showTasksLayer, toggle: () => setShowTasksLayer((v) => !v), color: 'var(--accent)' },
              { label: t.scheduleLayerDone, checked: showDoneLayer, toggle: () => setShowDoneLayer((v) => !v), color: 'var(--status-green)' },
              { label: t.scheduleLayerNotes, checked: showNotesLayer, toggle: () => setShowNotesLayer((v) => !v), color: 'var(--status-sky)' },
              { label: t.scheduleLayerLunar, checked: showLunar, toggle: () => setShowLunar((v) => !v), color: 'var(--status-orange)' },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={item.toggle}
                className="w-full flex items-center gap-2 px-1 py-1 rounded-[7px] text-[12.5px] ap-ease hover:bg-[var(--bg-subtle)]"
              >
                <span
                  className="w-4 h-4 rounded-[4px] inline-flex items-center justify-center shrink-0"
                  style={{
                    background: item.checked ? item.color : 'transparent',
                    border: item.checked ? 'none' : '1.5px solid var(--text-4)',
                    color: '#ffffff',
                  }}
                >
                  {item.checked && <Check className="w-3 h-3" strokeWidth={2.6} />}
                </span>
                <span className="truncate" style={{ color: 'var(--text-1)' }}>
                  {item.label}
                </span>
              </button>
            ))}
          </div>

          {/* Project Filter Checkboxes */}
          <div
            className="pt-3 space-y-1.5"
            style={{ borderTop: '1px solid var(--hairline-soft)' }}
          >
            <div
              className="text-[11px] font-semibold uppercase tracking-wider px-1"
              style={{ color: 'var(--text-3)' }}
            >
              {t.scheduleProjectsTitle}
            </div>
            {[
              ...activeProjects.map((p, idx) => ({
                id: p.id,
                name: p.name,
                color: projectDotColor(idx),
              })),
              { id: '__none', name: t.noProject, color: 'var(--status-gray)' },
            ].map((proj) => {
              const checked = !hiddenProjectIds.has(proj.id);
              return (
                <button
                  key={proj.id}
                  type="button"
                  onClick={() => toggleProjectFilter(proj.id)}
                  className="w-full flex items-center gap-2 px-1 py-1 rounded-[7px] text-[12.5px] ap-ease hover:bg-[var(--bg-subtle)]"
                >
                  <span
                    className="w-4 h-4 rounded-[4px] inline-flex items-center justify-center shrink-0"
                    style={{
                      background: checked ? proj.color : 'transparent',
                      border: checked ? 'none' : '1.5px solid var(--text-4)',
                      color: '#ffffff',
                    }}
                  >
                    {checked && <Check className="w-3 h-3" strokeWidth={2.6} />}
                  </span>
                  <span className="truncate text-left" style={{ color: 'var(--text-1)' }}>
                    {proj.name}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Unscheduled Task Pool (Drag directly onto Calendar) */}
          <div
            className="pt-3 space-y-2"
            style={{ borderTop: '1px solid var(--hairline-soft)' }}
          >
            <button
              type="button"
              onClick={() => setUnscheduledOpen((v) => !v)}
              className="w-full flex items-center justify-between px-1"
            >
              <span
                className="text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--text-3)' }}
              >
                {t.scheduleUnscheduled} ({unscheduledTasks.length})
              </span>
              {unscheduledOpen ? (
                <ChevronUp className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />
              )}
            </button>
            {unscheduledOpen && (
              <div className="space-y-1.5">
                {unscheduledTasks.length === 0 ? (
                  <div className="text-[11.5px] px-1" style={{ color: 'var(--text-4)' }}>
                    {t.scheduleUnscheduledHint}
                  </div>
                ) : (
                  unscheduledTasks.slice(0, 12).map((task) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => handleTaskDragStart(e, task.id)}
                      onDragEnd={() => {
                        setDragTaskId(null);
                        setDragHoverDate(null);
                      }}
                      onClick={() => openInspector({ kind: 'task', id: task.id })}
                      className="px-2 py-1.5 rounded-[8px] text-[12px] flex items-center gap-1.5 cursor-grab active:cursor-grabbing ap-ease hover:bg-[var(--bg-subtle-hover)]"
                      style={{
                        background: 'var(--bg-subtle)',
                        border: '1px solid var(--hairline-soft)',
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: PRIO_COLORS[task.prio].color }}
                      />
                      <span className="truncate flex-1">{task.title}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Main Calendar Canvas */}
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        {/* Top Calendar Bar (Matching reference layout cleanly) */}
        <div
          className="px-5 py-3 shrink-0 flex flex-wrap items-center justify-between gap-3"
          style={{
            background: 'var(--bg-card)',
            borderBottom: '1px solid var(--hairline)',
          }}
        >
          {/* Left: New Schedule CTA */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => openQuickCreate(cursorDate)}
              className="ap-btn ap-btn-primary ap-btn-sm"
            >
              <CalendarPlus className="w-3.5 h-3.5" />
              {t.scheduleNewBtn}
            </button>
          </div>

          {/* Center: Period Title & Prev/Next */}
          <div className="flex items-center gap-2">
            <h1 className="text-[16px] font-semibold tracking-[-0.02em] select-none">
              {periodTitle}
            </h1>
            <div className="inline-flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => navigatePeriod(-1)}
                className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle-hover)]"
                style={{ color: 'var(--text-2)' }}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => navigatePeriod(1)}
                className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle-hover)]"
                style={{ color: 'var(--text-2)' }}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Right: Today + Day/Week/Month + Sidebar toggle */}
          <div className="flex items-center gap-2">
            <button type="button" onClick={jumpToday} className="ap-btn ap-btn-sm">
              {t.scheduleToday}
            </button>
            <SegmentedControl<CalendarMode>
              value={mode}
              onChange={setMode}
              options={[
                { value: 'day', label: t.scheduleDay },
                { value: 'week', label: t.scheduleWeek },
                { value: 'month', label: t.scheduleMonth },
              ]}
            />
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              title="Toggle Sidebar"
              className="w-8 h-8 rounded-[8px] inline-flex items-center justify-center ap-ease"
              style={{
                background: sidebarOpen ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                color: sidebarOpen ? 'var(--accent)' : 'var(--text-2)',
              }}
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ===================== MONTH VIEW ===================== */}
        {mode === 'month' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: 'var(--bg-card)' }}>
            {/* Weekday Header */}
            <div
              className="grid grid-cols-7 shrink-0"
              style={{ borderBottom: '1px solid var(--hairline)' }}
            >
              {weekdayHeaders.map((label, idx) => (
                <div
                  key={label}
                  className="px-3 py-2 text-[12px] font-medium select-none"
                  style={{
                    color: idx === 0 || idx === 6 ? 'var(--text-3)' : 'var(--text-2)',
                  }}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Week Rows */}
            <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
              {monthWeeks.map((weekDays, wIdx) => {
                const bars = layoutMonthWeekBars(weekDays, scheduledTasks);
                const MAX_LANES = 3;
                const visibleBars = bars.filter((b) => b.lane < MAX_LANES);
                const hiddenCountByCol = Array(7).fill(0) as number[];
                for (const b of bars) {
                  if (b.lane >= MAX_LANES) {
                    for (let c = b.colStart; c < b.colStart + b.colSpan; c++) {
                      hiddenCountByCol[c] += 1;
                    }
                  }
                }

                return (
                  <div
                    key={wIdx}
                    className="flex-1 min-h-[122px] relative grid grid-cols-7"
                    style={{
                      borderBottom:
                        wIdx < monthWeeks.length - 1 ? '1px solid var(--hairline)' : 'none',
                    }}
                  >
                    {/* Background Day Cells */}
                    {weekDays.map((ymd, cIdx) => {
                      const d = parseLocalDate(ymd);
                      const isCurrentMonth = d.getMonth() === cursorMonth;
                      const isToday = ymd === today;
                      const isDragTarget = dragHoverDate === ymd;
                      const lunar = showLunar ? getLunarDate(ymd) : null;
                      const dayNum = d.getDate();
                      const dayDisplay =
                        dayNum === 1 && !isToday
                          ? zh
                            ? `${d.getMonth() + 1}月`
                            : d.toLocaleString('en-US', { month: 'short', day: 'numeric' })
                          : String(dayNum);

                      const dayNotes = notesByDate.get(ymd) || [];
                      const dayDoneExtra = (doneByDate.get(ymd) || []).filter(
                        (k) => !bars.some((b) => b.task.id === k.id && cIdx >= b.colStart && cIdx < b.colStart + b.colSpan),
                      );
                      const hiddenMore = hiddenCountByCol[cIdx];

                      return (
                        <div
                          key={ymd}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            if (dragHoverDate !== ymd) setDragHoverDate(ymd);
                          }}
                          onDragLeave={() => {
                            if (dragHoverDate === ymd) setDragHoverDate(null);
                          }}
                          onDrop={(e) => handleDropOnDate(e, ymd)}
                          onDoubleClick={() => openQuickCreate(ymd)}
                          className="group relative flex flex-col p-1.5 overflow-hidden ap-ease"
                          style={{
                            borderRight: cIdx < 6 ? '1px solid var(--hairline-soft)' : 'none',
                            background: isDragTarget
                              ? 'var(--accent-soft)'
                              : !isCurrentMonth
                                ? 'color-mix(in srgb, var(--bg-canvas) 65%, var(--bg-card))'
                                : 'transparent',
                          }}
                        >
                          {/* Date & Lunar Header */}
                          <div className="flex items-center justify-between gap-1 px-1 mb-1">
                            <button
                              type="button"
                              onClick={() => {
                                setCursorDate(ymd);
                                setMode('day');
                              }}
                              className="inline-flex items-center justify-center rounded-full text-[12.5px] font-semibold ap-ease"
                              style={{
                                width: isToday ? 24 : 'auto',
                                height: 24,
                                paddingInline: isToday ? 0 : 2,
                                background: isToday ? 'var(--accent)' : 'transparent',
                                color: isToday
                                  ? '#ffffff'
                                  : isCurrentMonth
                                    ? 'var(--text-1)'
                                    : 'var(--text-4)',
                              }}
                            >
                              {dayDisplay}
                            </button>

                            <div className="flex items-center gap-1">
                              {lunar && (
                                <span
                                  className="text-[11px] truncate"
                                  style={{
                                    color: isToday
                                      ? 'var(--accent)'
                                      : lunar.isFirstDay
                                        ? 'var(--text-2)'
                                        : 'var(--text-4)',
                                    fontWeight: isToday || lunar.isFirstDay ? 500 : 400,
                                  }}
                                >
                                  {lunar.shortLabel}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => openQuickCreate(ymd)}
                                title={t.scheduleNewBtn}
                                className="w-5 h-5 rounded-[5px] opacity-0 group-hover:opacity-100 inline-flex items-center justify-center hover:bg-[var(--bg-subtle-hover)]"
                                style={{ color: 'var(--text-3)' }}
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          {/* Spacer reserved for multi-day & task lanes */}
                          <div className="flex-1" />

                          {/* Footer overflow & notes/completed micro indicators */}
                          <div className="flex items-center justify-between gap-1 px-1 pt-0.5 min-h-[18px]">
                            {hiddenMore > 0 ? (
                              <button
                                type="button"
                                onClick={() => setOverflowDay(ymd)}
                                className="text-[11px] font-medium px-1.5 rounded-[5px] hover:bg-[var(--bg-subtle-hover)]"
                                style={{ color: 'var(--accent)' }}
                              >
                                {t.scheduleMoreCount(hiddenMore)}
                              </button>
                            ) : (
                              <span />
                            )}

                            <div className="flex items-center gap-1">
                              {dayDoneExtra.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setOverflowDay(ymd)}
                                  title={t.scheduleCompletedToday}
                                  className="inline-flex items-center gap-0.5 text-[10.5px] px-1 rounded-[4px]"
                                  style={{
                                    background: 'var(--status-green-soft)',
                                    color: 'var(--status-green)',
                                  }}
                                >
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                  {dayDoneExtra.length}
                                </button>
                              )}
                              {dayNotes.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setOverflowDay(ymd)}
                                  title={t.scheduleNotesToday}
                                  className="inline-flex items-center gap-0.5 text-[10.5px] px-1 rounded-[4px]"
                                  style={{
                                    background: 'var(--status-sky-soft)',
                                    color: 'var(--status-sky)',
                                  }}
                                >
                                  <Lightbulb className="w-2.5 h-2.5" />
                                  {dayNotes.length}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Aligned Multi-Day & Single-Day Task Bars Overlay */}
                    <div
                      className="pointer-events-none absolute inset-x-0 top-[33px] grid grid-cols-7 gap-y-[3px] px-[3px]"
                    >
                      {visibleBars.map((seg) => {
                        const colors = barColorForTask(seg.task);
                        const selected = selectedTask?.id === seg.task.id;
                        return (
                          <div
                            key={`${seg.task.id}-${wIdx}`}
                            draggable
                            onDragStart={(e) => handleTaskDragStart(e, seg.task.id)}
                            onDragEnd={() => {
                              setDragTaskId(null);
                              setDragHoverDate(null);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              openInspector({ kind: 'task', id: seg.task.id });
                            }}
                            className="pointer-events-auto h-[21px] px-1.5 flex items-center gap-1 text-[11.5px] font-medium truncate cursor-pointer ap-ease hover:brightness-95"
                            style={{
                              gridColumn: `${seg.colStart + 1} / span ${seg.colSpan}`,
                              gridRow: seg.lane + 1,
                              marginInline: '2px',
                              borderRadius: `${seg.continuesLeft ? 2 : 6}px ${seg.continuesRight ? 2 : 6}px ${seg.continuesRight ? 2 : 6}px ${seg.continuesLeft ? 2 : 6}px`,
                              background: colors.bg,
                              color: colors.color,
                              borderLeft: seg.continuesLeft ? 'none' : `3px solid ${colors.accent}`,
                              boxShadow: selected ? '0 0 0 1.5px var(--accent)' : 'none',
                              textDecoration: seg.task.done ? 'line-through' : 'none',
                              opacity: seg.task.done ? 0.72 : 1,
                            }}
                            title={seg.task.title}
                          >
                            {seg.task.startTime && !seg.continuesLeft && (
                              <span
                                className="text-[10.5px] shrink-0 opacity-75"
                                style={{ color: colors.accent }}
                              >
                                {seg.task.startTime}
                              </span>
                            )}
                            <span className="truncate">{seg.task.title}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ===================== WEEK VIEW ===================== */}
        {mode === 'week' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: 'var(--bg-card)' }}>
            {/* Day Column Headers */}
            <div
              className="grid shrink-0"
              style={{
                gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))',
                borderBottom: '1px solid var(--hairline)',
              }}
            >
              <div className="p-2 text-[11px] text-right" style={{ color: 'var(--text-4)' }} />
              {weekDates.map((ymd) => {
                const d = parseLocalDate(ymd);
                const isToday = ymd === today;
                const lunar = showLunar ? getLunarDate(ymd) : null;
                return (
                  <div
                    key={ymd}
                    onClick={() => {
                      setCursorDate(ymd);
                      setMode('day');
                    }}
                    className="px-2 py-2.5 text-center cursor-pointer hover:bg-[var(--bg-subtle)] ap-ease"
                    style={{ borderLeft: '1px solid var(--hairline-soft)' }}
                  >
                    <div className="text-[11.5px]" style={{ color: isToday ? 'var(--accent)' : 'var(--text-3)' }}>
                      {weekdayLabel(ymd, config.lang)}
                    </div>
                    <div className="mt-1 flex items-center justify-center gap-1">
                      <span
                        className="w-7 h-7 rounded-full inline-flex items-center justify-center text-[14px] font-semibold"
                        style={{
                          background: isToday ? 'var(--accent)' : 'transparent',
                          color: isToday ? '#ffffff' : 'var(--text-1)',
                        }}
                      >
                        {d.getDate()}
                      </span>
                      {lunar && (
                        <span className="text-[10.5px]" style={{ color: 'var(--text-4)' }}>
                          {lunar.shortLabel}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* All-Day & Multi-Day Row */}
            <div
              className="grid shrink-0 max-h-[120px] overflow-y-auto"
              style={{
                gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))',
                borderBottom: '1px solid var(--hairline)',
                background: 'var(--bg-canvas)',
              }}
            >
              <div
                className="px-1.5 py-2 text-[10.5px] text-right font-medium"
                style={{ color: 'var(--text-3)' }}
              >
                {t.scheduleAllDay}
              </div>
              {weekDates.map((ymd) => {
                const allDayTasks = scheduledTasks.filter((task) => {
                  if (task.startTime) return false;
                  const r = getTaskDateRange(task);
                  return !!r && r.start <= ymd && r.end >= ymd;
                });
                const dayNotes = notesByDate.get(ymd) || [];
                return (
                  <div
                    key={ymd}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragHoverDate(ymd);
                    }}
                    onDrop={(e) => handleDropOnDate(e, ymd)}
                    className="p-1.5 space-y-1 min-h-[42px]"
                    style={{
                      borderLeft: '1px solid var(--hairline-soft)',
                      background: dragHoverDate === ymd ? 'var(--accent-soft)' : 'transparent',
                    }}
                  >
                    {allDayTasks.map((task) => {
                      const colors = barColorForTask(task);
                      return (
                        <div
                          key={task.id}
                          draggable
                          onDragStart={(e) => handleTaskDragStart(e, task.id)}
                          onClick={() => openInspector({ kind: 'task', id: task.id })}
                          className="px-1.5 py-0.5 rounded-[5px] text-[11.5px] font-medium truncate cursor-pointer"
                          style={{
                            background: colors.bg,
                            color: colors.color,
                            borderLeft: `3px solid ${colors.accent}`,
                            textDecoration: task.done ? 'line-through' : 'none',
                          }}
                        >
                          {task.title}
                        </div>
                      );
                    })}
                    {dayNotes.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => setView('notes')}
                        className="px-1.5 py-0.5 rounded-[5px] text-[11px] truncate cursor-pointer flex items-center gap-1"
                        style={{
                          background: 'var(--status-sky-soft)',
                          color: 'var(--status-sky)',
                        }}
                      >
                        <Lightbulb className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">{markdownToPlainText(n.text)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* Hourly Timeline Grid */}
            <div ref={timelineScrollRef} className="flex-1 min-h-0 overflow-y-auto">
              <div
                className="grid relative"
                style={{
                  gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))',
                  height: 24 * HOUR_HEIGHT,
                }}
              >
                {/* Hour Labels */}
                <div className="relative">
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      className="pr-2 text-right text-[11px] -translate-y-2 select-none"
                      style={{ height: HOUR_HEIGHT, color: 'var(--text-4)' }}
                    >
                      {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
                    </div>
                  ))}
                </div>

                {/* 7 Day Columns */}
                {weekDates.map((ymd) => {
                  const timedForDay = scheduledTasks.filter((task) => {
                    if (!task.startTime) return false;
                    const r = getTaskDateRange(task);
                    return !!r && r.start <= ymd && r.end >= ymd;
                  });
                  const laid = layoutTimedEvents(timedForDay);
                  const isToday = ymd === today;

                  return (
                    <div
                      key={ymd}
                      className="relative"
                      style={{ borderLeft: '1px solid var(--hairline-soft)' }}
                    >
                      {HOURS.map((h) => (
                        <div
                          key={h}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => handleDropOnDate(e, ymd, h)}
                          onClick={() =>
                            openQuickCreate(
                              ymd,
                              `${String(h).padStart(2, '0')}:00`,
                              `${String(Math.min(23, h + 1)).padStart(2, '0')}:00`,
                            )
                          }
                          className="cursor-pointer hover:bg-[var(--bg-subtle)] ap-ease"
                          style={{
                            height: HOUR_HEIGHT,
                            borderBottom: '1px solid var(--hairline-soft)',
                          }}
                        />
                      ))}

                      {/* Current Time Red Line */}
                      {isToday && (
                        <div
                          className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                          style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
                        >
                          <span
                            className="w-2 h-2 rounded-full -ml-1"
                            style={{ background: 'var(--status-red)' }}
                          />
                          <div
                            className="flex-1 h-[1.5px]"
                            style={{ background: 'var(--status-red)' }}
                          />
                        </div>
                      )}

                      {/* Positioned Timed Task Blocks */}
                      {laid.map((ev) => {
                        const colors = barColorForTask(ev.task);
                        const top = (ev.startMin / 60) * HOUR_HEIGHT;
                        const height = Math.max(24, ((ev.endMin - ev.startMin) / 60) * HOUR_HEIGHT - 2);
                        const widthPct = 100 / ev.totalCols;
                        const leftPct = ev.col * widthPct;
                        return (
                          <div
                            key={ev.task.id}
                            draggable
                            onDragStart={(e) => handleTaskDragStart(e, ev.task.id)}
                            onClick={(e) => {
                              e.stopPropagation();
                              openInspector({ kind: 'task', id: ev.task.id });
                            }}
                            className="absolute z-10 rounded-[7px] px-2 py-1 overflow-hidden cursor-pointer ap-ease hover:brightness-95"
                            style={{
                              top,
                              height,
                              left: `calc(${leftPct}% + 2px)`,
                              width: `calc(${widthPct}% - 4px)`,
                              background: colors.bg,
                              borderLeft: `3px solid ${colors.accent}`,
                              boxShadow:
                                selectedTask?.id === ev.task.id
                                  ? '0 0 0 1.5px var(--accent)'
                                  : '0 1px 2px rgba(0,0,0,0.06)',
                            }}
                          >
                            <div
                              className="text-[10.5px] font-semibold leading-tight"
                              style={{ color: colors.accent }}
                            >
                              {formatTimeRange(ev.task.startTime, ev.task.endTime)}
                            </div>
                            <div
                              className="text-[12px] font-medium leading-snug truncate"
                              style={{
                                color: colors.color,
                                textDecoration: ev.task.done ? 'line-through' : 'none',
                              }}
                            >
                              {ev.task.title}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ===================== DAY VIEW ===================== */}
        {mode === 'day' && (() => {
          const { tasksOnDay, notesOnDay } = getDayDetails(cursorDate);
          const allDayTasks = tasksOnDay.filter((k) => !k.startTime);
          const timedTasks = tasksOnDay.filter((k) => !!k.startTime);
          const laid = layoutTimedEvents(timedTasks);
          const completedToday = visibleTasks.filter(
            (k) => k.done && isTimestampOnDate(k.doneAt, cursorDate),
          );
          const isToday = cursorDate === today;

          return (
            <div className="flex-1 min-h-0 flex overflow-hidden" style={{ background: 'var(--bg-card)' }}>
              {/* Left: All-Day + Hourly Timeline */}
              <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                {/* All-Day Strip */}
                <div
                  className="px-5 py-3 shrink-0 space-y-2"
                  style={{
                    background: 'var(--bg-canvas)',
                    borderBottom: '1px solid var(--hairline)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                      {t.scheduleAllDay} ({allDayTasks.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => openQuickCreate(cursorDate)}
                      className="text-[12px] font-medium inline-flex items-center gap-1"
                      style={{ color: 'var(--accent)' }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t.add}
                    </button>
                  </div>
                  {allDayTasks.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {allDayTasks.map((task) => {
                        const colors = barColorForTask(task);
                        return (
                          <div
                            key={task.id}
                            onClick={() => openInspector({ kind: 'task', id: task.id })}
                            className="px-2.5 py-1.5 rounded-[8px] flex items-center gap-2 text-[12.5px] font-medium cursor-pointer ap-ease hover:brightness-95"
                            style={{
                              background: colors.bg,
                              borderLeft: `3px solid ${colors.accent}`,
                            }}
                          >
                            <div onClick={(e) => e.stopPropagation()}>
                              <CircularCheck
                                checked={task.done}
                                prio={task.prio}
                                size={15}
                                onChange={() => toggleTask(task.id)}
                              />
                            </div>
                            <span
                              style={{
                                textDecoration: task.done ? 'line-through' : 'none',
                                color: colors.color,
                              }}
                            >
                              {task.title}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Single-Day Hourly Timeline */}
                <div ref={timelineScrollRef} className="flex-1 min-h-0 overflow-y-auto">
                  <div
                    className="grid relative"
                    style={{
                      gridTemplateColumns: '64px minmax(0, 1fr)',
                      height: 24 * HOUR_HEIGHT,
                    }}
                  >
                    <div>
                      {HOURS.map((h) => (
                        <div
                          key={h}
                          className="pr-3 text-right text-[11.5px] -translate-y-2 select-none"
                          style={{ height: HOUR_HEIGHT, color: 'var(--text-4)' }}
                        >
                          {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
                        </div>
                      ))}
                    </div>
                    <div
                      className="relative"
                      style={{ borderLeft: '1px solid var(--hairline-soft)' }}
                    >
                      {HOURS.map((h) => (
                        <div
                          key={h}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => handleDropOnDate(e, cursorDate, h)}
                          onClick={() =>
                            openQuickCreate(
                              cursorDate,
                              `${String(h).padStart(2, '0')}:00`,
                              `${String(Math.min(23, h + 1)).padStart(2, '0')}:00`,
                            )
                          }
                          className="cursor-pointer hover:bg-[var(--bg-subtle)] ap-ease"
                          style={{
                            height: HOUR_HEIGHT,
                            borderBottom: '1px solid var(--hairline-soft)',
                          }}
                        />
                      ))}

                      {isToday && (
                        <div
                          className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                          style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full -ml-1.5"
                            style={{ background: 'var(--status-red)' }}
                          />
                          <div
                            className="flex-1 h-[1.5px]"
                            style={{ background: 'var(--status-red)' }}
                          />
                        </div>
                      )}

                      {laid.map((ev) => {
                        const colors = barColorForTask(ev.task);
                        const top = (ev.startMin / 60) * HOUR_HEIGHT;
                        const height = Math.max(28, ((ev.endMin - ev.startMin) / 60) * HOUR_HEIGHT - 2);
                        const widthPct = 100 / ev.totalCols;
                        const leftPct = ev.col * widthPct;
                        return (
                          <div
                            key={ev.task.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              openInspector({ kind: 'task', id: ev.task.id });
                            }}
                            className="absolute z-10 rounded-[9px] px-3 py-1.5 overflow-hidden cursor-pointer ap-ease hover:brightness-95"
                            style={{
                              top,
                              height,
                              left: `calc(${leftPct}% + 4px)`,
                              width: `calc(${widthPct}% - 8px)`,
                              background: colors.bg,
                              borderLeft: `3.5px solid ${colors.accent}`,
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <Clock className="w-3 h-3 shrink-0" style={{ color: colors.accent }} />
                              <span
                                className="text-[11.5px] font-semibold"
                                style={{ color: colors.accent }}
                              >
                                {formatTimeRange(ev.task.startTime, ev.task.endTime)}
                              </span>
                              <span
                                className="text-[13px] font-medium truncate"
                                style={{
                                  color: colors.color,
                                  textDecoration: ev.task.done ? 'line-through' : 'none',
                                }}
                              >
                                {ev.task.title}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: Daily Completed Log & Notes Record */}
              <div
                className="w-[280px] shrink-0 h-full overflow-y-auto p-4 space-y-5"
                style={{
                  background: 'var(--bg-canvas)',
                  borderLeft: '1px solid var(--hairline)',
                }}
              >
                <div className="text-[13.5px] font-semibold">{t.scheduleDailyLogTitle}</div>

                {/* Completed on this day */}
                <div className="space-y-2">
                  <div
                    className="text-[11.5px] font-semibold uppercase tracking-wider flex items-center gap-1.5"
                    style={{ color: 'var(--status-green)' }}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {t.scheduleCompletedToday} ({completedToday.length})
                  </div>
                  {completedToday.length === 0 ? (
                    <div className="text-[12px]" style={{ color: 'var(--text-4)' }}>
                      —
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {completedToday.map((k) => (
                        <div
                          key={k.id}
                          onClick={() => openInspector({ kind: 'task', id: k.id })}
                          className="ap-card px-3 py-2 text-[12.5px] cursor-pointer hover:border-[var(--accent)] ap-ease"
                        >
                          <div className="font-medium line-through" style={{ color: 'var(--text-2)' }}>
                            {k.title}
                          </div>
                          {k.doneAt && (
                            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                              {formatClock(k.doneAt, config.lang, today)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Notes captured on this day */}
                <div className="space-y-2">
                  <div
                    className="text-[11.5px] font-semibold uppercase tracking-wider flex items-center gap-1.5"
                    style={{ color: 'var(--status-sky)' }}
                  >
                    <Lightbulb className="w-3.5 h-3.5" />
                    {t.scheduleNotesToday} ({notesOnDay.length})
                  </div>
                  {notesOnDay.length === 0 ? (
                    <div className="text-[12px]" style={{ color: 'var(--text-4)' }}>
                      {completedToday.length === 0 ? t.scheduleNoLogsToday : '—'}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {notesOnDay.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => setView('notes')}
                          className="ap-card px-3 py-2 text-[12.5px] cursor-pointer hover:border-[var(--accent)] ap-ease"
                        >
                          <div className="line-clamp-3 leading-relaxed">
                            {markdownToPlainText(n.text)}
                          </div>
                          {n.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {n.tags.map((tg) => (
                                <span
                                  key={tg}
                                  className="text-[10.5px] px-1.5 rounded-full"
                                  style={{ background: 'var(--bg-subtle)', color: 'var(--text-3)' }}
                                >
                                  #{tg}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Shared Task Inspector */}
      <TaskInspector task={selectedTask} />

      {/* Overflow Day Detail Popover Modal */}
      {overflowDay && (() => {
        const { tasksOnDay, doneExtra, notesOnDay } = getDayDetails(overflowDay);
        const lunar = showLunar ? getLunarDate(overflowDay) : null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'var(--backdrop-mask)', backdropFilter: 'blur(4px)' }}
            onClick={() => setOverflowDay(null)}
          >
            <div
              className="w-full max-w-[420px] rounded-[16px] p-5 space-y-3.5"
              style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow-modal)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-[15.5px] font-semibold">
                    {overflowDay} · {weekdayLabel(overflowDay, config.lang)}
                  </h3>
                  {lunar && (
                    <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                      {lunar.fullLabel}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const d = overflowDay;
                      setOverflowDay(null);
                      openQuickCreate(d);
                    }}
                    className="ap-btn ap-btn-primary ap-btn-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t.add}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOverflowDay(null)}
                    className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center hover:bg-[var(--bg-subtle-hover)]"
                    style={{ color: 'var(--text-3)' }}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="max-h-[340px] overflow-y-auto space-y-2">
                {tasksOnDay.map((task) => {
                  const st = task.status || (task.done ? 'done' : 'todo');
                  return (
                    <div
                      key={task.id}
                      onClick={() => {
                        setOverflowDay(null);
                        openInspector({ kind: 'task', id: task.id });
                      }}
                      className="px-3 py-2 rounded-[10px] flex items-center gap-2.5 cursor-pointer hover:bg-[var(--bg-subtle-hover)]"
                      style={{ background: 'var(--bg-subtle)' }}
                    >
                      <div onClick={(e) => e.stopPropagation()}>
                        <CircularCheck
                          checked={task.done}
                          prio={task.prio}
                          size={16}
                          onChange={() => toggleTask(task.id)}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div
                          className="text-[13px] font-medium truncate"
                          style={{
                            textDecoration: task.done ? 'line-through' : 'none',
                            color: task.done ? 'var(--text-3)' : 'var(--text-1)',
                          }}
                        >
                          {task.title}
                        </div>
                        {task.startTime && (
                          <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                            {formatTimeRange(task.startTime, task.endTime)}
                          </div>
                        )}
                      </div>
                      <span
                        className="ap-pill py-0 px-1.5 text-[10.5px]"
                        style={{
                          background: STATUS_COLORS[st].soft,
                          color: STATUS_COLORS[st].color,
                        }}
                      >
                        {taskStatusLabel(st, config.lang)}
                      </span>
                    </div>
                  );
                })}

                {doneExtra.map((task) => (
                  <div
                    key={`done-${task.id}`}
                    onClick={() => {
                      setOverflowDay(null);
                      openInspector({ kind: 'task', id: task.id });
                    }}
                    className="px-3 py-2 rounded-[10px] flex items-center gap-2 text-[12.5px] cursor-pointer"
                    style={{ background: 'var(--status-green-soft)', color: 'var(--status-green)' }}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate line-through">{task.title}</span>
                  </div>
                ))}

                {notesOnDay.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => {
                      setOverflowDay(null);
                      setView('notes');
                    }}
                    className="px-3 py-2 rounded-[10px] flex items-start gap-2 text-[12.5px] cursor-pointer"
                    style={{ background: 'var(--status-sky-soft)', color: 'var(--text-1)' }}
                  >
                    <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--status-sky)' }} />
                    <span className="line-clamp-2">{markdownToPlainText(n.text)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Quick Schedule Create Modal */}
      {createDraft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'var(--backdrop-mask)', backdropFilter: 'blur(4px)' }}
          onClick={() => setCreateDraft(null)}
        >
          <div
            className="w-full max-w-[440px] rounded-[16px] p-5 space-y-4"
            style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow-modal)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[15.5px] font-semibold">{t.scheduleQuickCreateTitle}</h3>
              <button
                type="button"
                onClick={() => setCreateDraft(null)}
                className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center hover:bg-[var(--bg-subtle-hover)]"
                style={{ color: 'var(--text-3)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <input
                type="text"
                autoFocus
                value={createDraft.title}
                onChange={(e) => setCreateDraft({ ...createDraft, title: e.target.value })}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitQuickCreate();
                  } else if (e.key === 'Escape') {
                    setCreateDraft(null);
                  }
                }}
                placeholder={t.quickTaskPh}
                maxLength={140}
                className="ap-input w-full"
              />

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                    {t.startDateLabel}
                  </label>
                  <input
                    type="date"
                    value={createDraft.startDate}
                    onChange={(e) => setCreateDraft({ ...createDraft, startDate: e.target.value })}
                    className="ap-input w-full text-[12.5px] py-1.5"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                    {t.dueDateLabel}
                  </label>
                  <input
                    type="date"
                    value={createDraft.due}
                    onChange={(e) => setCreateDraft({ ...createDraft, due: e.target.value })}
                    className="ap-input w-full text-[12.5px] py-1.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                    {t.timeRangeLabel}
                  </label>
                  <input
                    type="time"
                    value={createDraft.startTime}
                    onChange={(e) => setCreateDraft({ ...createDraft, startTime: e.target.value })}
                    className="ap-input w-full text-[12.5px] py-1.5"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                    &nbsp;
                  </label>
                  <input
                    type="time"
                    disabled={!createDraft.startTime}
                    value={createDraft.endTime}
                    onChange={(e) => setCreateDraft({ ...createDraft, endTime: e.target.value })}
                    className="ap-input w-full text-[12.5px] py-1.5 disabled:opacity-45"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <select
                  value={createDraft.prio}
                  onChange={(e) =>
                    setCreateDraft({ ...createDraft, prio: Number(e.target.value) as Priority })
                  }
                  className="ap-input text-[12.5px] py-1.5"
                >
                  <option value={1}>{t.prio1Short}</option>
                  <option value={2}>{t.prio2Short}</option>
                  <option value={3}>{t.prio3Short}</option>
                  <option value={4}>{t.prio4Short}</option>
                </select>
                <select
                  value={createDraft.status}
                  onChange={(e) =>
                    setCreateDraft({ ...createDraft, status: e.target.value as TaskStatus })
                  }
                  className="ap-input text-[12.5px] py-1.5"
                >
                  {TASK_STATUS_ORDER.map((st) => (
                    <option key={st} value={st}>
                      {taskStatusLabel(st, config.lang)}
                    </option>
                  ))}
                </select>
                <select
                  value={createDraft.projectId}
                  onChange={(e) => setCreateDraft({ ...createDraft, projectId: e.target.value })}
                  className="ap-input text-[12.5px] py-1.5"
                >
                  <option value="">{t.noProject}</option>
                  {activeProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setCreateDraft(null)}
                className="ap-btn ap-btn-sm"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                disabled={!createDraft.title.trim()}
                onClick={submitQuickCreate}
                className="ap-btn ap-btn-primary ap-btn-sm disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                {t.add}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
