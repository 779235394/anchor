import { useMemo, useState } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import { isActive, PRESET_ROLES, type Member } from '@/domain/types';
import { shiftDate, todayStr, weekStart } from '@/domain/date';
import { formatRole, getDict } from '@/i18n';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { InspectorDrawer } from '@/components/InspectorDrawer';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/Dialogs';

export function MembersView() {
  const {
    config,
    data,
    inspector,
    openInspector,
    addMember,
    updateMember,
    deleteMember,
  } = useWorkbenchStore();
  const t = getDict(config.lang);
  const today = todayStr();
  const ws = weekStart(today, 0);
  const we = shiftDate(ws, 6);
  const nowTs = Date.now();

  const [name, setName] = useState('');
  const [role, setRole] = useState<string>(PRESET_ROLES[1]);
  const [note, setNote] = useState('');
  const [delTarget, setDelTarget] = useState<{
    member: Member;
    assignCnt: number;
    dailyCnt: number;
  } | null>(null);

  const activeMembers = useMemo(
    () => data.members.filter(isActive).sort((a, b) => a.createdAt - b.createdAt),
    [data.members],
  );
  const activeAssignments = useMemo(
    () => data.assignments.filter(isActive),
    [data.assignments],
  );
  const activeDaily = useMemo(() => data.daily.filter(isActive), [data.daily]);

  const selected =
    inspector?.kind === 'member'
      ? activeMembers.find((m) => m.id === inspector.id) || null
      : null;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const created = addMember({ name, role, note });
    if (!created) return;
    setName('');
    setNote('');
    openInspector({ kind: 'member', id: created.id });
  };

  const askDelete = (member: Member) => {
    const assignCnt = activeAssignments.filter((a) => a.ownerId === member.id).length;
    const dailyCnt = activeDaily.filter((d) => d.ownerId === member.id).length;
    setDelTarget({ member, assignCnt, dailyCnt });
  };

  return (
    <div className="flex h-full min-w-0">
      <div className="flex-1 min-w-0 overflow-y-auto px-8 py-7">
        <div className="max-w-[960px] mx-auto space-y-5">
          <div>
            <h1 className="text-[24px] font-semibold tracking-[-0.025em] leading-tight">
              {t.membersTitle}
            </h1>
            <p className="text-[13px] mt-1" style={{ color: 'var(--text-2)' }}>
              {t.membersSub(activeMembers.length)}
            </p>
          </div>

          {/* Add Member Form with Preset + Custom Role */}
          <form onSubmit={handleAdd} className="ap-card p-4 space-y-2.5">
            <div className="flex flex-wrap gap-2.5">
              <input
                id="quick-capture-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.memberNamePh}
                maxLength={24}
                className="ap-input flex-1 min-w-[160px]"
              />
              <input
                type="text"
                list="preset-roles-datalist"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder={t.memberRolePh}
                maxLength={24}
                className="ap-input w-[190px]"
              />
              <datalist id="preset-roles-datalist">
                {PRESET_ROLES.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t.memberNotePh}
                maxLength={60}
                className="ap-input flex-1 min-w-[180px]"
              />
              <button type="submit" className="ap-btn ap-btn-primary">
                <Plus className="w-4 h-4" />
                {t.add}
              </button>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              {PRESET_ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className="ap-pill ap-ease"
                  style={{
                    background: role === r ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                    color: role === r ? 'var(--accent)' : 'var(--text-3)',
                  }}
                >
                  {formatRole(r, config.lang)}
                </button>
              ))}
            </div>
          </form>

          {/* Roster Grid */}
          {activeMembers.length === 0 ? (
            <div className="ap-card">
              <EmptyState
                icon={<Users className="w-8 h-8" strokeWidth={1.5} />}
                title={t.emptyMembers}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {activeMembers.map((m) => {
                const openAssigns = activeAssignments.filter(
                  (a) => a.ownerId === m.id && a.status !== 'done',
                );
                const overdueAssigns = openAssigns.filter(
                  (a) => a.dueAt && new Date(a.dueAt).getTime() < nowTs,
                );
                const weekDone = activeDaily.filter(
                  (d) => d.ownerId === m.id && d.done && d.date >= ws && d.date <= we,
                ).length;
                const sel = selected?.id === m.id;

                return (
                  <div
                    key={m.id}
                    onClick={() => openInspector({ kind: 'member', id: m.id })}
                    className="ap-card p-4 flex flex-col justify-between gap-3.5 cursor-pointer ap-ease"
                    style={{
                      borderColor: sel ? 'var(--accent)' : 'var(--hairline)',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-[11px] flex items-center justify-center text-white font-semibold text-[15px] shrink-0"
                        style={{ background: 'var(--accent)' }}
                      >
                        {m.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[14.5px] font-semibold truncate">{m.name}</div>
                        <div className="text-[12px] truncate" style={{ color: 'var(--text-3)' }}>
                          {formatRole(m.role, config.lang)}
                        </div>
                      </div>
                    </div>

                    {m.note && (
                      <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                        {m.note}
                      </p>
                    )}

                    <div
                      className="grid grid-cols-3 gap-2 pt-3 text-center"
                      style={{ borderTop: '1px solid var(--hairline-soft)' }}
                    >
                      <div>
                        <div className="text-[16px] font-semibold">{openAssigns.length}</div>
                        <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                          {t.memberOpenTasks}
                        </div>
                      </div>
                      <div>
                        <div
                          className="text-[16px] font-semibold"
                          style={{
                            color: overdueAssigns.length ? 'var(--status-red)' : 'var(--text-1)',
                          }}
                        >
                          {overdueAssigns.length}
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                          {t.memberOverdueTasks}
                        </div>
                      </div>
                      <div>
                        <div
                          className="text-[16px] font-semibold"
                          style={{ color: 'var(--status-green)' }}
                        >
                          {weekDone}
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                          {t.memberWeekDone}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Member Inspector */}
      {selected && (
        <InspectorDrawer
          title={t.inspector}
          onClose={() => openInspector(null)}
          footer={
            <button
              type="button"
              onClick={() => askDelete(selected)}
              className="ap-btn ap-btn-danger w-full"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t.delete}
            </button>
          }
        >
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.memberNamePh}
            </label>
            <input
              type="text"
              value={selected.name}
              onChange={(e) => updateMember(selected.id, { name: e.target.value })}
              className="ap-input w-full"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.memberRolePh}
            </label>
            <input
              type="text"
              list="preset-roles-datalist"
              value={selected.role}
              onChange={(e) => updateMember(selected.id, { role: e.target.value })}
              className="ap-input w-full"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.memberNotePh}
            </label>
            <textarea
              rows={3}
              value={selected.note}
              onChange={(e) => updateMember(selected.id, { note: e.target.value })}
              className="ap-input w-full resize-none"
            />
          </div>
        </InspectorDrawer>
      )}

      <ConfirmDialog
        open={!!delTarget}
        title={t.delete}
        body={
          delTarget
            ? t.memberDelBody(delTarget.member.name, delTarget.assignCnt, delTarget.dailyCnt)
            : ''
        }
        confirmLabel={t.delete}
        cancelLabel={t.cancel}
        danger
        onConfirm={() => {
          if (delTarget) deleteMember(delTarget.member.id);
          setDelTarget(null);
        }}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  );
}
