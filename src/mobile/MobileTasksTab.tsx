import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Calendar,
  Check,
  Edit3,
  FolderPlus,
  Image as ImageIcon,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  TASK_STATUS_ORDER,
  type Lang,
  type Priority,
  type Project,
  type ProjectColor,
  type Task,
  type TaskStatus,
} from '@/domain/types';
import {
  PROJECT_COLOR_PALETTE,
  getProjectColorMeta,
  pickNextProjectColor,
} from '@/domain/projectColor';
import { todayStr } from '@/domain/date';
import { getTaskDisplayTitle, getTaskSecondaryPreview } from '@/domain/taskContent';
import { mobileApi } from './api';

type TasksSubView = 'list' | 'board' | 'projects';
type ListFilter = 'today' | 'open' | 'all';

interface MobileTasksTabProps {
  lang: Lang;
  tasks: Task[];
  projects: Project[];
  onTaskUpdated: (task: Task) => void;
  onProjectUpdated: (project: Project) => void;
  onProjectDeleted: (projectId: string) => void;
  onEditTask: (task: Task) => void;
  onNewTask: (opts?: { due?: string; projectId?: string; status?: TaskStatus }) => void;
  onToast: (msg: string, tone?: 'ok' | 'err') => void;
}

const STATUS_META: Record<
  TaskStatus,
  { zh: string; en: string; next?: TaskStatus; nextLabelZh?: string; nextLabelEn?: string }
> = {
  todo: { zh: '待办', en: 'To Do', next: 'doing', nextLabelZh: '开始进行', nextLabelEn: 'Start' },
  doing: { zh: '进行中', en: 'Doing', next: 'confirm', nextLabelZh: '待确认', nextLabelEn: 'Review' },
  confirm: { zh: '待确认', en: 'Confirm', next: 'done', nextLabelZh: '标为完成', nextLabelEn: 'Done' },
  done: { zh: '已完成', en: 'Done', next: 'todo', nextLabelZh: '重开', nextLabelEn: 'Reopen' },
};

const PRIO_COLORS: Record<Priority, string> = {
  1: 'var(--status-red)',
  2: 'var(--status-orange)',
  3: 'var(--accent)',
  4: 'var(--status-gray)',
};

export function MobileTasksTab({
  lang,
  tasks,
  projects,
  onTaskUpdated,
  onProjectUpdated,
  onProjectDeleted,
  onEditTask,
  onNewTask,
  onToast,
}: MobileTasksTabProps) {
  const zh = lang !== 'en';
  const today = todayStr();

  const [subView, setSubView] = useState<TasksSubView>('list');
  const [listFilter, setListFilter] = useState<ListFilter>('today');
  const [projectFilter, setProjectFilter] = useState<string>('');
  const [boardStatus, setBoardStatus] = useState<TaskStatus>('todo');
  const [query, setQuery] = useState('');

  // Project create / edit sheet state
  const [projModal, setProjModal] = useState<{
    open: boolean;
    editing: Project | null;
    name: string;
    color: ProjectColor;
  }>({ open: false, editing: null, name: '', color: 'blue' });
  const [projSaving, setProjSaving] = useState(false);

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const filteredListTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks
      .filter((t) => {
        if (projectFilter && t.projectId !== projectFilter) return false;
        if (listFilter === 'today') {
          const open = !t.done && t.status !== 'done';
          if (!open) return false;
          if (t.due && t.due > today) return false;
        } else if (listFilter === 'open') {
          if (t.done || t.status === 'done') return false;
        }
        if (q) {
          const hay = `${t.title}\n${t.note}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aDone = a.done || a.status === 'done' ? 1 : 0;
        const bDone = b.done || b.status === 'done' ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        if (a.prio !== b.prio) return a.prio - b.prio;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
  }, [tasks, projectFilter, listFilter, query, today]);

  const boardBuckets = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map: Record<TaskStatus, Task[]> = { todo: [], doing: [], confirm: [], done: [] };
    for (const t of tasks) {
      if (projectFilter && t.projectId !== projectFilter) continue;
      if (q && !`${t.title}\n${t.note}`.toLowerCase().includes(q)) continue;
      const st: TaskStatus = t.status || (t.done ? 'done' : 'todo');
      map[st].push(t);
    }
    for (const st of TASK_STATUS_ORDER) {
      map[st].sort((a, b) => a.prio - b.prio || (b.updatedAt || 0) - (a.updatedAt || 0));
    }
    return map;
  }, [tasks, projectFilter, query]);

  const handleToggleDone = async (task: Task) => {
    const nextDone = !(task.done || task.status === 'done');
    try {
      const saved = await mobileApi.updateTask(task.id, { done: nextDone });
      onTaskUpdated(saved);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  const handleMoveStatus = async (task: Task, nextStatus: TaskStatus) => {
    try {
      const saved = await mobileApi.updateTask(task.id, { status: nextStatus });
      onTaskUpdated(saved);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  const openNewProject = () => {
    setProjModal({
      open: true,
      editing: null,
      name: '',
      color: pickNextProjectColor(projects.length),
    });
  };

  const openEditProject = (proj: Project) => {
    setProjModal({
      open: true,
      editing: proj,
      name: proj.name,
      color: proj.color,
    });
  };

  const handleSaveProject = async () => {
    const clean = projModal.name.trim();
    if (!clean) {
      onToast(zh ? '请输入项目名称' : 'Enter project name', 'err');
      return;
    }
    setProjSaving(true);
    try {
      const saved = projModal.editing
        ? await mobileApi.updateProject(projModal.editing.id, {
            name: clean,
            color: projModal.color,
          })
        : await mobileApi.createProject({ name: clean, color: projModal.color });
      onProjectUpdated(saved);
      setProjModal((s) => ({ ...s, open: false }));
      onToast(zh ? '项目已保存' : 'Project saved', 'ok');
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      setProjSaving(false);
    }
  };

  const handleDeleteProject = async (proj: Project) => {
    const ok = window.confirm(
      zh
        ? `确认删除项目「${proj.name}」？关联待办将保留并变为未分类。`
        : `Delete project "${proj.name}"? Tasks will be kept as uncategorized.`,
    );
    if (!ok) return;
    try {
      await mobileApi.deleteProject(proj.id);
      if (projectFilter === proj.id) setProjectFilter('');
      onProjectDeleted(proj.id);
      onToast(zh ? '项目已删除' : 'Project deleted', 'ok');
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  const renderTaskRow = (task: Task, showFlowBtn = false) => {
    const done = task.done || task.status === 'done';
    const st: TaskStatus = task.status || (done ? 'done' : 'todo');
    const overdue = !done && !!task.due && task.due < today;
    const proj = task.projectId ? projectMap.get(task.projectId) : undefined;
    const projMeta = proj ? getProjectColorMeta(proj) : null;
    const displayTitle = getTaskDisplayTitle(task, lang);
    const notePreview = getTaskSecondaryPreview(task);
    const imgCount = (task.attachments || []).filter((a) => a.kind === 'image').length;
    const flowMeta = STATUS_META[st];

    return (
      <div
        key={task.id}
        className="ap-card px-3 py-2.5 flex items-start gap-2.5"
      >
        <button
          type="button"
          onClick={() => void handleToggleDone(task)}
          className="w-8 h-8 -ml-1 -mt-0.5 flex items-center justify-center shrink-0"
          aria-label="Toggle task"
        >
          <span
            className="w-[21px] h-[21px] rounded-full inline-flex items-center justify-center transition-colors"
            style={{
              background: done ? 'var(--accent)' : 'transparent',
              border: done ? '2px solid var(--accent)' : `2px solid ${PRIO_COLORS[task.prio]}`,
              color: '#ffffff',
            }}
          >
            {done && <Check className="w-3.5 h-3.5" strokeWidth={2.8} />}
          </span>
        </button>

        <div className="min-w-0 flex-1" onClick={() => onEditTask(task)}>
          <div
            className={`text-[14.5px] font-medium leading-snug break-words ${done ? 'line-through opacity-55' : ''}`}
            style={{ color: 'var(--text-1)' }}
          >
            {displayTitle}
          </div>
          {notePreview && (
            <div className="mt-0.5 text-[12.5px] truncate" style={{ color: 'var(--text-3)' }}>
              {notePreview}
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span
              className="px-1.5 py-0.5 rounded-[6px] font-semibold"
              style={{
                background: 'var(--bg-subtle)',
                color: PRIO_COLORS[task.prio],
              }}
            >
              P{task.prio}
            </span>
            {proj && projMeta && (
              <span
                className="px-1.5 py-0.5 rounded-[6px] font-medium inline-flex items-center gap-1"
                style={{ background: projMeta.soft, color: projMeta.dot }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: projMeta.dot }} />
                {proj.name}
              </span>
            )}
            {task.due && (
              <span
                className="px-1.5 py-0.5 rounded-[6px] inline-flex items-center gap-1 font-medium"
                style={{
                  background: overdue ? 'var(--status-red-soft)' : 'var(--bg-subtle)',
                  color: overdue ? 'var(--status-red)' : 'var(--text-2)',
                }}
              >
                <Calendar className="w-3 h-3" />
                {task.startDate && task.startDate !== task.due
                  ? `${task.startDate.slice(5)}→${task.due.slice(5)}`
                  : task.due.slice(5)}
                {task.startTime ? ` ${task.startTime}` : ''}
              </span>
            )}
            {!showFlowBtn && st !== 'todo' && st !== 'done' && (
              <span
                className="px-1.5 py-0.5 rounded-[6px] font-medium"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                {zh ? flowMeta.zh : flowMeta.en}
              </span>
            )}
            {imgCount > 0 && (
              <span
                className="px-1.5 py-0.5 rounded-[6px] inline-flex items-center gap-0.5"
                style={{ background: 'var(--bg-subtle)', color: 'var(--text-3)' }}
              >
                <ImageIcon className="w-3 h-3" />
                {imgCount}
              </span>
            )}
          </div>

          {showFlowBtn && flowMeta.next && (
            <div className="mt-2 pt-2 flex items-center justify-between gap-2" style={{ borderTop: '1px solid var(--hairline-soft)' }}>
              <div className="flex items-center gap-1">
                {TASK_STATUS_ORDER.filter((s) => s !== st).map((target) => (
                  <button
                    key={target}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleMoveStatus(task, target);
                    }}
                    className="px-2 py-1 rounded-[7px] text-[11px] font-medium"
                    style={{
                      background: target === flowMeta.next ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                      color: target === flowMeta.next ? 'var(--accent)' : 'var(--text-3)',
                    }}
                  >
                    {target === flowMeta.next && <ArrowRight className="w-3 h-3 inline mr-0.5" />}
                    {zh ? STATUS_META[target].zh : STATUS_META[target].en}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Sub-view switcher: List / Board / Projects */}
      <div className="px-4 pt-2.5 pb-2 space-y-2.5 shrink-0">
        <div
          className="grid grid-cols-3 p-[3px] rounded-[10px]"
          style={{
            background: 'var(--bg-subtle)',
            border: '1px solid var(--hairline-soft)',
          }}
        >
          {(
            [
              { key: 'list', label: zh ? '列表' : 'List' },
              { key: 'board', label: zh ? '状态看板' : 'Board' },
              { key: 'projects', label: zh ? '项目' : 'Projects' },
            ] as const
          ).map((item) => {
            const active = subView === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSubView(item.key)}
                className="py-1.5 rounded-[8px] text-[13px] font-semibold"
                style={{
                  background: active ? 'var(--seg-active-bg)' : 'transparent',
                  color: active ? 'var(--text-1)' : 'var(--text-3)',
                  boxShadow: active ? 'var(--seg-active-shadow)' : 'none',
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Search & Filters (for List & Board) */}
        {subView !== 'projects' && (
          <div className="space-y-2">
            <div className="relative">
              <Search
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-3)' }}
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={zh ? '筛选待办…' : 'Filter tasks…'}
                className="ap-input w-full pl-9 pr-8 py-2 text-[13.5px]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-3)' }}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {subView === 'list' && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {(
                  [
                    { key: 'today', label: zh ? '今日' : 'Today' },
                    { key: 'open', label: zh ? '未完成' : 'Open' },
                    { key: 'all', label: zh ? '全部' : 'All' },
                  ] as const
                ).map((f) => {
                  const active = listFilter === f.key;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setListFilter(f.key)}
                      className="px-3 py-1 rounded-full text-[12.5px] font-medium shrink-0"
                      style={{
                        background: active ? 'var(--accent)' : 'var(--bg-subtle)',
                        color: active ? '#ffffff' : 'var(--text-2)',
                      }}
                    >
                      {f.label}
                    </button>
                  );
                })}
                <span className="w-px h-4 mx-0.5 shrink-0" style={{ background: 'var(--hairline)' }} />
                <button
                  type="button"
                  onClick={() => setProjectFilter('')}
                  className="px-2.5 py-1 rounded-full text-[12px] shrink-0"
                  style={{
                    background: projectFilter === '' ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                    color: projectFilter === '' ? 'var(--accent)' : 'var(--text-2)',
                  }}
                >
                  {zh ? '全部项目' : 'All Projects'}
                </button>
                {projects.map((p) => {
                  const active = projectFilter === p.id;
                  const meta = getProjectColorMeta(p);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setProjectFilter(active ? '' : p.id)}
                      className="px-2.5 py-1 rounded-full text-[12px] font-medium inline-flex items-center gap-1 shrink-0"
                      style={{
                        background: active ? meta.dot : meta.soft,
                        color: active ? '#ffffff' : meta.dot,
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: active ? '#ffffff' : meta.dot }}
                      />
                      {p.name}
                    </button>
                  );
                })}
              </div>
            )}

            {subView === 'board' && (
              <div className="grid grid-cols-4 gap-1.5">
                {TASK_STATUS_ORDER.map((st) => {
                  const active = boardStatus === st;
                  const count = boardBuckets[st].length;
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setBoardStatus(st)}
                      className="py-1.5 px-1 rounded-[10px] text-[12px] font-semibold flex items-center justify-center gap-1"
                      style={{
                        background: active ? 'var(--accent)' : 'var(--bg-subtle)',
                        color: active ? '#ffffff' : 'var(--text-2)',
                      }}
                    >
                      <span>{zh ? STATUS_META[st].zh : STATUS_META[st].en}</span>
                      <span className="opacity-80 text-[11px]">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto m-scroll px-4 pb-24 space-y-2.5">
        {subView === 'list' && (
          <>
            {filteredListTasks.length === 0 ? (
              <div className="py-16 text-center text-[13.5px]" style={{ color: 'var(--text-3)' }}>
                {zh ? '当前筛选下暂无待办，点右下角 + 新建一条吧' : 'No tasks here yet — tap + to create one'}
              </div>
            ) : (
              filteredListTasks.map((t) => renderTaskRow(t, false))
            )}
          </>
        )}

        {subView === 'board' && (
          <>
            {boardBuckets[boardStatus].length === 0 ? (
              <div className="py-16 text-center text-[13.5px]" style={{ color: 'var(--text-3)' }}>
                {zh ? '该状态下暂无任务' : 'No tasks in this column'}
              </div>
            ) : (
              boardBuckets[boardStatus].map((t) => renderTaskRow(t, true))
            )}
          </>
        )}

        {subView === 'projects' && (
          <div className="space-y-3 pt-1">
            <button
              type="button"
              onClick={openNewProject}
              className="w-full py-2.5 px-3.5 rounded-[12px] text-[13.5px] font-semibold inline-flex items-center justify-center gap-2"
              style={{
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
              }}
            >
              <FolderPlus className="w-4 h-4" />
              {zh ? '新建项目分类' : 'New Project'}
            </button>

            {projects.length === 0 ? (
              <div className="py-12 text-center text-[13.5px]" style={{ color: 'var(--text-3)' }}>
                {zh ? '还没有项目分类' : 'No projects yet'}
              </div>
            ) : (
              projects.map((p) => {
                const meta = getProjectColorMeta(p);
                const projTasks = tasks.filter((t) => t.projectId === p.id);
                const openCount = projTasks.filter((t) => !t.done && t.status !== 'done').length;
                return (
                  <div
                    key={p.id}
                    className="ap-card p-3.5 space-y-2.5"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ background: meta.dot }}
                      />
                      <span
                        className="text-[15px] font-semibold flex-1 truncate"
                        style={{ color: 'var(--text-1)' }}
                      >
                        {p.name}
                      </span>
                      <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                        {openCount}/{projTasks.length}
                      </span>
                      <button
                        type="button"
                        onClick={() => onNewTask({ projectId: p.id })}
                        className="p-1.5 rounded-[8px]"
                        style={{ background: meta.soft, color: meta.dot }}
                        aria-label="Add task in project"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditProject(p)}
                        className="p-1.5 rounded-[8px]"
                        style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
                        aria-label="Edit project"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteProject(p)}
                        className="p-1.5 rounded-[8px]"
                        style={{ background: 'var(--status-red-soft)', color: 'var(--status-red)' }}
                        aria-label="Delete project"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {projTasks.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        {projTasks.slice(0, 6).map((t) => {
                          const done = t.done || t.status === 'done';
                          return (
                            <div
                              key={t.id}
                              onClick={() => onEditTask(t)}
                              className="flex items-center gap-2 py-1 px-2 rounded-[8px]"
                              style={{ background: 'var(--bg-subtle)' }}
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleToggleDone(t);
                                }}
                                className="w-4 h-4 rounded-full inline-flex items-center justify-center shrink-0"
                                style={{
                                  background: done ? meta.dot : 'transparent',
                                  border: `1.5px solid ${meta.dot}`,
                                  color: '#ffffff',
                                }}
                              >
                                {done && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
                              </button>
                              <span
                                className={`text-[13px] flex-1 truncate ${done ? 'line-through opacity-55' : ''}`}
                                style={{ color: 'var(--text-1)' }}
                              >
                                {getTaskDisplayTitle(t, lang)}
                              </span>
                            </div>
                          );
                        })}
                        {projTasks.length > 6 && (
                          <button
                            type="button"
                            onClick={() => {
                              setProjectFilter(p.id);
                              setListFilter('all');
                              setSubView('list');
                            }}
                            className="text-[12px] font-medium pl-1"
                            style={{ color: meta.dot }}
                          >
                            {zh
                              ? `查看全部 ${projTasks.length} 项 →`
                              : `View all ${projTasks.length} tasks →`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Floating Action Button */}
      {subView !== 'projects' && (
        <button
          type="button"
          onClick={() =>
            onNewTask({
              due: subView === 'list' && listFilter === 'today' ? today : '',
              projectId: projectFilter,
              status: subView === 'board' ? boardStatus : 'todo',
            })
          }
          className="ap-btn-primary fixed right-5 bottom-[84px] z-30 w-13 h-13 rounded-full inline-flex items-center justify-center"
          style={{
            boxShadow: '0 6px 20px color-mix(in srgb, var(--accent) 40%, transparent)',
          }}
          aria-label="New task"
        >
          <Plus className="w-6 h-6" />
        </button>
      )}

      {/* Create / Edit Project Modal */}
      {projModal.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'var(--backdrop-mask)', backdropFilter: 'blur(8px)' }}
          onClick={() => setProjModal((s) => ({ ...s, open: false }))}
        >
          <div
            className="w-full max-w-[360px] rounded-[16px] p-4 space-y-4 ap-glass-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>
              {projModal.editing
                ? zh
                  ? '编辑项目'
                  : 'Edit Project'
                : zh
                  ? '新建项目'
                  : 'New Project'}
            </div>
            <input
              type="text"
              autoFocus
              value={projModal.name}
              onChange={(e) => setProjModal((s) => ({ ...s, name: e.target.value }))}
              placeholder={zh ? '项目名称' : 'Project name'}
              className="ap-input w-full text-[14px]"
            />
            <div className="flex flex-wrap gap-2">
              {PROJECT_COLOR_PALETTE.map((c) => {
                const active = projModal.color === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setProjModal((s) => ({ ...s, color: c.key }))}
                    className="w-8 h-8 rounded-full inline-flex items-center justify-center"
                    style={{
                      background: c.dot,
                      outline: active ? '2px solid var(--text-1)' : 'none',
                      outlineOffset: 2,
                    }}
                    title={zh ? c.labelZh : c.labelEn}
                  >
                    {active && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setProjModal((s) => ({ ...s, open: false }))}
                className="px-3.5 py-2 rounded-[10px] text-[13px]"
                style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
              >
                {zh ? '取消' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={projSaving}
                onClick={() => void handleSaveProject()}
                className="ap-btn-primary px-4 py-2 rounded-[10px] text-[13px] font-semibold"
              >
                {zh ? '保存' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
