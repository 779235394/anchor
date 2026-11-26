import { useMemo, useState, type DragEvent } from 'react';
import {
  ArrowRight,
  Calendar,
  CheckSquare,
  Paperclip,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  isActive,
  TASK_STATUS_ORDER,
  type Priority,
  type Task,
  type TaskStatus,
} from '@/domain/types';
import { humanDate, todayStr } from '@/domain/date';
import { getProjectColorMeta } from '@/domain/projectColor';
import { formatTimeRange } from '@/domain/schedule';
import { getDict, taskStatusLabel } from '@/i18n';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { CircularCheck, PRIO_COLORS } from '@/components/CircularCheck';
import { STATUS_COLORS, TaskInspector } from '@/components/TaskInspector';

type ScheduleFilter = 'all' | 'scheduled' | 'unscheduled' | 'overdue';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

function countChecklist(md: string): { done: number; total: number } | null {
  if (!md) return null;
  const matches = [...md.matchAll(/^\s*-\s+\[([ xX])\]/gm)];
  if (matches.length === 0) return null;
  const done = matches.filter((m) => m[1].toLowerCase() === 'x').length;
  return { done, total: matches.length };
}

function nextStatus(st: TaskStatus): TaskStatus | null {
  const idx = TASK_STATUS_ORDER.indexOf(st);
  if (idx < 0 || idx >= TASK_STATUS_ORDER.length - 1) return null;
  return TASK_STATUS_ORDER[idx + 1];
}

export function KanbanView() {
  const {
    config,
    data,
    inspector,
    openInspector,
    taskProjectFilter,
    setTaskProjectFilter,
    addTask,
    moveTaskStatus,
    toggleTask,
  } = useWorkbenchStore();

  const t = getDict(config.lang);
  const today = todayStr();

  const [query, setQuery] = useState('');
  const [prioFilter, setPrioFilter] = useState<Priority | 0>(0);
  const [schedFilter, setSchedFilter] = useState<ScheduleFilter>('all');
  const [addingCol, setAddingCol] = useState<TaskStatus | null>(null);
  const [addingTitle, setAddingTitle] = useState('');
  const [showOlderDone, setShowOlderDone] = useState(false);

  // Drag-and-drop state
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<TaskStatus | null>(null);
  const [hoverCardId, setHoverCardId] = useState<string | null>(null);

  const activeTasks = useMemo(() => data.tasks.filter(isActive), [data.tasks]);
  const activeProjects = useMemo(() => data.projects.filter(isActive), [data.projects]);
  const projectMap = useMemo(
    () => new Map(activeProjects.map((p) => [p.id, p])),
    [activeProjects],
  );

  const selectedTask =
    inspector?.kind === 'task'
      ? activeTasks.find((k) => k.id === inspector.id) || null
      : null;

  const filteredTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return activeTasks.filter((task) => {
      if (taskProjectFilter && task.projectId !== taskProjectFilter) return false;
      if (prioFilter && task.prio !== prioFilter) return false;
      if (schedFilter === 'scheduled' && !task.due && !task.startDate) return false;
      if (schedFilter === 'unscheduled' && (task.due || task.startDate)) return false;
      if (schedFilter === 'overdue' && (task.done || !task.due || task.due >= today)) return false;
      if (q) {
        const projName = task.projectId ? projectMap.get(task.projectId)?.name || '' : '';
        const match =
          task.title.toLowerCase().includes(q) ||
          task.note.toLowerCase().includes(q) ||
          projName.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [activeTasks, taskProjectFilter, prioFilter, schedFilter, query, projectMap, today]);

  const columns = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      todo: [],
      doing: [],
      confirm: [],
      done: [],
    };
    for (const task of filteredTasks) {
      const st: TaskStatus = task.status || (task.done ? 'done' : 'todo');
      map[st].push(task);
    }
    for (const st of TASK_STATUS_ORDER) {
      if (st === 'done') {
        map[st].sort((a, b) => (b.doneAt || b.updatedAt) - (a.doneAt || a.updatedAt));
      } else {
        map[st].sort((a, b) => {
          const ao = a.order ?? a.createdAt;
          const bo = b.order ?? b.createdAt;
          if (bo !== ao) return bo - ao;
          return a.prio - b.prio || b.updatedAt - a.updatedAt;
        });
      }
    }
    return map;
  }, [filteredTasks]);

  const counts = useMemo(() => {
    const open = activeTasks.filter((k) => !k.done).length;
    const doing = activeTasks.filter((k) => !k.done && k.status === 'doing').length;
    const confirm = activeTasks.filter((k) => !k.done && k.status === 'confirm').length;
    return { open, doing, confirm };
  }, [activeTasks]);

  const submitQuickAdd = (status: TaskStatus) => {
    const clean = addingTitle.trim();
    if (!clean) {
      setAddingCol(null);
      return;
    }
    addTask({
      title: clean,
      status,
      prio: prioFilter || 2,
      due: status === 'doing' ? today : '',
      projectId: taskProjectFilter,
    });
    setAddingTitle('');
    setAddingCol(null);
  };

  const handleDragStart = (e: DragEvent, taskId: string) => {
    setDraggedId(taskId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/anchor-task-id', taskId);
    e.dataTransfer.setData('text/plain', taskId);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setHoverCol(null);
    setHoverCardId(null);
  };

  const handleDropOnColumn = (e: DragEvent, targetCol: TaskStatus) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/anchor-task-id') || draggedId;
    if (!id) {
      handleDragEnd();
      return;
    }
    const list = columns[targetCol].filter((item) => item.id !== id);
    const topOrder = list.length > 0 ? (list[0].order ?? list[0].createdAt) + 1000 : Date.now();
    moveTaskStatus(id, targetCol, topOrder);
    handleDragEnd();
  };

  const handleDropOnCard = (e: DragEvent, targetCol: TaskStatus, targetTask: Task) => {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData('text/anchor-task-id') || draggedId;
    if (!id || id === targetTask.id) {
      handleDragEnd();
      return;
    }
    const list = columns[targetCol].filter((item) => item.id !== id);
    const idx = list.findIndex((item) => item.id === targetTask.id);
    let nextOrder = Date.now();
    if (idx === 0) {
      nextOrder = (list[0].order ?? list[0].createdAt) + 1000;
    } else if (idx > 0) {
      const above = list[idx - 1].order ?? list[idx - 1].createdAt;
      const below = list[idx].order ?? list[idx].createdAt;
      nextOrder = above === below ? above + 1 : (above + below) / 2;
    }
    moveTaskStatus(id, targetCol, nextOrder);
    handleDragEnd();
  };

  const nowTs = Date.now();

  return (
    <div className="relative flex h-full min-w-0 overflow-hidden">
      <div
        className="flex-1 min-w-0 h-full flex flex-col overflow-hidden"
        onClick={(e) => {
          if (!selectedTask) return;
          const target = e.target as HTMLElement | null;
          if (
            target?.closest(
              '[data-kanban-card], button, input, select, textarea, a, [role="button"]',
            )
          ) {
            return;
          }
          openInspector(null);
        }}
      >
        {/* Top Header & Filter Strip */}
        <div className="px-7 pb-4 shrink-0 space-y-3.5">
          <div
            data-tauri-drag-region="deep"
            className="pt-6 flex flex-wrap items-end justify-between gap-3 select-none"
          >
            <div>
              <h1 className="text-[24px] font-semibold tracking-[-0.025em] leading-tight">
                {t.kanbanTitle}
              </h1>
              <p className="text-[13px] mt-1" style={{ color: 'var(--text-2)' }}>
                {t.kanbanSub(counts.open, counts.doing, counts.confirm)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setAddingCol('todo');
                setAddingTitle('');
              }}
              className="ap-btn ap-btn-primary ap-btn-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              {t.create}
            </button>
          </div>

          {/* Filter Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-[200px]">
              <Search
                className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--text-3)' }}
              />
              <input
                id="quick-capture-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.kanbanSearchPh}
                className="ap-input w-full pl-8 py-1.5 text-[12.5px]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-3)' }}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <select
              value={taskProjectFilter}
              onChange={(e) => setTaskProjectFilter(e.target.value)}
              className="ap-input py-1.5 pl-2.5 pr-7 text-[12.5px] min-w-[128px]"
            >
              <option value="">{t.all} · {t.projectLabel}</option>
              {activeProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <select
              value={prioFilter}
              onChange={(e) => setPrioFilter(Number(e.target.value) as Priority | 0)}
              className="ap-input py-1.5 pl-2.5 pr-7 text-[12.5px]"
            >
              <option value={0}>{t.all} · {t.prioLabel}</option>
              <option value={1}>{t.prio1Short}</option>
              <option value={2}>{t.prio2Short}</option>
              <option value={3}>{t.prio3Short}</option>
              <option value={4}>{t.prio4Short}</option>
            </select>

            <select
              value={schedFilter}
              onChange={(e) => setSchedFilter(e.target.value as ScheduleFilter)}
              className="ap-input py-1.5 pl-2.5 pr-7 text-[12.5px]"
            >
              <option value="all">{t.kanbanFilterAll}</option>
              <option value="scheduled">{t.kanbanFilterScheduled}</option>
              <option value="unscheduled">{t.kanbanFilterUnscheduled}</option>
              <option value="overdue">{t.kanbanFilterOverdue}</option>
            </select>

            {(taskProjectFilter || prioFilter !== 0 || schedFilter !== 'all' || query) && (
              <button
                type="button"
                onClick={() => {
                  setTaskProjectFilter('');
                  setPrioFilter(0);
                  setSchedFilter('all');
                  setQuery('');
                }}
                className="text-[12px] font-medium px-2 py-1 rounded-[7px] hover:bg-[var(--bg-subtle-hover)]"
                style={{ color: 'var(--accent)' }}
              >
                {config.lang === 'zh' ? '重置筛选' : 'Reset'}
              </button>
            )}
          </div>
        </div>

        {/* 4-Column Board Canvas */}
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden px-7 pb-6">
          <div className="h-full grid grid-cols-4 gap-3.5 min-w-[920px]">
            {TASK_STATUS_ORDER.map((colStatus) => {
              const style = STATUS_COLORS[colStatus];
              const allColItems = columns[colStatus];
              const isDoneCol = colStatus === 'done';
              const recentDone = isDoneCol
                ? allColItems.filter(
                    (k) => nowTs - (k.doneAt || k.updatedAt) <= FOURTEEN_DAYS_MS,
                  )
                : allColItems;
              const olderCount = isDoneCol ? allColItems.length - recentDone.length : 0;
              const visibleItems =
                isDoneCol && !showOlderDone ? recentDone : allColItems;

              const isDroppingHere = hoverCol === colStatus;

              return (
                <div
                  key={colStatus}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (hoverCol !== colStatus) setHoverCol(colStatus);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      if (hoverCol === colStatus) setHoverCol(null);
                    }
                  }}
                  onDrop={(e) => handleDropOnColumn(e, colStatus)}
                  className="h-full flex flex-col rounded-[14px] overflow-hidden ap-ease"
                  style={{
                    background: isDroppingHere ? 'var(--accent-soft)' : 'var(--bg-sidebar)',
                    border: isDroppingHere
                      ? '1.5px dashed var(--accent)'
                      : '1px solid var(--hairline)',
                  }}
                >
                  {/* Column Header */}
                  <div
                    className="px-3.5 py-3 shrink-0 flex items-center justify-between gap-2"
                    style={{ borderBottom: '1px solid var(--hairline-soft)' }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: style.dot }}
                      />
                      <span className="text-[13.5px] font-semibold truncate">
                        {taskStatusLabel(colStatus, config.lang)}
                      </span>
                      <span
                        className="text-[11px] font-semibold px-1.5 py-[1px] rounded-full min-w-[20px] text-center"
                        style={{
                          background: 'var(--bg-card)',
                          color: 'var(--text-2)',
                          border: '1px solid var(--hairline-soft)',
                        }}
                      >
                        {allColItems.length}
                      </span>
                    </div>
                    <button
                      type="button"
                      title={t.add}
                      onClick={() => {
                        setAddingCol(addingCol === colStatus ? null : colStatus);
                        setAddingTitle('');
                      }}
                      className="w-6 h-6 rounded-[7px] inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle-hover)]"
                      style={{ color: 'var(--text-3)' }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Column Cards Scroll Area */}
                  <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
                    {addingCol === colStatus && (
                      <div
                        className="ap-card p-2.5 space-y-2"
                        style={{ borderColor: 'var(--accent)' }}
                      >
                        <input
                          type="text"
                          value={addingTitle}
                          onChange={(e) => setAddingTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              submitQuickAdd(colStatus);
                            } else if (e.key === 'Escape') {
                              setAddingCol(null);
                            }
                          }}
                          placeholder={t.kanbanAddPh}
                          autoFocus
                          maxLength={140}
                          className="w-full bg-transparent border-0 outline-none text-[13px]"
                          style={{ color: 'var(--text-1)' }}
                        />
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setAddingCol(null)}
                            className="ap-btn ap-btn-sm py-1 px-2 text-[11.5px]"
                          >
                            {t.cancel}
                          </button>
                          <button
                            type="button"
                            onClick={() => submitQuickAdd(colStatus)}
                            className="ap-btn ap-btn-primary ap-btn-sm py-1 px-2.5 text-[11.5px]"
                          >
                            {t.add}
                          </button>
                        </div>
                      </div>
                    )}

                    {visibleItems.length === 0 && addingCol !== colStatus ? (
                      <div
                        className="py-10 px-3 text-center text-[12px] rounded-[10px]"
                        style={{ color: 'var(--text-4)' }}
                      >
                        {t.kanbanEmptyCol}
                      </div>
                    ) : (
                      visibleItems.map((task) => {
                        const selected = selectedTask?.id === task.id;
                        const overdue = !task.done && !!task.due && task.due < today;
                        const proj = task.projectId ? projectMap.get(task.projectId) : null;
                        const checklist = countChecklist(task.note);
                        const next = nextStatus(colStatus);
                        const isBeingDragged = draggedId === task.id;
                        const isHoveredTarget =
                          hoverCardId === task.id && draggedId && draggedId !== task.id;

                        return (
                          <div
                            key={task.id}
                            data-kanban-card="true"
                            draggable
                            onDragStart={(e) => handleDragStart(e, task.id)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (hoverCol !== colStatus) setHoverCol(colStatus);
                              if (hoverCardId !== task.id) setHoverCardId(task.id);
                            }}
                            onDrop={(e) => handleDropOnCard(e, colStatus, task)}
                            onClick={() => openInspector({ kind: 'task', id: task.id })}
                            className={`group ap-card p-3 space-y-2 cursor-grab active:cursor-grabbing ap-ease select-none ${
                              isBeingDragged ? 'opacity-40' : ''
                            }`}
                            style={{
                              borderColor: selected
                                ? 'var(--accent)'
                                : isHoveredTarget
                                  ? 'var(--accent)'
                                  : 'var(--hairline)',
                              boxShadow: isHoveredTarget
                                ? '0 -2px 0 0 var(--accent), var(--shadow-card)'
                                : undefined,
                            }}
                          >
                            <div className="flex items-start gap-2">
                              <div className="pt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                                <CircularCheck
                                  checked={task.done}
                                  prio={task.prio}
                                  size={17}
                                  onChange={() => toggleTask(task.id)}
                                />
                              </div>
                              <div
                                className="flex-1 min-w-0 text-[13.5px] font-medium leading-snug break-words"
                                style={{
                                  color: task.done
                                    ? 'var(--text-3)'
                                    : overdue
                                      ? 'var(--status-red)'
                                      : 'var(--text-1)',
                                  textDecoration: task.done ? 'line-through' : 'none',
                                }}
                              >
                                {task.title}
                              </div>
                              {next && (
                                <button
                                  type="button"
                                  title={`${taskStatusLabel(next, config.lang)}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    moveTaskStatus(task.id, next);
                                  }}
                                  className="w-6 h-6 rounded-[6px] opacity-0 group-hover:opacity-100 inline-flex items-center justify-center ap-ease hover:bg-[var(--accent-soft)] shrink-0"
                                  style={{ color: 'var(--accent)' }}
                                >
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>

                            {/* Metadata badges */}
                            <div className="flex flex-wrap items-center gap-1.5 pl-6">
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                title={`P${task.prio}`}
                                style={{ background: PRIO_COLORS[task.prio].color }}
                              />

                              {(task.due || task.startDate) && (
                                <span
                                  className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-[1px] rounded-[6px]"
                                  style={{
                                    background: overdue
                                      ? 'var(--status-red-soft)'
                                      : 'var(--bg-subtle)',
                                    color: overdue ? 'var(--status-red)' : 'var(--text-2)',
                                  }}
                                >
                                  <Calendar className="w-2.5 h-2.5" />
                                  {task.startDate && task.due && task.startDate !== task.due
                                    ? `${task.startDate.slice(5).replace('-', '/')}→${task.due.slice(5).replace('-', '/')}`
                                    : humanDate(task.due || task.startDate || '', config.lang, today)}
                                  {task.startTime
                                    ? ` ${formatTimeRange(task.startTime, task.endTime)}`
                                    : ''}
                                </span>
                              )}

                              {proj && (() => {
                                const pc = getProjectColorMeta(proj);
                                return (
                                  <span
                                    className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-[1px] rounded-[6px] truncate max-w-[116px]"
                                    style={{
                                      background: pc.soft,
                                      color: pc.dot,
                                    }}
                                  >
                                    <span
                                      className="w-1.5 h-1.5 rounded-full shrink-0"
                                      style={{ background: pc.dot }}
                                    />
                                    <span className="truncate">{proj.name}</span>
                                  </span>
                                );
                              })()}

                              {checklist && (
                                <span
                                  className="inline-flex items-center gap-1 text-[11px] px-1.5 py-[1px] rounded-[6px]"
                                  style={{
                                    background:
                                      checklist.done === checklist.total
                                        ? 'var(--status-green-soft)'
                                        : 'var(--bg-subtle)',
                                    color:
                                      checklist.done === checklist.total
                                        ? 'var(--status-green)'
                                        : 'var(--text-3)',
                                  }}
                                >
                                  <CheckSquare className="w-2.5 h-2.5" />
                                  {checklist.done}/{checklist.total}
                                </span>
                              )}

                              {task.attachments.length > 0 && (
                                <span
                                  className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-[1px] rounded-[6px]"
                                  style={{
                                    background: 'var(--bg-subtle)',
                                    color: 'var(--text-3)',
                                  }}
                                >
                                  <Paperclip className="w-2.5 h-2.5" />
                                  {task.attachments.length}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}

                    {isDoneCol && olderCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowOlderDone((v) => !v)}
                        className="w-full py-1.5 text-[11.5px] font-medium rounded-[8px] ap-ease hover:bg-[var(--bg-subtle-hover)]"
                        style={{ color: 'var(--text-3)' }}
                      >
                        {showOlderDone
                          ? t.kanbanHideOlderDone
                          : t.kanbanShowOlderDone(olderCount)}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <TaskInspector task={selectedTask} overlay />
    </div>
  );
}
