import { useMemo, useState } from 'react';
import {
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Plus,
} from 'lucide-react';
import type { Lang, Project, Task } from '@/domain/types';
import {
  buildMonthGrid,
  buildWeekDates,
  formatTimeRange,
  getTaskDateRange,
  parseTimeToMinutes,
} from '@/domain/schedule';
import { getLunarDate } from '@/domain/lunar';
import { getProjectColorMeta } from '@/domain/projectColor';
import { parseLocalDate, shiftDate, todayStr, weekdayLabel } from '@/domain/date';
import { mobileApi } from './api';

interface MobileScheduleTabProps {
  lang: Lang;
  tasks: Task[];
  projects: Project[];
  onTaskUpdated: (task: Task) => void;
  onEditTask: (task: Task) => void;
  onNewTaskOnDate: (ymd: string) => void;
  onToast: (msg: string, tone?: 'ok' | 'err') => void;
}

const WEEKDAYS_ZH = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAYS_EN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function MobileScheduleTab({
  lang,
  tasks,
  projects,
  onTaskUpdated,
  onEditTask,
  onNewTaskOnDate,
  onToast,
}: MobileScheduleTabProps) {
  const zh = lang !== 'en';
  const today = todayStr();
  const [selectedYmd, setSelectedYmd] = useState(today);
  const [compactWeek, setCompactWeek] = useState(false);
  const [showUnscheduled, setShowUnscheduled] = useState(false);

  const selectedDate = parseLocalDate(selectedYmd);
  const viewYear = selectedDate.getFullYear();
  const viewMonth = selectedDate.getMonth();

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const monthWeeks = useMemo(() => buildMonthGrid(viewYear, viewMonth, 0), [viewYear, viewMonth]);
  const weekDates = useMemo(() => buildWeekDates(selectedYmd, 0), [selectedYmd]);

  // Index dates that have active tasks for dot markers
  const dateTaskDots = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks) {
      if (t.done || t.status === 'done') continue;
      const range = getTaskDateRange(t);
      if (!range) continue;
      let cur = range.start;
      for (let i = 0; i < 45 && cur <= range.end; i += 1) {
        map.set(cur, (map.get(cur) || 0) + 1);
        cur = shiftDate(cur, 1);
      }
    }
    return map;
  }, [tasks]);

  const dayTasks = useMemo(() => {
    return tasks
      .filter((t) => {
        const range = getTaskDateRange(t);
        return !!range && range.start <= selectedYmd && range.end >= selectedYmd;
      })
      .sort((a, b) => {
        const aDone = a.done || a.status === 'done' ? 1 : 0;
        const bDone = b.done || b.status === 'done' ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        const am = parseTimeToMinutes(a.startTime);
        const bm = parseTimeToMinutes(b.startTime);
        if (am !== null && bm !== null && am !== bm) return am - bm;
        if (am !== null && bm === null) return -1;
        if (am === null && bm !== null) return 1;
        return a.prio - b.prio;
      });
  }, [tasks, selectedYmd]);

  const unscheduledTasks = useMemo(
    () =>
      tasks
        .filter((t) => !t.done && t.status !== 'done' && !getTaskDateRange(t))
        .sort((a, b) => a.prio - b.prio || (b.updatedAt || 0) - (a.updatedAt || 0)),
    [tasks],
  );

  const shiftPeriod = (dir: -1 | 1) => {
    if (compactWeek) {
      setSelectedYmd(shiftDate(selectedYmd, dir * 7));
    } else {
      const d = new Date(viewYear, viewMonth + dir, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      setSelectedYmd(`${y}-${m}-01`);
    }
  };

  const handleToggle = async (t: Task) => {
    try {
      const saved = await mobileApi.updateTask(t.id, {
        done: !(t.done || t.status === 'done'),
      });
      onTaskUpdated(saved);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  const handleAssignDate = async (t: Task) => {
    try {
      const saved = await mobileApi.updateTask(t.id, { due: selectedYmd });
      onTaskUpdated(saved);
      onToast(zh ? `已排入 ${selectedYmd}` : `Scheduled for ${selectedYmd}`, 'ok');
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  const lunarInfo = zh ? getLunarDate(selectedYmd) : null;
  const rows = compactWeek ? [weekDates] : monthWeeks;
  const monthTitle = zh
    ? `${viewYear}年${viewMonth + 1}月`
    : selectedDate.toLocaleString('en-US', { year: 'numeric', month: 'long' });

  return (
    <div className="h-full flex flex-col">
      {/* Calendar Header & Grid */}
      <div
        className="px-4 pt-2.5 pb-2.5 shrink-0"
        style={{
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--hairline-soft)',
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftPeriod(-1)}
              className="p-1.5 rounded-[8px]"
              style={{ color: 'var(--text-2)' }}
              aria-label="Previous"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[14.5px] font-semibold px-1" style={{ color: 'var(--text-1)' }}>
              {monthTitle}
            </span>
            <button
              type="button"
              onClick={() => shiftPeriod(1)}
              className="p-1.5 rounded-[8px]"
              style={{ color: 'var(--text-2)' }}
              aria-label="Next"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {selectedYmd !== today && (
              <button
                type="button"
                onClick={() => setSelectedYmd(today)}
                className="px-2.5 py-1 rounded-[8px] text-[12px] font-semibold"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                {zh ? '今天' : 'Today'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setCompactWeek((v) => !v)}
              className="px-2 py-1 rounded-[8px] text-[12px] inline-flex items-center gap-0.5"
              style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
            >
              {compactWeek ? (zh ? '展开月历' : 'Month') : zh ? '收起周历' : 'Week'}
              {compactWeek ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Weekday labels */}
        <div className="grid grid-cols-7 text-center mb-1">
          {(zh ? WEEKDAYS_ZH : WEEKDAYS_EN).map((w, i) => (
            <div key={i} className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>
              {w}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="space-y-1">
          {rows.map((week, rIdx) => (
            <div key={rIdx} className="grid grid-cols-7 gap-0.5">
              {week.map((ymd) => {
                const d = parseLocalDate(ymd);
                const inMonth = d.getMonth() === viewMonth;
                const isSelected = ymd === selectedYmd;
                const isToday = ymd === today;
                const count = dateTaskDots.get(ymd) || 0;
                const lunar = zh ? getLunarDate(ymd) : null;
                return (
                  <button
                    key={ymd}
                    type="button"
                    onClick={() => setSelectedYmd(ymd)}
                    className="py-1 rounded-[10px] flex flex-col items-center justify-center relative"
                    style={{
                      background: isSelected
                        ? 'var(--accent)'
                        : isToday
                          ? 'var(--accent-soft)'
                          : 'transparent',
                      color: isSelected
                        ? '#ffffff'
                        : isToday
                          ? 'var(--accent)'
                          : inMonth
                            ? 'var(--text-1)'
                            : 'var(--text-4)',
                    }}
                  >
                    <span className="text-[13px] font-semibold leading-none">{d.getDate()}</span>
                    {lunar && (
                      <span
                        className="text-[9.5px] leading-tight mt-0.5 truncate max-w-full"
                        style={{
                          opacity: isSelected ? 0.9 : 0.65,
                        }}
                      >
                        {lunar.shortLabel}
                      </span>
                    )}
                    <span
                      className="w-1.5 h-1.5 rounded-full mt-0.5"
                      style={{
                        background:
                          count > 0
                            ? isSelected
                              ? '#ffffff'
                              : 'var(--accent)'
                            : 'transparent',
                      }}
                    />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Selected Day Agenda */}
      <div className="flex-1 overflow-y-auto m-scroll px-4 py-3 pb-24 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[14.5px] font-semibold" style={{ color: 'var(--text-1)' }}>
              {selectedYmd} · {weekdayLabel(selectedYmd, lang)}
            </div>
            {lunarInfo && (
              <div className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                {lunarInfo.fullLabel}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => onNewTaskOnDate(selectedYmd)}
            className="ap-btn-primary px-3 py-1.5 rounded-[10px] text-[12.5px] font-semibold inline-flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            {zh ? '排入新任务' : 'Add'}
          </button>
        </div>

        {dayTasks.length === 0 ? (
          <div
            className="py-10 rounded-[14px] text-center text-[13px]"
            style={{
              background: 'var(--bg-card)',
              border: '1px dashed var(--hairline)',
              color: 'var(--text-3)',
            }}
          >
            {zh ? '这一天暂无排期任务' : 'No scheduled tasks for this day'}
          </div>
        ) : (
          <div className="space-y-2">
            {dayTasks.map((t) => {
              const done = t.done || t.status === 'done';
              const proj = t.projectId ? projectMap.get(t.projectId) : undefined;
              const meta = proj ? getProjectColorMeta(proj) : null;
              const timeStr = formatTimeRange(t.startTime, t.endTime);
              const range = getTaskDateRange(t);
              const isSpan = !!range && range.start < range.end;
              return (
                <div
                  key={t.id}
                  onClick={() => onEditTask(t)}
                  className="rounded-[13px] px-3 py-2.5 flex items-start gap-2.5"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--hairline-soft)',
                    boxShadow: 'var(--shadow-card)',
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleToggle(t);
                    }}
                    className="w-7 h-7 -ml-0.5 flex items-center justify-center shrink-0"
                  >
                    <span
                      className="w-5 h-5 rounded-full inline-flex items-center justify-center"
                      style={{
                        background: done ? 'var(--accent)' : 'transparent',
                        border: done ? '2px solid var(--accent)' : '2px solid var(--text-3)',
                        color: '#ffffff',
                      }}
                    >
                      {done && <Check className="w-3 h-3" strokeWidth={2.8} />}
                    </span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-[14px] font-medium ${done ? 'line-through opacity-55' : ''}`}
                      style={{ color: 'var(--text-1)' }}
                    >
                      {t.title}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                      {timeStr ? (
                        <span
                          className="px-1.5 py-0.5 rounded-[5px] inline-flex items-center gap-1 font-medium"
                          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                        >
                          <Clock className="w-3 h-3" />
                          {timeStr}
                        </span>
                      ) : (
                        <span
                          className="px-1.5 py-0.5 rounded-[5px]"
                          style={{ background: 'var(--bg-subtle)', color: 'var(--text-3)' }}
                        >
                          {zh ? '全天' : 'All day'}
                        </span>
                      )}
                      {isSpan && range && (
                        <span
                          className="px-1.5 py-0.5 rounded-[5px]"
                          style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
                        >
                          {range.start.slice(5)} → {range.end.slice(5)}
                        </span>
                      )}
                      {proj && meta && (
                        <span
                          className="px-1.5 py-0.5 rounded-[5px] font-medium"
                          style={{ background: meta.soft, color: meta.dot }}
                        >
                          {proj.name}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Unscheduled Tasks Pool */}
        {unscheduledTasks.length > 0 && (
          <div
            className="rounded-[14px] overflow-hidden"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--hairline-soft)',
            }}
          >
            <button
              type="button"
              onClick={() => setShowUnscheduled((v) => !v)}
              className="w-full px-3.5 py-2.5 flex items-center justify-between text-[13px] font-semibold"
              style={{ color: 'var(--text-2)' }}
            >
              <span>
                {zh
                  ? `未排期待办（${unscheduledTasks.length}）`
                  : `Unscheduled Tasks (${unscheduledTasks.length})`}
              </span>
              {showUnscheduled ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
            {showUnscheduled && (
              <div className="px-3 pb-3 space-y-1.5">
                {unscheduledTasks.map((t) => (
                  <div
                    key={t.id}
                    className="px-2.5 py-2 rounded-[10px] flex items-center gap-2"
                    style={{ background: 'var(--bg-subtle)' }}
                  >
                    <span
                      onClick={() => onEditTask(t)}
                      className="text-[13px] flex-1 truncate"
                      style={{ color: 'var(--text-1)' }}
                    >
                      {t.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleAssignDate(t)}
                      className="px-2.5 py-1 rounded-[8px] text-[11.5px] font-semibold inline-flex items-center gap-1 shrink-0"
                      style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      <CalendarPlus className="w-3.5 h-3.5" />
                      {zh ? '排入此日' : 'Schedule'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
