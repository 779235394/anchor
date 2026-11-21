import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignLeft,
  CheckCircle2,
  ChevronUp,
  FastForward,
  FolderKanban,
  GitBranch,
  Paperclip,
  Plus,
  Trash2,
} from 'lucide-react';
import { isActive, type Attachment, type Priority, type Task } from '@/domain/types';
import { markdownToPlainText } from '@/domain/markdown';
import {
  formatClock,
  formatDate,
  humanDate,
  monthEnd,
  todayStr,
  weekEnd,
  weekdayLabel,
} from '@/domain/date';
import { getDict } from '@/i18n';
import { registerNativeDropZone } from '@/services/storage';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { CircularCheck, PRIO_COLORS } from '@/components/CircularCheck';
import { SegmentedControl } from '@/components/SegmentedControl';
import { InspectorDrawer } from '@/components/InspectorDrawer';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/Dialogs';
import {
  AttachmentBadges,
  AttachmentPanel,
  ingestBrowserFilesToAttachments,
  ingestLocalPathsToAttachments,
  interceptSmartPaste,
} from '@/components/AttachmentPanel';
import { RichTextEditor, type RichTextEditorHandle } from '@/components/RichTextEditor';

type TaskSeg = 'today' | 'overdue' | 'week' | 'month' | 'all' | 'done';

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
    updateTask,
    toggleTask,
    postponeTask,
    postponeAllOverdue,
    deleteTask,
    addAttachment,
    removeAttachment,
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
  const [confirmRollAll, setConfirmRollAll] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  const activeTasks = useMemo(() => data.tasks.filter(isActive), [data.tasks]);
  const activeProjects = useMemo(() => data.projects.filter(isActive), [data.projects]);
  const workspaceCompletelyEmpty = useMemo(
    () =>
      activeTasks.length === 0 &&
      activeProjects.length === 0 &&
      !data.notes.some(isActive) &&
      !data.assignments.some(isActive) &&
      !data.members.some(isActive) &&
      !data.daily.some(isActive),
    [activeTasks.length, activeProjects.length, data.notes, data.assignments, data.members, data.daily],
  );

  const openProjects = useMemo(
    () => activeProjects.filter((p) => p.status !== 'done'),
    [activeProjects],
  );
  const projMap = useMemo(
    () => new Map(activeProjects.map((p) => [p.id, p])),
    [activeProjects],
  );

  const prioLabels: Record<Priority, { full: string; short: string }> = {
    1: { full: t.prio1, short: t.prio1Short },
    2: { full: t.prio2, short: t.prio2Short },
    3: { full: t.prio3, short: t.prio3Short },
    4: { full: t.prio4, short: t.prio4Short },
  };

  const counts = useMemo(() => {
    const overdue = activeTasks.filter((k) => !k.done && !!k.due && k.due < today);
    const todayOpen = activeTasks.filter((k) => !k.done && (!k.due || k.due <= today));
    const week = activeTasks.filter((k) => !k.done && !!k.due && k.due > today && k.due <= wEnd);
    const month = activeTasks.filter((k) => !k.done && !!k.due && k.due > wEnd && k.due <= mEnd);
    return {
      overdue: overdue.length,
      todayOpen: todayOpen.length,
      week: week.length,
      month: month.length,
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

  const selectedTask =
    inspector?.kind === 'task'
      ? activeTasks.find((k) => k.id === inspector.id) || null
      : null;

  const submitQuickTask = () => {
    const plainFromNote = markdownToPlainText(quickNote).split(/\r?\n/)[0]?.trim() || '';
    const trimmed =
      quickTitle.trim() || plainFromNote.slice(0, 140) || quickAttachments[0]?.name || '';
    if (!trimmed) return;
    const pid =
      taskProjectFilter && taskProjectFilter !== '__none' ? taskProjectFilter : '';
    const created = addTask({
      title: trimmed,
      note: quickNote.trim(),
      prio: quickPrio,
      due: quickDue,
      projectId: pid,
      attachments: quickAttachments,
    });
    setQuickTitle('');
    setQuickNote('');
    setQuickAttachments([]);
    openInspector({ kind: 'task', id: created.id });
  };

  const cyclePrio = () => {
    setQuickPrio((p) => ((p % 4) + 1) as Priority);
  };

  const deleteTarget = confirmDeleteId
    ? activeTasks.find((k) => k.id === confirmDeleteId) || null
    : null;

  const groupedByDate = useMemo(() => {
    if (seg !== 'week' && seg !== 'month') return null;
    const map = new Map<string, Task[]>();
    for (const k of filteredTasks) {
      const key = k.due || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(k);
    }
    return [...map.entries()].sort((a, b) =>
      (a[0] || '9999-99-99').localeCompare(b[0] || '9999-99-99'),
    );
  }, [seg, filteredTasks]);

  const renderTaskItem = (task: Task, idx: number, total: number) => {
    const overdue = !task.done && !!task.due && task.due < today;
    const selected = selectedTask?.id === task.id;
    const proj = task.projectId ? projMap.get(task.projectId) : null;

    return (
      <div
        key={task.id}
        onClick={() => openInspector({ kind: 'task', id: task.id })}
        className="group flex items-start gap-3 px-4 py-3.5 cursor-pointer ap-ease"
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
            className="text-[14px] font-medium leading-snug break-words"
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

          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
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
                : humanDate(task.due, config.lang, today)}
            </span>

            {proj && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setTaskProjectFilter(taskProjectFilter === proj.id ? '' : proj.id);
                }}
                className="ap-pill"
                style={{
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                }}
              >
                {proj.name}
              </button>
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

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 ap-ease shrink-0">
          {!task.done && (
            <button
              type="button"
              title={t.postponeTomorrow}
              onClick={(e) => {
                e.stopPropagation();
                postponeTask(task.id);
              }}
              className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center hover:bg-[var(--bg-subtle-hover)]"
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
            className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center hover:bg-[var(--status-red-soft)]"
            style={{ color: 'var(--text-3)' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full min-w-0">
      {/* Main Canvas */}
      <div className="flex-1 min-w-0 overflow-y-auto px-8 py-7">
        <div className="max-w-[820px] mx-auto space-y-5">
          {/* Header */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[24px] font-semibold tracking-[-0.025em] leading-tight">
                {t.tasksTitle}
              </h1>
              <p className="text-[13px] mt-1" style={{ color: 'var(--text-2)' }}>
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

          {/* Segmented Filters */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <SegmentedControl<TaskSeg>
              value={seg}
              onChange={setSeg}
              options={[
                { value: 'today', label: t.segToday, count: counts.todayOpen },
                { value: 'overdue', label: t.segOverdue, count: counts.overdue, danger: true },
                { value: 'week', label: t.segWeek, count: counts.week },
                { value: 'month', label: t.segMonth, count: counts.month },
                { value: 'all', label: t.segAll },
                { value: 'done', label: t.segDone },
              ]}
            />
          </div>

          {/* Optional Project Filter Strip */}
          {openProjects.length > 0 && (
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
              {openProjects.map((p) => {
                const on = taskProjectFilter === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setTaskProjectFilter(on ? '' : p.id)}
                    className="ap-pill ap-ease"
                    style={{
                      background: on ? 'var(--accent)' : 'var(--bg-subtle)',
                      color: on ? '#fff' : 'var(--text-2)',
                    }}
                  >
                    <FolderKanban className="w-3 h-3" />
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
                {t.noProject}
              </button>
            </div>
          )}

          {/* Smart Expandable Rich Quick Composer */}
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
              const files = e.dataTransfer?.files;
              setQuickDragOver(false);
              if (files && files.length > 0) {
                e.preventDefault();
                void ingestBrowserFilesToAttachments(
                  files,
                  addDraftAttachment,
                  pushToast,
                  t.attAdded,
                  t.attLargeWarn,
                );
              }
            }}
            className="relative ap-card px-3.5 py-2.5 space-y-2.5"
          >
            {quickDragOver && (
              <div
                className="pointer-events-none absolute inset-0 rounded-[14px] flex items-center justify-center gap-1.5 text-[12.5px] font-medium z-20"
                style={{
                  background: 'color-mix(in srgb, var(--accent) 12%, var(--bg-card))',
                  border: '1.5px dashed var(--accent)',
                  color: 'var(--accent)',
                }}
              >
                <Paperclip className="w-3.5 h-3.5" />
                {t.richDropHint}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={cyclePrio}
                title={t.prioLabel}
                className="w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0 transition-transform hover:scale-110"
                style={{
                  border: `1.8px solid ${PRIO_COLORS[quickPrio].color}`,
                  background: PRIO_COLORS[quickPrio].soft,
                }}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: PRIO_COLORS[quickPrio].color }}
                />
              </button>
              <input
                id="quick-capture-input"
                type="text"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.shiftKey) {
                      setQuickExpanded(true);
                      setTimeout(() => quickNoteRef.current?.focus(), 20);
                    } else {
                      submitQuickTask();
                    }
                  }
                }}
                onPaste={(e) => {
                  interceptSmartPaste(
                    e,
                    addDraftAttachment,
                    pushToast,
                    t.attAdded,
                    t.attLargeWarn,
                    (fallback) => setQuickTitle((prev) => `${prev}${fallback}`),
                    () => setQuickExpanded(true),
                  );
                }}
                placeholder={t.quickTaskPh}
                maxLength={140}
                className="flex-1 min-w-[180px] bg-transparent border-0 outline-none text-[14px]"
                style={{ color: 'var(--text-1)' }}
              />
              <button
                type="button"
                onClick={() => {
                  setQuickExpanded((v) => {
                    const next = !v;
                    if (next) setTimeout(() => quickNoteRef.current?.focus(), 30);
                    return next;
                  });
                }}
                title={t.quickNoteToggle}
                className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center ap-ease shrink-0"
                style={{
                  background:
                    quickExpanded || quickNote || quickAttachments.length > 0
                      ? 'var(--accent-soft)'
                      : 'transparent',
                  color:
                    quickExpanded || quickNote || quickAttachments.length > 0
                      ? 'var(--accent)'
                      : 'var(--text-3)',
                }}
              >
                {quickExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <AlignLeft className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={cyclePrio}
                className="ap-pill shrink-0"
                style={{
                  background: PRIO_COLORS[quickPrio].soft,
                  color: PRIO_COLORS[quickPrio].color,
                }}
              >
                {prioLabels[quickPrio].short}
              </button>
              <input
                type="date"
                value={quickDue}
                onChange={(e) => setQuickDue(e.target.value)}
                className="ap-input py-1 px-2 text-[12px] w-[132px]"
              />
              <button
                type="button"
                onClick={submitQuickTask}
                className="ap-btn ap-btn-primary ap-btn-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                {t.add}
              </button>
            </div>

            {(quickExpanded || quickNote.length > 0 || quickAttachments.length > 0) && (
              <div
                className="pt-2.5 space-y-2.5"
                style={{ borderTop: '1px solid var(--hairline-soft)' }}
              >
                <RichTextEditor
                  value={quickNote}
                  onChange={setQuickNote}
                  placeholder={t.quickTaskNotePh}
                  minHeight={58}
                  maxHeight={180}
                  submitOnEnter
                  onSubmit={submitQuickTask}
                  onAddAttachment={addDraftAttachment}
                  dropPriority={3}
                  editorRef={quickNoteRef}
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
          </div>

          {/* Task List (Date-grouped for Week/Month, flat crisp list otherwise) */}
          {filteredTasks.length === 0 ? (
            <div className="ap-card overflow-hidden">
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
                  seg === 'today' && workspaceCompletelyEmpty && !gitStatus?.isRepo ? (
                    <button
                      type="button"
                      onClick={() => setView('settings')}
                      className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-full ap-ease hover:opacity-80"
                      style={{
                        background: 'var(--accent-soft)',
                        color: 'var(--accent)',
                      }}
                    >
                      <GitBranch className="w-3.5 h-3.5" />
                      {t.emptyGitHint}
                    </button>
                  ) : undefined
                }
              />
            </div>
          ) : groupedByDate ? (
            <div className="space-y-4">
              {groupedByDate.map(([dateKey, items]) => (
                <div key={dateKey || '__nodue'} className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[13px] font-semibold"
                        style={{ color: 'var(--text-1)' }}
                      >
                        {dateKey ? humanDate(dateKey, config.lang, today) : t.dueDateLabel}
                      </span>
                      {dateKey && (
                        <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                          {dateKey.slice(5).replace('-', '/')} · {weekdayLabel(dateKey, config.lang)}
                        </span>
                      )}
                    </div>
                    <span
                      className="ap-pill"
                      style={{ background: 'var(--bg-subtle)', color: 'var(--text-3)' }}
                    >
                      {items.length}
                    </span>
                  </div>
                  <div className="ap-card overflow-hidden">
                    {items.map((task, idx) => renderTaskItem(task, idx, items.length))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ap-card overflow-hidden">
              {filteredTasks.map((task, idx) =>
                renderTaskItem(task, idx, filteredTasks.length),
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Apple Inspector Drawer (Global Cmd/Ctrl+V screenshot & file-path paste anywhere inside) */}
      {selectedTask && (
        <InspectorDrawer
          title={t.inspector}
          onPaste={(e) => {
            if (e.defaultPrevented) return;
            interceptSmartPaste(
              e,
              (att) => addAttachment('task', selectedTask.id, att),
              pushToast,
              t.attAdded,
              t.attLargeWarn,
            );
          }}
          badge={
            <span
              className="ap-pill"
              style={{
                background: selectedTask.done
                  ? 'var(--status-green-soft)'
                  : 'var(--bg-subtle)',
                color: selectedTask.done ? 'var(--status-green)' : 'var(--text-2)',
              }}
            >
              {selectedTask.done ? t.done : t.active}
            </span>
          }
          onClose={() => openInspector(null)}
          footer={
            <>
              {!selectedTask.done && (
                <button
                  type="button"
                  onClick={() => postponeTask(selectedTask.id)}
                  className="ap-btn flex-1"
                >
                  {t.postponeTomorrow}
                </button>
              )}
              <button
                type="button"
                onClick={() => toggleTask(selectedTask.id)}
                className="ap-btn ap-btn-primary flex-1"
              >
                {selectedTask.done ? t.markUndone : t.markDone}
              </button>
            </>
          }
        >
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.taskTitleLabel}
            </label>
            <textarea
              rows={2}
              value={selectedTask.title}
              onChange={(e) => updateTask(selectedTask.id, { title: e.target.value })}
              className="ap-input w-full resize-none"
              maxLength={140}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.prioLabel}
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {([1, 2, 3, 4] as Priority[]).map((p) => {
                const active = selectedTask.prio === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => updateTask(selectedTask.id, { prio: p })}
                    className="px-2.5 py-2 rounded-[9px] text-[12px] font-medium flex items-center gap-2 ap-ease"
                    style={{
                      background: active ? PRIO_COLORS[p].soft : 'var(--bg-subtle)',
                      color: active ? PRIO_COLORS[p].color : 'var(--text-2)',
                      boxShadow: active ? `inset 0 0 0 1px ${PRIO_COLORS[p].color}` : 'none',
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: PRIO_COLORS[p].color }}
                    />
                    <span>{prioLabels[p].short}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
                {t.dueDateLabel}
              </label>
              <input
                type="date"
                value={selectedTask.due}
                onChange={(e) => updateTask(selectedTask.id, { due: e.target.value })}
                className="ap-input w-full text-[12.5px] py-1.5"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
                {t.postponeCostLabel}
              </label>
              <div
                className="px-2.5 py-[7px] rounded-[9px] text-[12.5px] font-medium"
                style={{
                  background: selectedTask.rolls
                    ? 'var(--status-orange-soft)'
                    : 'var(--bg-subtle)',
                  color: selectedTask.rolls ? 'var(--status-orange)' : 'var(--text-3)',
                }}
              >
                {selectedTask.rolls ? t.rollsBadge(selectedTask.rolls) : t.postponeZero}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.projectLabel}
            </label>
            <select
              value={selectedTask.projectId}
              onChange={(e) => updateTask(selectedTask.id, { projectId: e.target.value })}
              className="ap-input w-full"
            >
              <option value="">{t.noProject}</option>
              {activeProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.notesLabel}
            </label>
            <RichTextEditor
              variant="input"
              value={selectedTask.note}
              onChange={(note) => updateTask(selectedTask.id, { note })}
              placeholder={t.richInspectorPh}
              minHeight={108}
              maxHeight={260}
              dropPriority={10}
              onAddAttachment={(att) => addAttachment('task', selectedTask.id, att)}
            />
          </div>

          <AttachmentPanel
            attachments={selectedTask.attachments || []}
            onAdd={(att) => addAttachment('task', selectedTask.id, att)}
            onRemove={(attId) => removeAttachment('task', selectedTask.id, attId)}
          />

          <div className="pt-2">
            <button
              type="button"
              onClick={() => setConfirmDeleteId(selectedTask.id)}
              className="ap-btn ap-btn-danger ap-btn-sm w-full"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t.delete}
            </button>
          </div>
        </InspectorDrawer>
      )}

      <ConfirmDialog
        open={confirmRollAll}
        title={t.rollAllOverdue}
        body={
          config.lang === 'zh'
            ? `将 ${counts.overdue} 条逾期任务的截止日期统一顺延到明天？每条任务会记一次顺延次数。`
            : `Postpone ${counts.overdue} overdue task(s) to tomorrow? Each records one postponement.`
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
