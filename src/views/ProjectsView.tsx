import { useMemo, useState } from 'react';
import {
  CheckSquare,
  FolderKanban,
  Inbox,
  Kanban,
  LayoutGrid,
  Columns3,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import {
  isActive,
  type Project,
  type ProjectColor,
  type Task,
} from '@/domain/types';
import {
  getProjectColorMeta,
  pickNextProjectColor,
  PROJECT_COLOR_PALETTE,
} from '@/domain/projectColor';
import { humanDate, todayStr } from '@/domain/date';
import { getDict, taskStatusLabel } from '@/i18n';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { CircularCheck, PRIO_COLORS } from '@/components/CircularCheck';
import { InspectorDrawer } from '@/components/InspectorDrawer';
import { STATUS_COLORS, TaskInspector } from '@/components/TaskInspector';
import { SegmentedControl } from '@/components/SegmentedControl';
import { EmptyState } from '@/components/EmptyState';
import { ChoiceDialog, ConfirmDialog } from '@/components/Dialogs';
import { AttachmentBadges } from '@/components/AttachmentPanel';

type ProjectViewMode = 'board' | 'grid';

const VIEW_MODE_KEY = 'anchor_projects_view_mode_v1';

function readInitialViewMode(): ProjectViewMode {
  try {
    const raw = localStorage.getItem(VIEW_MODE_KEY);
    if (raw === 'board' || raw === 'grid') return raw;
  } catch {
    // ignore
  }
  return 'board';
}

export function ProjectsView() {
  const {
    config,
    data,
    inspector,
    openInspector,
    setView,
    setTaskProjectFilter,
    addProject,
    updateProject,
    deleteProject,
    addTask,
    updateTask,
    toggleTask,
  } = useWorkbenchStore();

  const t = getDict(config.lang);
  const today = todayStr();

  const [viewMode, setViewModeState] = useState<ProjectViewMode>(readInitialViewMode);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDone, setShowDone] = useState(false);

  // Lightweight inline project creator
  const [creatingProject, setCreatingProject] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<ProjectColor>('blue');

  // Inline task creation inside a project column / card
  const [inlineTaskFor, setInlineTaskFor] = useState<string | null>(null);
  const [inlineTaskTitle, setInlineTaskTitle] = useState('');

  // Cross-project drag-and-drop state
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverColKey, setDragOverColKey] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<{ project: Project; linkedCount: number } | null>(
    null,
  );

  const setViewMode = (next: ProjectViewMode) => {
    setViewModeState(next);
    try {
      localStorage.setItem(VIEW_MODE_KEY, next);
    } catch {
      // ignore
    }
  };

  const activeProjects = useMemo(() => data.projects.filter(isActive), [data.projects]);
  const activeTasks = useMemo(() => data.tasks.filter(isActive), [data.tasks]);

  const linkedTasksCount = useMemo(
    () => activeTasks.filter((k) => !!k.projectId).length,
    [activeTasks],
  );

  const selectedProject =
    inspector?.kind === 'project'
      ? activeProjects.find((p) => p.id === inspector.id) || null
      : null;

  const selectedTask =
    inspector?.kind === 'task'
      ? activeTasks.find((k) => k.id === inspector.id) || null
      : null;

  const q = searchQuery.trim().toLowerCase();

  const tasksByProject = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const k of activeTasks) {
      const key = k.projectId || '__none';
      const arr = map.get(key);
      if (arr) arr.push(k);
      else map.set(key, [k]);
    }
    for (const [key, list] of map.entries()) {
      list.sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (a.prio !== b.prio) return a.prio - b.prio;
        return (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99');
      });
      map.set(key, list);
    }
    return map;
  }, [activeTasks]);

  const visibleProjects = useMemo(() => {
    if (!q) return activeProjects;
    return activeProjects.filter((p) => {
      if (p.name.toLowerCase().includes(q)) return true;
      const list = tasksByProject.get(p.id) || [];
      return list.some((k) => k.title.toLowerCase().includes(q));
    });
  }, [activeProjects, tasksByProject, q]);

  const uncategorizedTasks = useMemo(() => {
    const raw = tasksByProject.get('__none') || [];
    return raw.filter((k) => {
      if (!showDone && k.done) return false;
      if (q && !k.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasksByProject, showDone, q]);

  const openCreator = () => {
    setNewColor(pickNextProjectColor(activeProjects.length));
    setNewName('');
    setCreatingProject(true);
  };

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    addProject({ name: newName, color: newColor });
    setNewName('');
    setCreatingProject(false);
  };

  const handleQuickAddTask = (projectId: string) => {
    const trimmed = inlineTaskTitle.trim();
    if (!trimmed) return;
    addTask({
      title: trimmed,
      prio: 2,
      due: today,
      projectId: projectId === '__none' ? '' : projectId,
    });
    setInlineTaskTitle('');
    setInlineTaskFor(null);
  };

  const askDelete = (project: Project) => {
    const linkedCount = (tasksByProject.get(project.id) || []).length;
    setDeleteTarget({ project, linkedCount });
  };

  const handleDropOnProject = (targetKey: string, e: React.DragEvent) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/anchor-task-id') || draggingTaskId;
    setDragOverColKey(null);
    setDraggingTaskId(null);
    if (!taskId) return;
    const nextProjectId = targetKey === '__none' ? '' : targetKey;
    const task = activeTasks.find((k) => k.id === taskId);
    if (!task || task.projectId === nextProjectId) return;
    updateTask(taskId, { projectId: nextProjectId });
  };

  const renderBoardTaskCard = (task: Task) => {
    const overdue = !task.done && !!task.due && task.due < today;
    const selected = selectedTask?.id === task.id;
    const isDragging = draggingTaskId === task.id;

    return (
      <div
        key={task.id}
        draggable
        onDragStart={(e) => {
          setDraggingTaskId(task.id);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/anchor-task-id', task.id);
        }}
        onDragEnd={() => {
          setDraggingTaskId(null);
          setDragOverColKey(null);
        }}
        onClick={() => openInspector({ kind: 'task', id: task.id })}
        className="p-3 rounded-[10px] border cursor-pointer ap-ease space-y-2"
        style={{
          background: selected ? 'var(--accent-soft)' : 'var(--bg-card)',
          borderColor: selected ? 'var(--accent)' : 'var(--hairline-soft)',
          opacity: isDragging ? 0.45 : 1,
        }}
      >
        <div className="flex items-start gap-2">
          <div className="mt-0.5">
            <CircularCheck
              checked={task.done}
              prio={task.prio}
              size={16}
              onChange={() => toggleTask(task.id)}
              ariaLabel={t.markDone}
            />
          </div>
          <span
            className="flex-1 text-[13px] font-medium leading-snug break-words"
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
          </span>
        </div>

        {(task.due || (!task.done && (task.status === 'doing' || task.status === 'confirm')) || task.attachments.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 pl-6">
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
            {task.due && (
              <span
                className="ap-pill"
                style={{
                  background: overdue ? 'var(--status-red-soft)' : 'var(--bg-subtle)',
                  color: overdue ? 'var(--status-red)' : 'var(--text-3)',
                }}
              >
                {humanDate(task.due, config.lang, today)}
              </span>
            )}
            <AttachmentBadges attachments={task.attachments} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Top Header + Dedicated Persistent Search & Filter Toolbar */}
        <div
          className="px-7 pt-6 pb-4 space-y-3 shrink-0"
          style={{ borderBottom: '1px solid var(--hairline-soft)' }}
        >
          {/* Row 1: Title & Primary Create Button */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-[24px] font-semibold tracking-[-0.025em] leading-tight">
                {t.projectsTitle}
              </h1>
              <p className="text-[13px] mt-0.5 truncate" style={{ color: 'var(--text-2)' }}>
                {t.projectsSub(activeProjects.length, linkedTasksCount)}
              </p>
            </div>

            <button
              type="button"
              onClick={openCreator}
              className="ap-btn ap-btn-primary ap-btn-sm shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              {t.newProject}
            </button>
          </div>

          {/* Row 2: Always-Visible Left-Aligned Search & View Toolbar (Never Jumps on Inspector Toggle) */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative w-[220px]">
              <Search
                className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--text-3)' }}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.projSearchPh}
                className="ap-input w-full pl-8 pr-7 py-1.5 text-[12.5px]"
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

            {/* Show Done Toggle */}
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className="ap-btn ap-btn-sm"
              style={{
                background: showDone ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                color: showDone ? 'var(--accent)' : 'var(--text-2)',
              }}
            >
              <CheckSquare className="w-3.5 h-3.5" />
              {t.projShowDone}
            </button>

            {/* View Mode Toggle: Board Columns vs Compact Grid */}
            <SegmentedControl<ProjectViewMode>
              value={viewMode}
              onChange={setViewMode}
              options={[
                {
                  value: 'board',
                  label: t.projViewBoard,
                },
                {
                  value: 'grid',
                  label: t.projViewGrid,
                },
              ]}
            />
          </div>

          {/* Lightweight Inline Project Creator (Name + Color Dots only) */}
          {creatingProject && (
            <form
              onSubmit={handleCreateProject}
              className="ap-card px-4 py-3 flex flex-wrap items-center gap-3"
              style={{ borderColor: 'var(--accent)' }}
            >
              <input
                id="quick-capture-input"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setCreatingProject(false);
                }}
                placeholder={t.projNamePh}
                maxLength={80}
                className="ap-input flex-1 min-w-[200px] py-1.5 text-[13.5px]"
                autoFocus
              />

              <div className="flex items-center gap-1.5" aria-label={t.projColorLabel}>
                {PROJECT_COLOR_PALETTE.map((c) => {
                  const active = newColor === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      title={config.lang === 'zh' ? c.labelZh : c.labelEn}
                      onClick={() => setNewColor(c.key)}
                      className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                      style={{
                        background: c.dot,
                        outline: active ? '2px solid var(--text-1)' : 'none',
                        outlineOffset: '2px',
                      }}
                    />
                  );
                })}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="submit"
                  disabled={!newName.trim()}
                  className="ap-btn ap-btn-primary ap-btn-sm disabled:opacity-45"
                >
                  {t.create}
                </button>
                <button
                  type="button"
                  onClick={() => setCreatingProject(false)}
                  className="ap-btn ap-btn-sm"
                >
                  {t.cancel}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Main Content: Board Columns OR Compact Overview Grid */}
        {activeProjects.length === 0 ? (
          <div className="flex-1 p-7">
            <div className="max-w-[760px] mx-auto ap-card">
              <EmptyState
                icon={<FolderKanban className="w-8 h-8" strokeWidth={1.5} />}
                title={t.emptyProjects}
                action={
                  <button
                    type="button"
                    onClick={openCreator}
                    className="ap-btn ap-btn-primary ap-btn-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t.newProject}
                  </button>
                }
              />
            </div>
          </div>
        ) : viewMode === 'board' ? (
          /* MODE A: HORIZONTAL MULTI-PROJECT KANBAN BOARD */
          <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden px-7 py-5">
            <div className="flex items-start gap-4 h-full">
              {visibleProjects.map((project) => {
                const c = getProjectColorMeta(project);
                const allProjTasks = tasksByProject.get(project.id) || [];
                const totalCnt = allProjTasks.length;
                const doneCnt = allProjTasks.filter((k) => k.done).length;
                const pct = totalCnt ? Math.round((doneCnt / totalCnt) * 100) : 0;

                const visibleTasks = allProjTasks.filter((k) => {
                  if (!showDone && k.done) return false;
                  if (q && !project.name.toLowerCase().includes(q) && !k.title.toLowerCase().includes(q)) {
                    return false;
                  }
                  return true;
                });

                const isDropTarget = dragOverColKey === project.id;
                const isSelectedProj = selectedProject?.id === project.id;

                return (
                  <div
                    key={project.id}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverColKey !== project.id) setDragOverColKey(project.id);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setDragOverColKey((prev) => (prev === project.id ? null : prev));
                      }
                    }}
                    onDrop={(e) => handleDropOnProject(project.id, e)}
                    className="w-[316px] shrink-0 max-h-full flex flex-col rounded-[14px] border overflow-hidden ap-ease"
                    style={{
                      background: isDropTarget ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                      borderColor: isDropTarget
                        ? 'var(--accent)'
                        : isSelectedProj
                          ? c.dot
                          : 'var(--hairline)',
                    }}
                  >
                    {/* Colored Top Accent Stripe */}
                    <div className="h-[3px] w-full shrink-0" style={{ background: c.dot }} />

                    {/* Column Header */}
                    <div className="px-3.5 pt-3 pb-2.5 space-y-2 shrink-0">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => openInspector({ kind: 'project', id: project.id })}
                          className="flex items-center gap-2 min-w-0 flex-1 text-left group"
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ background: c.dot }}
                          />
                          <h3 className="text-[14.5px] font-semibold truncate group-hover:underline">
                            {project.name}
                          </h3>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          <span
                            className="text-[11.5px] font-medium px-2 py-0.5 rounded-full"
                            style={{ background: c.soft, color: c.dot }}
                          >
                            {doneCnt}/{totalCnt}
                          </span>
                          <button
                            type="button"
                            title={t.edit}
                            onClick={() => openInspector({ kind: 'project', id: project.id })}
                            className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center hover:bg-[var(--bg-subtle-hover)]"
                            style={{ color: 'var(--text-3)' }}
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Thin Progress Bar */}
                      <div
                        className="h-1 w-full rounded-full overflow-hidden"
                        style={{ background: 'var(--bg-card)' }}
                      >
                        <div
                          className="h-full rounded-full ap-ease"
                          style={{
                            width: `${pct}%`,
                            background: pct === 100 && totalCnt > 0 ? 'var(--status-green)' : c.dot,
                          }}
                        />
                      </div>

                      {/* Quick Add Input Inside Column */}
                      {inlineTaskFor === project.id ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleQuickAddTask(project.id);
                          }}
                          className="flex items-center gap-1.5 pt-0.5"
                        >
                          <input
                            type="text"
                            value={inlineTaskTitle}
                            onChange={(e) => setInlineTaskTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                setInlineTaskFor(null);
                                setInlineTaskTitle('');
                              }
                            }}
                            placeholder={t.quickTaskPh}
                            className="ap-input flex-1 py-1 text-[12.5px]"
                            autoFocus
                          />
                          <button
                            type="submit"
                            disabled={!inlineTaskTitle.trim()}
                            className="ap-btn ap-btn-primary ap-btn-sm disabled:opacity-45"
                          >
                            {t.add}
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setInlineTaskFor(project.id);
                            setInlineTaskTitle('');
                          }}
                          className="w-full py-1.5 px-2.5 rounded-[8px] text-[12px] font-medium flex items-center gap-1.5 hover:bg-[var(--bg-card)] ap-ease"
                          style={{ color: 'var(--text-2)' }}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          {t.projAddTask}
                        </button>
                      )}
                    </div>

                    {/* Scrollable Cards */}
                    <div className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-3 space-y-2">
                      {visibleTasks.length === 0 ? (
                        <div
                          className="px-3 py-6 rounded-[10px] text-center text-[12px]"
                          style={{ color: 'var(--text-3)' }}
                        >
                          {totalCnt > 0 && !showDone ? t.projAllClear : t.projNoLinked}
                        </div>
                      ) : (
                        visibleTasks.map((task) => renderBoardTaskCard(task))
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Optional Trailing Uncategorized Column (when uncategorized tasks exist or dragging) */}
              {(uncategorizedTasks.length > 0 || draggingTaskId) && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverColKey !== '__none') setDragOverColKey('__none');
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDragOverColKey((prev) => (prev === '__none' ? null : prev));
                    }
                  }}
                  onDrop={(e) => handleDropOnProject('__none', e)}
                  className="w-[300px] shrink-0 max-h-full flex flex-col rounded-[14px] border border-dashed overflow-hidden ap-ease"
                  style={{
                    background: dragOverColKey === '__none' ? 'var(--accent-soft)' : 'transparent',
                    borderColor: dragOverColKey === '__none' ? 'var(--accent)' : 'var(--hairline)',
                  }}
                >
                  <div className="px-3.5 py-3 flex items-center justify-between gap-2 shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <Inbox className="w-4 h-4 shrink-0" style={{ color: 'var(--text-3)' }} />
                      <h3 className="text-[14px] font-semibold truncate" style={{ color: 'var(--text-2)' }}>
                        {t.taskGroupUncategorized}
                      </h3>
                    </div>
                    <span
                      className="text-[11.5px] font-medium px-2 py-0.5 rounded-full"
                      style={{ background: 'var(--bg-subtle)', color: 'var(--text-3)' }}
                    >
                      {uncategorizedTasks.length}
                    </span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-3 space-y-2">
                    {uncategorizedTasks.map((task) => renderBoardTaskCard(task))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* MODE B: COMPACT MULTI-PROJECT OVERVIEW GRID */
          <div className="flex-1 min-h-0 overflow-y-auto px-7 py-5">
            <div className="max-w-[1160px] mx-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleProjects.map((project) => {
                const c = getProjectColorMeta(project);
                const allProjTasks = tasksByProject.get(project.id) || [];
                const totalCnt = allProjTasks.length;
                const todoCnt = allProjTasks.filter((k) => !k.done && k.status === 'todo').length;
                const doingCnt = allProjTasks.filter((k) => !k.done && k.status === 'doing').length;
                const confirmCnt = allProjTasks.filter((k) => !k.done && k.status === 'confirm').length;
                const doneCnt = allProjTasks.filter((k) => k.done).length;
                const overdueCnt = allProjTasks.filter((k) => !k.done && !!k.due && k.due < today).length;
                const pct = totalCnt ? Math.round((doneCnt / totalCnt) * 100) : 0;
                const openPreview = allProjTasks.filter((k) => !k.done).slice(0, 3);

                return (
                  <div
                    key={project.id}
                    onClick={() => openInspector({ kind: 'project', id: project.id })}
                    className="ap-card overflow-hidden flex flex-col cursor-pointer ap-ease"
                    style={{
                      borderColor: selectedProject?.id === project.id ? c.dot : 'var(--hairline)',
                    }}
                  >
                    <div className="h-[3px] w-full" style={{ background: c.dot }} />
                    <div className="p-4 flex-1 flex flex-col gap-3.5">
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ background: c.dot }}
                          />
                          <h3 className="text-[15.5px] font-semibold tracking-[-0.015em] truncate">
                            {project.name}
                          </h3>
                        </div>
                        <div className="text-right shrink-0">
                          <span
                            className="text-[17px] font-semibold tracking-[-0.02em]"
                            style={{ color: pct === 100 && totalCnt > 0 ? 'var(--status-green)' : 'var(--text-1)' }}
                          >
                            {pct}%
                          </span>
                          <span className="text-[11.5px] ml-1.5" style={{ color: 'var(--text-3)' }}>
                            {doneCnt}/{totalCnt}
                          </span>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div
                        className="h-1.5 w-full rounded-full overflow-hidden"
                        style={{ background: 'var(--bg-subtle)' }}
                      >
                        <div
                          className="h-full rounded-full ap-ease"
                          style={{
                            width: `${pct}%`,
                            background: pct === 100 && totalCnt > 0 ? 'var(--status-green)' : c.dot,
                          }}
                        />
                      </div>

                      {/* 4-Stage Count Pills + Overdue */}
                      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
                        <span className="ap-pill" style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}>
                          {t.statusTodo} {todoCnt}
                        </span>
                        <span className="ap-pill" style={{ background: STATUS_COLORS.doing.soft, color: STATUS_COLORS.doing.color }}>
                          {t.statusDoing} {doingCnt}
                        </span>
                        {confirmCnt > 0 && (
                          <span className="ap-pill" style={{ background: STATUS_COLORS.confirm.soft, color: STATUS_COLORS.confirm.color }}>
                            {t.statusConfirm} {confirmCnt}
                          </span>
                        )}
                        {overdueCnt > 0 && (
                          <span className="ap-pill" style={{ background: 'var(--status-red-soft)', color: 'var(--status-red)' }}>
                            {t.segOverdue} {overdueCnt}
                          </span>
                        )}
                      </div>

                      {/* Open Tasks Preview */}
                      <div className="flex-1 space-y-1" onClick={(e) => e.stopPropagation()}>
                        {openPreview.length === 0 ? (
                          <div className="text-[12px] py-1" style={{ color: totalCnt > 0 ? 'var(--status-green)' : 'var(--text-3)' }}>
                            {totalCnt > 0 ? t.projAllClear : t.projNoLinked}
                          </div>
                        ) : (
                          openPreview.map((k) => (
                            <div
                              key={k.id}
                              onClick={() => openInspector({ kind: 'task', id: k.id })}
                              className="flex items-center gap-2 py-1 text-[12.5px] rounded-[6px] px-1 -mx-1 hover:bg-[var(--bg-subtle)] cursor-pointer"
                            >
                              <CircularCheck
                                checked={k.done}
                                prio={k.prio}
                                size={15}
                                onChange={() => toggleTask(k.id)}
                              />
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ background: PRIO_COLORS[k.prio].color }}
                              />
                              <span className="flex-1 truncate">{k.title}</span>
                              {k.due && (
                                <span
                                  className="text-[11px] shrink-0"
                                  style={{ color: k.due < today ? 'var(--status-red)' : 'var(--text-3)' }}
                                >
                                  {humanDate(k.due, config.lang, today)}
                                </span>
                              )}
                            </div>
                          ))
                        )}
                      </div>

                      {/* Card Footer Actions */}
                      <div
                        className="pt-2.5 flex items-center justify-between gap-2"
                        style={{ borderTop: '1px solid var(--hairline-soft)' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setInlineTaskFor(inlineTaskFor === project.id ? null : project.id);
                            setInlineTaskTitle('');
                          }}
                          className="ap-btn ap-btn-sm py-1 px-2 text-[11.5px]"
                        >
                          <Plus className="w-3 h-3" />
                          {t.projAddTask}
                        </button>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setTaskProjectFilter(project.id);
                              setView('kanban');
                            }}
                            className="ap-btn ap-btn-sm py-1 px-2 text-[11.5px]"
                          >
                            <Kanban className="w-3 h-3" />
                            {t.projOpenKanban}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTaskProjectFilter(project.id);
                              setView('tasks');
                            }}
                            className="text-[12px] font-medium px-1.5"
                            style={{ color: 'var(--accent)' }}
                          >
                            {t.projOpenTasks} →
                          </button>
                        </div>
                      </div>

                      {inlineTaskFor === project.id && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleQuickAddTask(project.id);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="flex gap-1.5"
                        >
                          <input
                            type="text"
                            value={inlineTaskTitle}
                            onChange={(e) => setInlineTaskTitle(e.target.value)}
                            placeholder={t.quickTaskPh}
                            className="ap-input flex-1 py-1 text-[12.5px]"
                            autoFocus
                          />
                          <button type="submit" className="ap-btn ap-btn-primary ap-btn-sm">
                            {t.add}
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Right Task Inspector (when clicking any task card in the project board) */}
      {selectedTask && <TaskInspector task={selectedTask} />}

      {/* Right Minimal Project Inspector (Name + Color + Shortcuts + Delete only) */}
      {selectedProject && (
        <InspectorDrawer
          title={t.inspector}
          onClose={() => openInspector(null)}
          footer={
            <button
              type="button"
              onClick={() => askDelete(selectedProject)}
              className="ap-btn ap-btn-danger w-full"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t.delete}
            </button>
          }
        >
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.projNamePh}
            </label>
            <input
              type="text"
              value={selectedProject.name}
              onChange={(e) => updateProject(selectedProject.id, { name: e.target.value })}
              className="ap-input w-full"
              maxLength={80}
            />
          </div>

          <div className="space-y-2">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.projColorLabel}
            </label>
            <div className="grid grid-cols-4 gap-2">
              {PROJECT_COLOR_PALETTE.map((c) => {
                const active = getProjectColorMeta(selectedProject).key === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => updateProject(selectedProject.id, { color: c.key })}
                    className="px-2.5 py-2 rounded-[9px] text-[12px] font-medium flex items-center gap-2 ap-ease"
                    style={{
                      background: active ? c.soft : 'var(--bg-subtle)',
                      color: active ? c.dot : 'var(--text-2)',
                      boxShadow: active ? `inset 0 0 0 1.5px ${c.dot}` : 'none',
                    }}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.dot }} />
                    <span className="truncate">{config.lang === 'zh' ? c.labelZh : c.labelEn}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-2 space-y-2">
            <button
              type="button"
              onClick={() => {
                setTaskProjectFilter(selectedProject.id);
                setView('tasks');
              }}
              className="ap-btn w-full justify-center"
            >
              <Columns3 className="w-3.5 h-3.5" />
              {t.projOpenTasks}
            </button>
            <button
              type="button"
              onClick={() => {
                setTaskProjectFilter(selectedProject.id);
                setView('kanban');
              }}
              className="ap-btn w-full justify-center"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              {t.projOpenKanban}
            </button>
          </div>
        </InspectorDrawer>
      )}

      {/* Cascade Delete Dialog */}
      {deleteTarget && deleteTarget.linkedCount > 0 && (
        <ChoiceDialog<'keep' | 'deleteAll'>
          open
          title={t.projDelChoiceTitle}
          body={t.projDelChoiceBody(deleteTarget.project.name, deleteTarget.linkedCount)}
          cancelLabel={t.cancel}
          options={[
            { value: 'keep', label: t.projKeepChildren, primary: true },
            { value: 'deleteAll', label: t.projDeleteAll, danger: true },
          ]}
          onSelect={(mode) => {
            deleteProject(deleteTarget.project.id, mode);
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {deleteTarget && deleteTarget.linkedCount === 0 && (
        <ConfirmDialog
          open
          title={t.projDelChoiceTitle}
          body={
            config.lang === 'zh'
              ? `确定删除项目「${deleteTarget.project.name}」？`
              : `Delete project "${deleteTarget.project.name}"?`
          }
          confirmLabel={t.delete}
          cancelLabel={t.cancel}
          danger
          onConfirm={() => {
            deleteProject(deleteTarget.project.id, 'keep');
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
