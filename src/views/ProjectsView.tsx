import { useMemo, useState } from 'react';
import {
  AlertCircle,
  FolderKanban,
  Kanban,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  isActive,
  type Project,
  type ProjectStatus,
} from '@/domain/types';
import { formatClock, humanDate, todayStr } from '@/domain/date';
import { getDict } from '@/i18n';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { CircularCheck } from '@/components/CircularCheck';
import { InspectorDrawer } from '@/components/InspectorDrawer';
import { EmptyState } from '@/components/EmptyState';
import { ChoiceDialog, ConfirmDialog } from '@/components/Dialogs';

const STATUS_ORDER: Record<ProjectStatus, number> = {
  blocked: 0,
  active: 1,
  done: 2,
};

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
    toggleTask,
  } = useWorkbenchStore();

  const t = getDict(config.lang);
  const today = todayStr();

  const [newName, setNewName] = useState('');
  const [newStatus, setNewStatus] = useState<ProjectStatus>('active');
  const [newStage, setNewStage] = useState('');
  const [newNext, setNewNext] = useState('');
  const [newBlocker, setNewBlocker] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ project: Project; linkedCount: number } | null>(
    null,
  );
  const [inlineTaskFor, setInlineTaskFor] = useState<string | null>(null);
  const [inlineTaskTitle, setInlineTaskTitle] = useState('');

  const activeProjects = useMemo(
    () =>
      data.projects
        .filter(isActive)
        .sort(
          (a, b) =>
            STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
            b.updatedAt - a.updatedAt,
        ),
    [data.projects],
  );
  const activeTasks = useMemo(() => data.tasks.filter(isActive), [data.tasks]);

  const selectedProject =
    inspector?.kind === 'project'
      ? activeProjects.find((p) => p.id === inspector.id) || null
      : null;

  const runningCnt = activeProjects.filter((p) => p.status !== 'done').length;
  const blockedCnt = activeProjects.filter((p) => p.status === 'blocked').length;
  const doneCnt = activeProjects.filter((p) => p.status === 'done').length;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const p = addProject({
      name: newName,
      status: newStatus,
      stage: newStage,
      next: newNext,
      blocker: newBlocker,
    });
    setNewName('');
    setNewStage('');
    setNewNext('');
    setNewBlocker('');
    setNewStatus('active');
    openInspector({ kind: 'project', id: p.id });
  };

  const askDelete = (project: Project) => {
    const linkedCount = activeTasks.filter((k) => k.projectId === project.id).length;
    setDeleteTarget({ project, linkedCount });
  };

  const statusMeta = (st: ProjectStatus) => {
    if (st === 'blocked')
      return {
        label: t.projStatusBlocked,
        bg: 'var(--status-red-soft)',
        color: 'var(--status-red)',
      };
    if (st === 'done')
      return {
        label: t.projStatusDone,
        bg: 'var(--bg-subtle)',
        color: 'var(--text-3)',
      };
    return {
      label: t.projStatusActive,
      bg: 'var(--accent-soft)',
      color: 'var(--accent)',
    };
  };

  return (
    <div className="flex h-full min-w-0">
      <div className="flex-1 min-w-0 overflow-y-auto px-8 py-7">
        <div className="max-w-[960px] mx-auto space-y-5">
          {/* Header */}
          <div>
            <h1 className="text-[24px] font-semibold tracking-[-0.025em] leading-tight">
              {t.projectsTitle}
            </h1>
            <p className="text-[13px] mt-1" style={{ color: 'var(--text-2)' }}>
              {t.projectsSub(runningCnt, blockedCnt, doneCnt)}
            </p>
          </div>

          {/* Quick Project Create Card */}
          <form onSubmit={handleCreate} className="ap-card p-4 space-y-2.5">
            <div className="flex flex-wrap gap-2.5">
              <input
                id="quick-capture-input"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t.projNamePh}
                maxLength={80}
                className="ap-input flex-1 min-w-[200px]"
              />
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value as ProjectStatus)}
                className="ap-input w-[130px]"
              >
                <option value="active">{t.projStatusActive}</option>
                <option value="blocked">{t.projStatusBlocked}</option>
                <option value="done">{t.projStatusDone}</option>
              </select>
              <button type="submit" className="ap-btn ap-btn-primary">
                <Plus className="w-4 h-4" />
                {t.newProject}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              <input
                type="text"
                value={newStage}
                onChange={(e) => setNewStage(e.target.value)}
                placeholder={t.projStagePh}
                maxLength={160}
                className="ap-input text-[12.5px] py-1.5"
              />
              <input
                type="text"
                value={newNext}
                onChange={(e) => setNewNext(e.target.value)}
                placeholder={t.projNextPh}
                maxLength={160}
                className="ap-input text-[12.5px] py-1.5"
              />
              <input
                type="text"
                value={newBlocker}
                onChange={(e) => setNewBlocker(e.target.value)}
                placeholder={t.projBlockerPh}
                maxLength={160}
                className="ap-input text-[12.5px] py-1.5"
              />
            </div>
          </form>

          {/* Project Cards Grid */}
          {activeProjects.length === 0 ? (
            <div className="ap-card">
              <EmptyState
                icon={<FolderKanban className="w-8 h-8" strokeWidth={1.5} />}
                title={t.emptyProjects}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {activeProjects.map((project) => {
                const sm = statusMeta(project.status);
                const blocked = project.status === 'blocked';
                const selected = selectedProject?.id === project.id;

                const projTasks = activeTasks.filter((k) => k.projectId === project.id);
                const totalLinked = projTasks.length;
                const doneLinked = projTasks.filter((k) => k.done).length;
                const pct = totalLinked ? Math.round((doneLinked / totalLinked) * 100) : 0;

                const openTasksPreview = projTasks
                  .filter((k) => !k.done)
                  .sort((a, b) => a.prio - b.prio)
                  .slice(0, 4);

                return (
                  <div
                    key={project.id}
                    onClick={() => openInspector({ kind: 'project', id: project.id })}
                    className="ap-card p-5 flex flex-col gap-4 cursor-pointer ap-ease"
                    style={{
                      borderColor: selected
                        ? 'var(--accent)'
                        : blocked
                          ? 'var(--status-red-line)'
                          : 'var(--hairline)',
                    }}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-[16px] font-semibold tracking-[-0.015em] truncate">
                            {project.name}
                          </h3>
                          <span
                            className="ap-pill"
                            style={{ background: sm.bg, color: sm.color }}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ background: 'currentColor' }}
                            />
                            {sm.label}
                          </span>
                        </div>
                        <div className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>
                          {formatClock(project.updatedAt, config.lang, today)}
                        </div>
                      </div>

                      {totalLinked > 0 && (
                        <div className="text-right shrink-0">
                          <div
                            className="text-[20px] font-semibold tracking-[-0.03em] leading-none"
                            style={{
                              color: pct === 100 ? 'var(--status-green)' : 'var(--text-1)',
                            }}
                          >
                            {pct}%
                          </div>
                          <div className="text-[11.5px] mt-1" style={{ color: 'var(--text-3)' }}>
                            {doneLinked}/{totalLinked}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Core 3 Fields */}
                    <div className="space-y-1.5 text-[13px] leading-relaxed">
                      <div className="flex gap-3">
                        <span
                          className="w-12 shrink-0 text-[12px] font-medium pt-0.5"
                          style={{ color: 'var(--text-3)' }}
                        >
                          {t.projStage}
                        </span>
                        <span style={{ color: project.stage ? 'var(--text-1)' : 'var(--text-4)' }}>
                          {project.stage || '—'}
                        </span>
                      </div>
                      <div className="flex gap-3">
                        <span
                          className="w-12 shrink-0 text-[12px] font-medium pt-0.5"
                          style={{ color: 'var(--text-3)' }}
                        >
                          {t.projNext}
                        </span>
                        <span style={{ color: project.next ? 'var(--text-2)' : 'var(--text-4)' }}>
                          {project.next || '—'}
                        </span>
                      </div>

                      {(blocked || project.blocker) && (
                        <div
                          className="mt-1 px-3 py-2 rounded-[10px] flex items-start gap-2 text-[12.5px] leading-relaxed"
                          style={{
                            background: 'var(--status-red-soft)',
                            color: 'var(--status-red)',
                          }}
                        >
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>
                            <strong>{t.projBlocker}：</strong>
                            {project.blocker || '—'}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Linked Personal Tasks */}
                    <div
                      className="pt-3.5 space-y-2.5"
                      style={{ borderTop: '1px solid var(--hairline-soft)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="text-[11.5px] font-semibold uppercase tracking-wide"
                          style={{ color: 'var(--text-3)' }}
                        >
                          {t.projLinkedTitle}
                        </span>
                        <div className="flex items-center gap-1.5">
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
                          {projTasks.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setTaskProjectFilter(project.id);
                                setView('tasks');
                              }}
                              className="text-[12px] font-medium px-1.5"
                              style={{ color: 'var(--accent)' }}
                            >
                              {t.all} →
                            </button>
                          )}
                        </div>
                      </div>

                      {inlineTaskFor === project.id && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!inlineTaskTitle.trim()) return;
                            addTask({
                              title: inlineTaskTitle,
                              prio: 2,
                              due: today,
                              projectId: project.id,
                            });
                            setInlineTaskTitle('');
                            setInlineTaskFor(null);
                          }}
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

                      {totalLinked > 0 ? (
                        <>
                          <div
                            className="h-1.5 w-full rounded-full overflow-hidden"
                            style={{ background: 'var(--bg-subtle)' }}
                          >
                            <div
                              className="h-full rounded-full ap-ease"
                              style={{
                                width: `${pct}%`,
                                background:
                                  pct === 100
                                    ? 'var(--status-green)'
                                    : blocked
                                      ? 'var(--status-red)'
                                      : 'var(--accent)',
                              }}
                            />
                          </div>

                          {openTasksPreview.length === 0 ? (
                            <div
                              className="text-[12.5px] font-medium"
                              style={{ color: 'var(--status-green)' }}
                            >
                              {t.projAllClear}
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {openTasksPreview.map((k) => {
                                const od = !!k.due && k.due < today;
                                return (
                                  <div
                                    key={k.id}
                                    className="flex items-center gap-2 py-1 text-[13px]"
                                  >
                                    <CircularCheck
                                      checked={k.done}
                                      prio={k.prio}
                                      size={17}
                                      onChange={() => toggleTask(k.id)}
                                    />
                                    <span className="flex-1 truncate">{k.title}</span>
                                    <span
                                      className="text-[11.5px] shrink-0"
                                      style={{
                                        color: od ? 'var(--status-red)' : 'var(--text-3)',
                                      }}
                                    >
                                      {humanDate(k.due, config.lang, today)}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                          {t.projNoLinked}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Project Inspector */}
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
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.projStatusLabel}
            </label>
            <select
              value={selectedProject.status}
              onChange={(e) =>
                updateProject(selectedProject.id, { status: e.target.value as ProjectStatus })
              }
              className="ap-input w-full"
            >
              <option value="active">{t.projStatusActive}</option>
              <option value="blocked">{t.projStatusBlocked}</option>
              <option value="done">{t.projStatusDone}</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.projStage}
            </label>
            <textarea
              rows={2}
              value={selectedProject.stage}
              onChange={(e) => updateProject(selectedProject.id, { stage: e.target.value })}
              className="ap-input w-full resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.projNext}
            </label>
            <textarea
              rows={2}
              value={selectedProject.next}
              onChange={(e) => updateProject(selectedProject.id, { next: e.target.value })}
              className="ap-input w-full resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.projBlocker}
            </label>
            <textarea
              rows={3}
              value={selectedProject.blocker}
              onChange={(e) => updateProject(selectedProject.id, { blocker: e.target.value })}
              placeholder={t.projBlockerPh}
              className="ap-input w-full resize-none"
            />
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
