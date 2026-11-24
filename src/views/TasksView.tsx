import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FastForward,
  GitBranch,
  Inbox,
  Paperclip,
  Plus,
  Trash2,
} from 'lucide-react';
import { isActive, type Attachment, type Priority, type Project, type Task } from '@/domain/types';
import { markdownToPlainText } from '@/domain/markdown';
import { getProjectColorMeta } from '@/domain/projectColor';
import {
  formatClock,
  formatDate,
  humanDate,
  monthEnd,
  shiftDate,
  todayStr,
  weekEnd,
} from '@/domain/date';
import { getDict, taskStatusLabel } from '@/i18n';
import { formatTimeRange } from '@/domain/schedule';
import { registerNativeDropZone } from '@/services/storage';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { CircularCheck, PRIO_COLORS } from '@/components/CircularCheck';
import { SegmentedControl } from '@/components/SegmentedControl';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/Dialogs';
import { STATUS_COLORS, TaskDetailContent } from '@/components/TaskInspector';
import {
  AttachmentBadges,
  AttachmentPanel,
  ingestBrowserFilesToAttachments,
  ingestLocalPathsToAttachments,
  interceptSmartPaste,
} from '@/components/AttachmentPanel';
import { RichTextEditor, type RichTextEditorHandle } from '@/components/RichTextEditor';

type TaskSeg = 'today' | 'overdue' | 'week' | 'month' | 'all' | 'done';

interface ProjectTaskGroup {
  key: string; // project.id or '__none'
  project: Project | null;
  tasks: Task[];
}

export function TasksView() {
  const {
    config,
    data,
    gitStatus,
    inspector,
    setView,
    openInspector,
    taskProjectFilter,
    setTaskProjectFilter,
    addTask,
    toggleTask,
    postponeTask,
    postponeAllOverdue,
    deleteTask,
    addAttachment,
    pushToast,
  } = useWorkbenchStore();

  const t = getDict(config.lang);
  const today = todayStr();
  const wEnd = weekEnd(today, 0);
  const mEnd = monthEnd(today);

  const [seg, setSeg] = useState<TaskSeg>('today');
  const [quickTitle, setQuickTitle] = useState('');
  const [quickNote, setQuickNote] = useState('');
  const [quickAttachments, setQuickAttachments] = useState<Attachment[]>([]);
  const [quickExpanded, setQuickExpanded] = useState(true);
  const [quickDragOver, setQuickDragOver] = useState(false);
  const [quickPrio, setQuickPrio] = useState<Priority>(2);
  const [quickDue, setQuickDue] = useState(today);
  const [quickProjectId, setQuickProjectId] = useState('');

  const quickCardRef = useRef<HTMLDivElement | null>(null);
  const quickNoteRef = useRef<RichTextEditorHandle | null>(null);

  const addDraftAttachment = (att: Attachment) => {
    setQuickAttachments((prev) => [...prev, att]);
    setQuickExpanded(true);
  };

  useEffect(() => {
    return registerNativeDropZone({
      getElement: () => quickCardRef.current,
      priority: 2,
      onHoverChange: (hover) => setQuickDragOver(hover),
      onDropPaths: (paths) => {
        void ingestLocalPathsToAttachments(
          paths,
          addDraftAttachment,
          pushToast,
          t.attAdded,
          t.attLargeWarn,
        );
      },
    });
  }, [pushToast, t.attAdded, t.attLargeWarn]);

  // Inline per-project quick add & collapse state
  const [groupAddKey, setGroupAddKey] = useState<string | null>(null);
  const [groupAddTitle, setGroupAddTitle] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const [confirmRollAll, setConfirmRollAll] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const activeTasks = useMemo(() => data.tasks.filter(isActive), [data.tasks]);
  const activeProjects = useMemo(() => data.projects.filter(isActive), [data.projects]);

  const workspaceCompletelyEmpty = useMemo(
    () =>
      activeTasks.length === 0 &&
      activeProjects.length === 0 &&
      !data.notes.some(isActive),
    [activeTasks.length, activeProjects.length, data.notes],
  );

  // Sync quick-add project when external filter changes
  useEffect(() => {
    if (taskProjectFilter && taskProjectFilter !== '__none') {
      setQuickProjectId(taskProjectFilter);
    } else if (taskProjectFilter === '__none') {
      setQuickProjectId('');
    }
  }, [taskProjectFilter]);

  const prioLabels: Record<Priority, { short: string }> = {
    1: { short: t.prio1Short },
    2: { short: t.prio2Short },
    3: { short: t.prio3Short },
    4: { short: t.prio4Short },
  };

  const counts = useMemo(() => {
    const overdue = activeTasks.filter((k) => !k.done && !!k.due && k.due < today);
    const todayOpen = activeTasks.filter((k) => !k.done && (!k.due || k.due <= today));
    const week = activeTasks.filter((k) => !k.done && !!k.due && k.due > today && k.due <= wEnd);
    const month = activeTasks.filter((k) => !k.done && !!k.due && k.due > wEnd && k.due <= mEnd);
    const allOpen = activeTasks.filter((k) => !k.done);
    const done = activeTasks.filter((k) => k.done);
    return {
      overdue: overdue.length,
      todayOpen: todayOpen.length,
      week: week.length,
      month: month.length,
      allOpen: allOpen.length,
      done: done.length,
    };
  }, [activeTasks, today, wEnd, mEnd]);

  const filteredTasks = useMemo(() => {
    let list: Task[];
    if (seg === 'today') {
      list = activeTasks.filter(
        (k) =>
          (!k.done && (!k.due || k.due <= today)) ||
          (k.done && k.doneAt && formatDate(new Date(k.doneAt)) === today),
      );
    } else if (seg === 'overdue') {
      list = activeTasks.filter((k) => !k.done && !!k.due && k.due < today);
    } else if (seg === 'week') {
      list = activeTasks.filter((k) => !k.done && !!k.due && k.due > today && k.due <= wEnd);
    } else if (seg === 'month') {
      list = activeTasks.filter((k) => !k.done && !!k.due && k.due > wEnd && k.due <= mEnd);
    } else if (seg === 'done') {
      list = activeTasks.filter((k) => k.done);
    } else {
      list = activeTasks;
    }

    if (taskProjectFilter === '__none') {
      list = list.filter((k) => !k.projectId);
    } else if (taskProjectFilter) {
      list = list.filter((k) => k.projectId === taskProjectFilter);
    }

    return [...list].sort((a, b) => {
      if (seg === 'done') return (b.doneAt || 0) - (a.doneAt || 0);
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.prio !== b.prio) return a.prio - b.prio;
      return (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99');
    });
  }, [activeTasks, seg, taskProjectFilter, today, wEnd, mEnd]);

  // Group filtered tasks cleanly by Project (with trailing Uncategorized bucket)
  const projectGroups = useMemo<ProjectTaskGroup[]>(() => {
    const byProj = new Map<string, Task[]>();
    for (const task of filteredTasks) {
      const key = task.projectId || '__none';
      const arr = byProj.get(key);
      if (arr) arr.push(task);
      else byProj.set(key, [task]);
    }

    const groups: ProjectTaskGroup[] = [];
    for (const proj of activeProjects) {
      const list = byProj.get(proj.id);
      if (list && list.length > 0) {
        groups.push({ key: proj.id, project: proj, tasks: list });
        byProj.delete(proj.id);
      }
    }

    // Any remaining tasks (uncategorized or referencing unknown id)
    const uncategorized: Task[] = [];
    for (const rest of byProj.values()) {
      uncategorized.push(...rest);
    }
    if (uncategorized.length > 0) {
      groups.push({ key: '__none', project: null, tasks: uncategorized });
    }
    return groups;
  }, [filteredTasks, activeProjects]);

  // Keep a valid task selected in the permanent right detail pane whenever the list has items
  const selectedTask = useMemo(() => {
    if (inspector?.kind === 'task') {
      const exact = activeTasks.find((k) => k.id === inspector.id);
      if (exact) return exact;
    }
    return filteredTasks[0] || null;
  }, [inspector, activeTasks, filteredTasks]);

  const defaultDueForSeg = (targetSeg: TaskSeg): string => {
    if (targetSeg === 'week') return shiftDate(today, 1);
    if (targetSeg === 'month') return shiftDate(wEnd, 1);
    return today;
  };

  const submitQuickTask = (e?: React.FormEvent) => {
    e?.preventDefault();
    const plainFromNote = markdownToPlainText(quickNote).split(/\r?\n/)[0]?.trim() || '';
    const trimmed =
      quickTitle.trim() || plainFromNote.slice(0, 140) || quickAttachments[0]?.name || '';
    if (!trimmed) return;
    const created = addTask({
      title: trimmed,
      note: quickNote.trim(),
      prio: quickPrio,
      due: quickDue,
      projectId: quickProjectId,
      attachments: quickAttachments,
    });
    setQuickTitle('');
    setQuickNote('');
    setQuickAttachments([]);
    openInspector({ kind: 'task', id: created.id });
  };

  const submitGroupQuickTask = (groupKey: string) => {
    const trimmed = groupAddTitle.trim();
    if (!trimmed) return;
    const created = addTask({
      title: trimmed,
      prio: 2,
      due: defaultDueForSeg(seg),
      projectId: groupKey === '__none' ? '' : groupKey,
    });
    setGroupAddTitle('');
    setGroupAddKey(null);
    openInspector({ kind: 'task', id: created.id });
  };

  const cyclePrio = () => {
    setQuickPrio((p) => ((p % 4) + 1) as Priority);
  };

  const toggleGroupCollapsed = (key: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const deleteTarget = confirmDeleteId
    ? activeTasks.find((k) => k.id === confirmDeleteId) || null
    : null;

  const renderTaskRow = (task: Task, idx: number, total: number) => {
    const overdue = !task.done && !!task.due && task.due < today;
    const selected = selectedTask?.id === task.id;

    return (
      <div
        key={task.id}
        onClick={() => openInspector({ kind: 'task', id: task.id })}
        className="group flex items-start gap-2.5 px-3.5 py-2.5 cursor-pointer ap-ease"
        style={{
          background: selected ? 'var(--accent-soft)' : 'transparent',
          borderBottom: idx === total - 1 ? 'none' : '1px solid var(--hairline-soft)',
        }}
      >
        <div className="mt-0.5">
          <CircularCheck
            checked={task.done}
            prio={task.prio}
            onChange={() => toggleTask(task.id)}
            ariaLabel={t.markDone}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div
            className="text-[13.5px] font-medium leading-snug break-words"
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

          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {!task.done && (task.status === 'doing' || task.status === 'confirm') && (
              <span
                className="ap-pill"
                style={{
                  background: STATUS_COLORS[task.status].soft,
                  color: STATUS_COLORS[task.status].color,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: STATUS_COLORS[task.status].dot }}
                />
                {taskStatusLabel(task.status, config.lang)}
              </span>
            )}

            {(task.due || task.doneAt) && (
              <span
                className="ap-pill"
                style={{
                  background: task.done
                    ? 'var(--bg-subtle)'
                    : overdue
                      ? 'var(--status-red-soft)'
                      : 'var(--bg-subtle)',
                  color: task.done
                    ? 'var(--text-3)'
                    : overdue
                      ? 'var(--status-red)'
                      : 'var(--text-2)',
                }}
              >
                {task.done && task.doneAt
                  ? formatClock(task.doneAt, config.lang, today)
                  : task.startDate && task.due && task.startDate !== task.due
                    ? `${task.startDate.slice(5).replace('-', '/')} → ${task.due.slice(5).replace('-', '/')}`
                    : humanDate(task.due, config.lang, today)}
                {!task.done && task.startTime ? ` · ${formatTimeRange(task.startTime, task.endTime)}` : ''}
              </span>
            )}

            {task.rolls > 0 && !task.done && (
              <span
                className="ap-pill"
                style={{
                  background: 'var(--status-orange-soft)',
                  color: 'var(--status-orange)',
                }}
              >
                {t.rollsBadge(task.rolls)}
              </span>
            )}

            {task.carriedDate === today && !task.done && (
              <span
                className="ap-pill"
                style={{
                  background: 'var(--bg-subtle)',
                  color: 'var(--text-3)',
                }}
              >
                {t.carriedBadge}
              </span>
            )}

            <AttachmentBadges attachments={task.attachments} />
          </div>
        </div>

        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 ap-ease shrink-0">
          {!task.done && (
            <button
              type="button"
              title={t.postponeTomorrow}
              onClick={(e) => {
                e.stopPropagation();
                postponeTask(task.id);
              }}
              className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center hover:bg-[var(--bg-subtle-hover)]"
              style={{ color: 'var(--text-3)' }}
            >
              <FastForward className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            title={t.delete}
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDeleteId(task.id);
            }}
            className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center hover:bg-[var(--status-red-soft)]"
            style={{ color: 'var(--text-3)' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  const selectedStatus = selectedTask
    ? selectedTask.status || (selectedTask.done ? 'done' : 'todo')
    : 'todo';
  const selectedStatusStyle = STATUS_COLORS[selectedStatus];

  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      {/* LEFT PANE: Categorized Tasks Grouped by Project */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Sticky Top Header & Category Filters */}
        <div
          className="px-6 pt-5 pb-3.5 space-y-3 shrink-0"
          style={{ borderBottom: '1px solid var(--hairline-soft)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div>
              <h1 className="text-[22px] font-semibold tracking-[-0.025em] leading-tight">
                {t.tasksTitle}
              </h1>
              <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-2)' }}>
                {t.tasksSub(counts.todayOpen, counts.overdue)}
              </p>
            </div>
            {counts.overdue > 0 && (
              <button
                type="button"
                onClick={() => setConfirmRollAll(true)}
                className="ap-btn ap-btn-danger ap-btn-sm"
              >
                <FastForward className="w-3.5 h-3.5" />
                {t.rollAllOverdue} ({counts.overdue})
              </button>
            )}
          </div>

          {/* Task Kind / Category Tabs */}
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl<TaskSeg>
              value={seg}
              onChange={(nextSeg) => {
                setSeg(nextSeg);
                setQuickDue(defaultDueForSeg(nextSeg));
              }}
              options={[
                { value: 'today', label: t.segToday, count: counts.todayOpen },
                { value: 'overdue', label: t.segOverdue, count: counts.overdue, danger: true },
                { value: 'week', label: t.segWeek, count: counts.week },
                { value: 'month', label: t.segMonth, count: counts.month },
                { value: 'all', label: t.segAll, count: counts.allOpen },
                { value: 'done', label: t.segDone, count: counts.done },
              ]}
            />
          </div>

          {/* Project Filter Chips (quick narrowing when many projects exist) */}
          {activeProjects.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setTaskProjectFilter('')}
                className="ap-pill ap-ease"
                style={{
                  background: !taskProjectFilter ? 'var(--accent)' : 'var(--bg-subtle)',
                  color: !taskProjectFilter ? '#fff' : 'var(--text-2)',
                }}
              >
                {t.all}
              </button>
              {activeProjects.map((p) => {
                const on = taskProjectFilter === p.id;
                const c = getProjectColorMeta(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setTaskProjectFilter(on ? '' : p.id)}
                    className="ap-pill ap-ease"
                    style={{
                      background: on ? c.dot : 'var(--bg-subtle)',
                      color: on ? '#fff' : 'var(--text-2)',
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: on ? '#fff' : c.dot }}
                    />
                    {p.name}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() =>
                  setTaskProjectFilter(taskProjectFilter === '__none' ? '' : '__none')
                }
                className="ap-pill ap-ease"
                style={{
                  background: taskProjectFilter === '__none' ? 'var(--accent)' : 'var(--bg-subtle)',
                  color: taskProjectFilter === '__none' ? '#fff' : 'var(--text-2)',
                }}
              >
                {t.taskGroupUncategorized}
              </button>
            </div>
          )}

          {/* Clean Two-Row Quick Composer with Optional Expandable Rich Notes & Attachments */}
          <div
            ref={quickCardRef}
            onDragOver={(e) => {
              if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                setQuickDragOver(true);
              }
            }}
            onDragLeave={() => setQuickDragOver(false)}
            onDrop={(e) => {
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                e.preventDefault();
                setQuickDragOver(false);
                void ingestBrowserFilesToAttachments(
                  e.dataTransfer.files,
                  addDraftAttachment,
                  pushToast,
                  t.attAdded,
                  t.attLargeWarn,
                );
              }
            }}
            onPaste={(e) => {
              if (e.defaultPrevented) return;
              interceptSmartPaste(
                e,
                addDraftAttachment,
                pushToast,
                t.attAdded,
                t.attLargeWarn,
              );
            }}
            className="rounded-[12px] border ap-ease overflow-hidden"
            style={{
              background: 'var(--bg-card)',
              borderColor: quickDragOver ? 'var(--accent)' : 'var(--hairline)',
              boxShadow: quickDragOver
                ? '0 0 0 3px var(--accent-soft)'
                : '0 1px 2px rgba(15, 23, 42, 0.03)',
            }}
          >
            <form onSubmit={submitQuickTask}>
              {/* Row 1: Full-width Title Input */}
              <div className="px-3.5 pt-2.5 pb-2">
                <input
                  id="quick-capture-input"
                  type="text"
                  value={quickTitle}
                  onChange={(e) => setQuickTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (e.metaKey || e.ctrlKey) {
                        submitQuickTask();
                      } else {
                        setQuickExpanded(true);
                        setTimeout(() => quickNoteRef.current?.focus(), 20);
                      }
                    }
                  }}
                  placeholder={t.quickTaskPh}
                  maxLength={140}
                  className="w-full bg-transparent outline-none text-[14px] font-medium"
                  style={{ color: 'var(--text-1)' }}
                />
              </div>

              {/* Optional Expanded Rich Notes & Attachments */}
              {quickExpanded && (
                <div
                  className="px-3.5 py-2.5 space-y-2.5"
                  style={{ borderTop: '1px solid var(--hairline-soft)' }}
                >
                  <RichTextEditor
                    editorRef={quickNoteRef}
                    variant="plain"
                    showToolbar
                    value={quickNote}
                    onChange={setQuickNote}
                    placeholder={t.quickTaskNotePh}
                    minHeight={68}
                    maxHeight={180}
                    onSubmit={submitQuickTask}
                    onAddAttachment={addDraftAttachment}
                  />
                  <AttachmentPanel
                    compact
                    attachments={quickAttachments}
                    onAdd={addDraftAttachment}
                    onRemove={(attId) =>
                      setQuickAttachments((prev) => prev.filter((a) => a.id !== attId))
                    }
                  />
                </div>
              )}

              {/* Row 2: Clean Single-Row Controls Toolbar (Never Wraps Submit Button Awkwardly) */}
              <div
                className="px-3 py-2 flex items-center justify-between gap-2"
                style={{
                  background: 'var(--bg-subtle)',
                  borderTop: '1px solid var(--hairline-soft)',
                }}
              >
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                  <button
                    type="button"
                    onClick={cyclePrio}
                    title={t.prioLabel}
                    className="px-2 py-1 rounded-[7px] text-[11.5px] font-medium inline-flex items-center gap-1.5 shrink-0 ap-ease"
                    style={{
                      background: PRIO_COLORS[quickPrio].soft,
                      color: PRIO_COLORS[quickPrio].color,
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: PRIO_COLORS[quickPrio].color }}
                    />
                    {prioLabels[quickPrio].short}
                  </button>

                  <select
                    value={quickProjectId}
                    onChange={(e) => setQuickProjectId(e.target.value)}
                    aria-label={t.projectLabel}
                    className="ap-input py-1 pl-2.5 pr-7 text-[12px] max-w-[140px]"
                    style={{ backgroundColor: 'var(--bg-card)' }}
                  >
                    <option value="">{t.taskGroupUncategorized}</option>
                    {activeProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>

                  <input
                    type="date"
                    value={quickDue}
                    onChange={(e) => setQuickDue(e.target.value)}
                    aria-label={t.dueDateLabel}
                    className="ap-input py-1 px-2 text-[12px] w-[124px]"
                    style={{ background: 'var(--bg-card)' }}
                  />

                  <button
                    type="button"
                    onClick={() => setQuickExpanded((v) => !v)}
                    title={t.quickNoteToggle}
                    className="px-2 py-1 rounded-[7px] text-[11.5px] font-medium inline-flex items-center gap-1 shrink-0 ap-ease hover:bg-[var(--bg-subtle-hover)]"
                    style={{
                      background:
                        quickExpanded || quickNote.trim() || quickAttachments.length > 0
                          ? 'var(--accent-soft)'
                          : 'transparent',
                      color:
                        quickExpanded || quickNote.trim() || quickAttachments.length > 0
                          ? 'var(--accent)'
                          : 'var(--text-3)',
                    }}
                  >
                    {quickExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <AlignLeft className="w-3.5 h-3.5" />
                    )}
                    {quickAttachments.length > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <Paperclip className="w-3 h-3" />
                        {quickAttachments.length}
                      </span>
                    )}
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={!quickTitle.trim() && !quickNote.trim() && quickAttachments.length === 0}
                  className="ap-btn ap-btn-primary ap-btn-sm disabled:opacity-45 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t.add}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Scrollable Project-Grouped Task List */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-3.5">
          {projectGroups.length === 0 ? (
            <div className="ap-card">
              <EmptyState
                icon={<CheckCircle2 className="w-8 h-8" strokeWidth={1.5} />}
                title={
                  seg === 'today'
                    ? t.emptyTasksToday
                    : seg === 'overdue'
                      ? t.emptyTasksOverdue
                      : t.emptyTasksDefault
                }
                action={
                  workspaceCompletelyEmpty && config.storageMode === 'git' && !gitStatus?.isRepo ? (
                    <button
                      type="button"
                      onClick={() => setView('settings')}
                      className="ap-btn ap-btn-sm"
                    >
                      <GitBranch className="w-3.5 h-3.5" />
                      {t.emptyGitHint}
                    </button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            projectGroups.map((group) => {
              const collapsed = !!collapsedGroups[group.key];
              const colorMeta = group.project ? getProjectColorMeta(group.project) : null;
              const openInGroup = group.tasks.filter((k) => !k.done).length;

              return (
                <section key={group.key} className="ap-card overflow-hidden">
                  {/* Project Group Header */}
                  <div
                    className="px-3.5 py-2.5 flex items-center justify-between gap-2 select-none"
                    style={{
                      background: 'var(--bg-subtle)',
                      borderBottom: collapsed ? 'none' : '1px solid var(--hairline-soft)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleGroupCollapsed(group.key)}
                      className="flex items-center gap-2 min-w-0 flex-1 text-left"
                    >
                      {collapsed ? (
                        <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-3)' }} />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-3)' }} />
                      )}
                      {colorMeta ? (
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: colorMeta.dot }}
                        />
                      ) : (
                        <Inbox className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-3)' }} />
                      )}
                      <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                        {group.project ? group.project.name : t.taskGroupUncategorized}
                      </span>
                      <span
                        className="text-[11px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
                        style={{
                          background: colorMeta ? colorMeta.soft : 'var(--bg-card)',
                          color: colorMeta ? colorMeta.dot : 'var(--text-3)',
                        }}
                      >
                        {seg === 'done' ? group.tasks.length : `${openInGroup}/${group.tasks.length}`}
                      </span>
                    </button>

                    <button
                      type="button"
                      title={t.projAddTask}
                      onClick={() => {
                        if (collapsed) toggleGroupCollapsed(group.key);
                        setGroupAddKey(groupAddKey === group.key ? null : group.key);
                        setGroupAddTitle('');
                      }}
                      className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center hover:bg-[var(--bg-subtle-hover)] shrink-0"
                      style={{ color: 'var(--text-2)' }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Optional Inline Quick Add Inside Project Group */}
                  {!collapsed && groupAddKey === group.key && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        submitGroupQuickTask(group.key);
                      }}
                      className="px-3.5 py-2 flex items-center gap-2"
                      style={{ borderBottom: '1px solid var(--hairline-soft)' }}
                    >
                      <input
                        type="text"
                        value={groupAddTitle}
                        onChange={(e) => setGroupAddTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setGroupAddKey(null);
                            setGroupAddTitle('');
                          }
                        }}
                        placeholder={t.taskGroupAddPh}
                        className="ap-input flex-1 py-1 text-[12.5px]"
                        autoFocus
                      />
                      <button
                        type="submit"
                        disabled={!groupAddTitle.trim()}
                        className="ap-btn ap-btn-primary ap-btn-sm disabled:opacity-45"
                      >
                        {t.add}
                      </button>
                    </form>
                  )}

                  {/* Group Tasks */}
                  {!collapsed && (
                    <div>
                      {group.tasks.map((task, idx) => renderTaskRow(task, idx, group.tasks.length))}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>
      </div>

      {/* RIGHT PANE: Permanent Task Detail Inspector */}
      <aside
        onPaste={(e) => {
          if (!selectedTask || e.defaultPrevented) return;
          interceptSmartPaste(
            e,
            (att) => addAttachment('task', selectedTask.id, att),
            pushToast,
            t.attAdded,
            t.attLargeWarn,
          );
        }}
        className="w-[380px] lg:w-[420px] xl:w-[460px] shrink-0 h-full flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          borderLeft: '1px solid var(--hairline)',
        }}
      >
        {selectedTask ? (
          <>
            {/* Permanent Detail Header Bar */}
            <div
              className="px-5 py-3.5 flex items-center justify-between gap-2 shrink-0"
              style={{ borderBottom: '1px solid var(--hairline-soft)' }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <CircularCheck
                  checked={selectedTask.done}
                  prio={selectedTask.prio}
                  onChange={() => toggleTask(selectedTask.id)}
                  ariaLabel={t.markDone}
                />
                <span
                  className="ap-pill"
                  style={{
                    background: selectedStatusStyle.soft,
                    color: selectedStatusStyle.color,
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: selectedStatusStyle.dot }}
                  />
                  {taskStatusLabel(selectedStatus, config.lang)}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {!selectedTask.done && (
                  <button
                    type="button"
                    onClick={() => postponeTask(selectedTask.id)}
                    className="ap-btn ap-btn-sm"
                  >
                    <FastForward className="w-3.5 h-3.5" />
                    {t.postponeTomorrow}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => toggleTask(selectedTask.id)}
                  className="ap-btn ap-btn-primary ap-btn-sm"
                >
                  {selectedTask.done ? t.markUndone : t.markDone}
                </button>
              </div>
            </div>

            {/* Scrollable Detail Editor Body */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
              <TaskDetailContent task={selectedTask} />
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
              style={{ background: 'var(--bg-subtle)', color: 'var(--text-3)' }}
            >
              <CheckCircle2 className="w-6 h-6" strokeWidth={1.6} />
            </div>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
              {t.taskDetailEmpty}
            </p>
          </div>
        )}
      </aside>

      {/* Dialogs */}
      <ConfirmDialog
        open={confirmRollAll}
        title={t.rollAllOverdue}
        body={
          config.lang === 'zh'
            ? `将全部 ${counts.overdue} 条逾期个人待办统一顺延到明天（顺延次数 +1）？`
            : `Postpone all ${counts.overdue} overdue personal task(s) to tomorrow?`
        }
        confirmLabel={t.confirm}
        cancelLabel={t.cancel}
        onConfirm={() => {
          postponeAllOverdue();
          setConfirmRollAll(false);
        }}
        onCancel={() => setConfirmRollAll(false)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={t.delete}
        body={
          deleteTarget
            ? config.lang === 'zh'
              ? `确定删除任务「${deleteTarget.title}」？`
              : `Delete task "${deleteTarget.title}"?`
            : ''
        }
        confirmLabel={t.delete}
        cancelLabel={t.cancel}
        danger
        onConfirm={() => {
          if (deleteTarget) deleteTask(deleteTarget.id);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
