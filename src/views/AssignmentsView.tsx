import { useMemo, useState } from 'react';
import {
  ClipboardList,
  FolderKanban,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  isActive,
  type AssignmentStatus,
} from '@/domain/types';
import { defaultDueDateTime, formatShortDateTime } from '@/domain/date';
import { formatRole, getDict } from '@/i18n';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { SegmentedControl } from '@/components/SegmentedControl';
import { InspectorDrawer } from '@/components/InspectorDrawer';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/Dialogs';

const STATUS_LIST: AssignmentStatus[] = ['todo', 'doing', 'blocked', 'done'];

export function AssignmentsView() {
  const {
    config,
    data,
    inspector,
    openInspector,
    setView,
    addAssignment,
    updateAssignment,
    deleteAssignment,
  } = useWorkbenchStore();
  const t = getDict(config.lang);

  const [statusFilter, setStatusFilter] = useState<'all' | AssignmentStatus>('all');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [title, setTitle] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [dueAt, setDueAt] = useState(() => defaultDueDateTime());
  const [desc, setDesc] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const activeMembers = useMemo(
    () => data.members.filter(isActive).sort((a, b) => a.createdAt - b.createdAt),
    [data.members],
  );
  const activeProjects = useMemo(
    () => data.projects.filter((p) => isActive(p) && p.status !== 'done'),
    [data.projects],
  );
  const allActiveProjects = useMemo(
    () => data.projects.filter(isActive),
    [data.projects],
  );
  const activeAssignments = useMemo(
    () => data.assignments.filter(isActive),
    [data.assignments],
  );

  const memberMap = useMemo(
    () => new Map(activeMembers.map((m) => [m.id, m])),
    [activeMembers],
  );
  const projectMap = useMemo(
    () => new Map(allActiveProjects.map((p) => [p.id, p])),
    [allActiveProjects],
  );

  const effectiveOwner = ownerId || activeMembers[0]?.id || '';
  const nowTs = Date.now();

  const stats = useMemo(() => {
    const open = activeAssignments.filter((a) => a.status !== 'done');
    return {
      total: activeAssignments.length,
      open: open.length,
      doing: activeAssignments.filter((a) => a.status === 'doing').length,
      blocked: activeAssignments.filter((a) => a.status === 'blocked').length,
      overdue: open.filter((a) => a.dueAt && new Date(a.dueAt).getTime() < nowTs).length,
    };
  }, [activeAssignments, nowTs]);

  const filtered = useMemo(() => {
    let arr = activeAssignments;
    if (statusFilter !== 'all') arr = arr.filter((a) => a.status === statusFilter);
    if (ownerFilter === '__none') {
      arr = arr.filter((a) => !a.ownerId || !memberMap.has(a.ownerId));
    } else if (ownerFilter) {
      arr = arr.filter((a) => a.ownerId === ownerFilter);
    }
    return [...arr].sort((a, b) => {
      const ad = a.status === 'done' ? 1 : 0;
      const bd = b.status === 'done' ? 1 : 0;
      if (ad !== bd) return ad - bd;
      if (ad === 1) return (b.doneAt || 0) - (a.doneAt || 0);
      return (a.dueAt || '9999').localeCompare(b.dueAt || '9999');
    });
  }, [activeAssignments, statusFilter, ownerFilter, memberMap]);

  const selected =
    inspector?.kind === 'assignment'
      ? activeAssignments.find((a) => a.id === inspector.id) || null
      : null;

  const statusMeta = (st: AssignmentStatus) => {
    switch (st) {
      case 'doing':
        return { label: t.astDoing, bg: 'var(--status-sky-soft)', color: 'var(--status-sky)' };
      case 'blocked':
        return { label: t.astBlocked, bg: 'var(--status-red-soft)', color: 'var(--status-red)' };
      case 'done':
        return { label: t.astDone, bg: 'var(--status-green-soft)', color: 'var(--status-green)' };
      default:
        return { label: t.astTodo, bg: 'var(--bg-subtle)', color: 'var(--text-2)' };
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !dueAt) return;
    const created = addAssignment({
      title,
      desc,
      ownerId: effectiveOwner,
      projectId,
      dueAt,
      status: 'todo',
    });
    setTitle('');
    setDesc('');
    openInspector({ kind: 'assignment', id: created.id });
  };

  return (
    <div className="flex h-full min-w-0">
      <div className="flex-1 min-w-0 overflow-y-auto px-8 py-7">
        <div className="max-w-[960px] mx-auto space-y-5">
          {/* Header */}
          <div>
            <h1 className="text-[24px] font-semibold tracking-[-0.025em] leading-tight">
              {t.assignTitle}
            </h1>
            <p className="text-[13px] mt-1" style={{ color: 'var(--text-2)' }}>
              {t.assignSub(stats.total, stats.open, stats.blocked)}
            </p>
          </div>

          {/* 5 KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { n: stats.total, l: t.statTotal },
              { n: stats.open, l: t.statOpen },
              { n: stats.doing, l: t.statDoing },
              { n: stats.blocked, l: t.statBlocked, red: stats.blocked > 0 },
              { n: stats.overdue, l: t.statOverdue, red: stats.overdue > 0 },
            ].map((k) => (
              <div key={k.l} className="ap-card px-4 py-3.5">
                <div
                  className="text-[24px] font-semibold tracking-[-0.03em] leading-none"
                  style={{ color: k.red ? 'var(--status-red)' : 'var(--text-1)' }}
                >
                  {k.n}
                </div>
                <div className="text-[12px] mt-1.5" style={{ color: 'var(--text-3)' }}>
                  {k.l}
                </div>
              </div>
            ))}
          </div>

          {/* Quick Create Form */}
          {activeMembers.length === 0 ? (
            <div className="ap-card p-5 flex items-center justify-between gap-4">
              <span className="text-[13.5px]" style={{ color: 'var(--text-2)' }}>
                {t.dailyNoMembers}
              </span>
              <button
                type="button"
                onClick={() => setView('members')}
                className="ap-btn ap-btn-primary ap-btn-sm"
              >
                {t.goMembers}
              </button>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="ap-card p-4 space-y-2.5">
              <div className="flex flex-wrap gap-2.5">
                <input
                  id="quick-capture-input"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t.assignQuickPh}
                  maxLength={90}
                  className="ap-input flex-1 min-w-[200px]"
                />
                <select
                  value={effectiveOwner}
                  onChange={(e) => setOwnerId(e.target.value)}
                  className="ap-input w-[160px]"
                >
                  {activeMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {formatRole(m.role, config.lang)}
                    </option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  className="ap-input w-[186px] text-[12.5px]"
                  required
                />
                <button type="submit" className="ap-btn ap-btn-primary">
                  <Plus className="w-4 h-4" />
                  {t.create}
                </button>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <input
                  type="text"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder={t.assignDescPh}
                  maxLength={500}
                  className="ap-input flex-1 min-w-[200px] py-1.5 text-[12.5px]"
                />
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="ap-input w-[180px] py-1.5 text-[12.5px]"
                >
                  <option value="">{t.noProject}</option>
                  {activeProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </form>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <SegmentedControl<'all' | AssignmentStatus>
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'all', label: t.all, count: activeAssignments.length },
                ...STATUS_LIST.map((st) => ({
                  value: st,
                  label: statusMeta(st).label,
                  count: activeAssignments.filter((a) => a.status === st).length,
                  danger: st === 'blocked',
                })),
              ]}
            />
          </div>

          {activeMembers.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setOwnerFilter('')}
                className="ap-pill ap-ease"
                style={{
                  background: !ownerFilter ? 'var(--accent)' : 'var(--bg-subtle)',
                  color: !ownerFilter ? '#fff' : 'var(--text-2)',
                }}
              >
                {t.all}
              </button>
              {activeMembers.map((m) => {
                const on = ownerFilter === m.id;
                const openN = activeAssignments.filter(
                  (a) => a.ownerId === m.id && a.status !== 'done',
                ).length;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setOwnerFilter(on ? '' : m.id)}
                    className="ap-pill ap-ease"
                    style={{
                      background: on ? 'var(--accent)' : 'var(--bg-subtle)',
                      color: on ? '#fff' : 'var(--text-2)',
                    }}
                  >
                    {m.name} {openN > 0 ? openN : ''}
                  </button>
                );
              })}
            </div>
          )}

          {/* List */}
          <div className="ap-card overflow-hidden">
            {filtered.length === 0 ? (
              <EmptyState
                icon={<ClipboardList className="w-8 h-8" strokeWidth={1.5} />}
                title={t.emptyAssignments}
              />
            ) : (
              <div>
                {filtered.map((a, idx) => {
                  const sm = statusMeta(a.status);
                  const member = memberMap.get(a.ownerId);
                  const proj = a.projectId ? projectMap.get(a.projectId) : null;
                  const dueTs = a.dueAt ? new Date(a.dueAt).getTime() : 0;
                  const overdue = a.status !== 'done' && dueTs > 0 && dueTs < nowTs;
                  const odDays = overdue ? Math.max(1, Math.ceil((nowTs - dueTs) / 86_400_000)) : 0;
                  const sel = selected?.id === a.id;

                  return (
                    <div
                      key={a.id}
                      onClick={() => openInspector({ kind: 'assignment', id: a.id })}
                      className="flex items-start gap-3 px-4 py-3.5 cursor-pointer ap-ease"
                      style={{
                        background: sel ? 'var(--accent-soft)' : 'transparent',
                        borderBottom:
                          idx === filtered.length - 1
                            ? 'none'
                            : '1px solid var(--hairline-soft)',
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div
                          className="text-[14px] font-medium leading-snug"
                          style={{
                            color: a.status === 'done' ? 'var(--text-3)' : 'var(--text-1)',
                            textDecoration: a.status === 'done' ? 'line-through' : 'none',
                          }}
                        >
                          {a.title}
                        </div>
                        {a.desc && (
                          <p
                            className="text-[12.5px] mt-1 line-clamp-2"
                            style={{ color: 'var(--text-2)' }}
                          >
                            {a.desc}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <span
                            className="ap-pill"
                            style={{ background: 'var(--bg-subtle)', color: 'var(--text-1)' }}
                          >
                            {member ? member.name : t.unassigned}
                          </span>
                          <span
                            className="ap-pill"
                            style={{
                              background: overdue ? 'var(--status-red-soft)' : 'var(--bg-subtle)',
                              color: overdue ? 'var(--status-red)' : 'var(--text-2)',
                            }}
                          >
                            {overdue
                              ? config.lang === 'zh'
                                ? `逾期 ${odDays} 天`
                                : `${odDays}d overdue`
                              : formatShortDateTime(a.dueAt)}
                          </span>
                          {proj && (
                            <span
                              className="ap-pill"
                              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                            >
                              <FolderKanban className="w-3 h-3" />
                              {proj.name}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Inline Quick Status Dropdown */}
                      <div
                        className="flex items-center gap-1.5 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <select
                          value={a.status}
                          onChange={(e) =>
                            updateAssignment(a.id, {
                              status: e.target.value as AssignmentStatus,
                            })
                          }
                          className="rounded-full px-2.5 py-1 text-[12px] font-semibold border-0 outline-none cursor-pointer"
                          style={{ background: sm.bg, color: sm.color }}
                        >
                          {STATUS_LIST.map((st) => (
                            <option key={st} value={st}>
                              {statusMeta(st).label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Assignment Inspector */}
      {selected && (
        <InspectorDrawer
          title={t.inspector}
          onClose={() => openInspector(null)}
          footer={
            <button
              type="button"
              onClick={() => setDeleteId(selected.id)}
              className="ap-btn ap-btn-danger w-full"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t.delete}
            </button>
          }
        >
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.taskTitleLabel}
            </label>
            <textarea
              rows={2}
              value={selected.title}
              onChange={(e) => updateAssignment(selected.id, { title: e.target.value })}
              className="ap-input w-full resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.assignStatusLabel}
            </label>
            <select
              value={selected.status}
              onChange={(e) =>
                updateAssignment(selected.id, { status: e.target.value as AssignmentStatus })
              }
              className="ap-input w-full"
            >
              {STATUS_LIST.map((st) => (
                <option key={st} value={st}>
                  {statusMeta(st).label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.assignOwnerLabel}
            </label>
            <select
              value={selected.ownerId}
              onChange={(e) => updateAssignment(selected.id, { ownerId: e.target.value })}
              className="ap-input w-full"
            >
              <option value="">{t.unassigned}</option>
              {activeMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {formatRole(m.role, config.lang)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.projectLabel}
            </label>
            <select
              value={selected.projectId}
              onChange={(e) => updateAssignment(selected.id, { projectId: e.target.value })}
              className="ap-input w-full"
            >
              <option value="">{t.noProject}</option>
              {allActiveProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.assignDueLabel}
            </label>
            <input
              type="datetime-local"
              value={selected.dueAt}
              onChange={(e) => updateAssignment(selected.id, { dueAt: e.target.value })}
              className="ap-input w-full"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.assignDescLabel}
            </label>
            <textarea
              rows={4}
              value={selected.desc}
              onChange={(e) => updateAssignment(selected.id, { desc: e.target.value })}
              className="ap-input w-full resize-none leading-relaxed"
            />
          </div>
        </InspectorDrawer>
      )}

      <ConfirmDialog
        open={!!deleteId}
        title={t.delete}
        body={config.lang === 'zh' ? '确定删除这条任务分配？' : 'Delete this assignment?'}
        confirmLabel={t.delete}
        cancelLabel={t.cancel}
        danger
        onConfirm={() => {
          if (deleteId) deleteAssignment(deleteId);
          setDeleteId(null);
        }}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
