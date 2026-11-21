import { useMemo, useState } from 'react';
import { Calendar, Clock, Trash2, X } from 'lucide-react';
import {
  isActive,
  TASK_STATUS_ORDER,
  type Priority,
  type Task,
  type TaskStatus,
} from '@/domain/types';
import { shiftDate, todayStr } from '@/domain/date';
import { getDict, taskStatusLabel } from '@/i18n';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { PRIO_COLORS } from '@/components/CircularCheck';
import { InspectorDrawer } from '@/components/InspectorDrawer';
import { ConfirmDialog } from '@/components/Dialogs';
import { AttachmentPanel, interceptSmartPaste } from '@/components/AttachmentPanel';
import { RichTextEditor } from '@/components/RichTextEditor';

export const STATUS_COLORS: Record<
  TaskStatus,
  { color: string; soft: string; dot: string }
> = {
  todo: {
    color: 'var(--text-2)',
    soft: 'var(--bg-subtle)',
    dot: 'var(--status-gray)',
  },
  doing: {
    color: 'var(--accent)',
    soft: 'var(--accent-soft)',
    dot: 'var(--accent)',
  },
  confirm: {
    color: 'var(--status-orange)',
    soft: 'var(--status-orange-soft)',
    dot: 'var(--status-orange)',
  },
  done: {
    color: 'var(--status-green)',
    soft: 'var(--status-green-soft)',
    dot: 'var(--status-green)',
  },
};

interface TaskInspectorProps {
  task: Task | null;
}

export function TaskInspector({ task }: TaskInspectorProps) {
  const {
    config,
    data,
    openInspector,
    updateTask,
    moveTaskStatus,
    toggleTask,
    postponeTask,
    deleteTask,
    addAttachment,
    removeAttachment,
    pushToast,
  } = useWorkbenchStore();

  const t = getDict(config.lang);
  const today = todayStr();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const activeProjects = useMemo(() => data.projects.filter(isActive), [data.projects]);

  if (!task) return null;

  const status: TaskStatus = task.status || (task.done ? 'done' : 'todo');
  const stStyle = STATUS_COLORS[status];

  const prioLabels: Record<Priority, { short: string }> = {
    1: { short: t.prio1Short },
    2: { short: t.prio2Short },
    3: { short: t.prio3Short },
    4: { short: t.prio4Short },
  };

  return (
    <>
      <InspectorDrawer
        title={t.inspector}
        onPaste={(e) => {
          if (e.defaultPrevented) return;
          interceptSmartPaste(
            e,
            (att) => addAttachment('task', task.id, att),
            pushToast,
            t.attAdded,
            t.attLargeWarn,
          );
        }}
        badge={
          <span
            className="ap-pill"
            style={{
              background: stStyle.soft,
              color: stStyle.color,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: stStyle.dot }}
            />
            {taskStatusLabel(status, config.lang)}
          </span>
        }
        onClose={() => openInspector(null)}
        footer={
          <>
            {!task.done && (
              <button
                type="button"
                onClick={() => postponeTask(task.id)}
                className="ap-btn flex-1"
              >
                {t.postponeTomorrow}
              </button>
            )}
            <button
              type="button"
              onClick={() => toggleTask(task.id)}
              className="ap-btn ap-btn-primary flex-1"
            >
              {task.done ? t.markUndone : t.markDone}
            </button>
          </>
        }
      >
        {/* Title */}
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
            {t.taskTitleLabel}
          </label>
          <textarea
            rows={2}
            value={task.title}
            onChange={(e) => updateTask(task.id, { title: e.target.value })}
            className="ap-input w-full resize-none"
            maxLength={140}
          />
        </div>

        {/* 4-Stage Kanban Flow Status */}
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
            {t.taskStatusLabel}
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {TASK_STATUS_ORDER.map((st) => {
              const active = status === st;
              const style = STATUS_COLORS[st];
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => moveTaskStatus(task.id, st)}
                  className="px-2.5 py-1.5 rounded-[9px] text-[12px] font-medium flex items-center gap-2 ap-ease"
                  style={{
                    background: active ? style.soft : 'var(--bg-subtle)',
                    color: active ? style.color : 'var(--text-2)',
                    boxShadow: active ? `inset 0 0 0 1px ${style.dot}` : 'none',
                  }}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: style.dot }}
                  />
                  <span className="truncate">{taskStatusLabel(st, config.lang)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Priority */}
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
            {t.prioLabel}
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {([1, 2, 3, 4] as Priority[]).map((p) => {
              const active = task.prio === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => updateTask(task.id, { prio: p })}
                  className="px-2.5 py-1.5 rounded-[9px] text-[12px] font-medium flex items-center gap-2 ap-ease"
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

        {/* Schedule Date Range & Optional Time Slot */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <label
              className="text-[12px] font-medium inline-flex items-center gap-1"
              style={{ color: 'var(--text-2)' }}
            >
              <Calendar className="w-3.5 h-3.5" />
              {t.startDateLabel} / {t.dueDateLabel}
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => updateTask(task.id, { startDate: '', due: today })}
                className="text-[11px] px-1.5 py-0.5 rounded-[6px] ap-ease hover:bg-[var(--bg-subtle-hover)]"
                style={{ color: 'var(--accent)', background: 'var(--accent-soft)' }}
              >
                {t.scheduleToday}
              </button>
              <button
                type="button"
                onClick={() =>
                  updateTask(task.id, { startDate: '', due: shiftDate(today, 1) })
                }
                className="text-[11px] px-1.5 py-0.5 rounded-[6px] ap-ease hover:bg-[var(--bg-subtle-hover)]"
                style={{ color: 'var(--text-2)', background: 'var(--bg-subtle)' }}
              >
                {config.lang === 'zh' ? '明天' : 'Tmrw'}
              </button>
              {(task.due || task.startDate) && (
                <button
                  type="button"
                  title={t.clearSchedule}
                  onClick={() =>
                    updateTask(task.id, {
                      startDate: '',
                      due: '',
                      startTime: undefined,
                      endTime: undefined,
                    })
                  }
                  className="w-5 h-5 rounded-[6px] inline-flex items-center justify-center hover:bg-[var(--bg-subtle-hover)]"
                  style={{ color: 'var(--text-3)' }}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {t.startDateLabel}
              </span>
              <input
                type="date"
                value={task.startDate || ''}
                onChange={(e) => {
                  const nextStart = e.target.value;
                  const nextDue = task.due || nextStart;
                  updateTask(task.id, { startDate: nextStart, due: nextDue });
                }}
                className="ap-input w-full text-[12px] py-1.5 px-2"
              />
            </div>
            <div className="space-y-1">
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {t.dueDateLabel}
              </span>
              <input
                type="date"
                value={task.due}
                onChange={(e) => updateTask(task.id, { due: e.target.value })}
                className="ap-input w-full text-[12px] py-1.5 px-2"
              />
            </div>
          </div>

          {/* Optional Time Slot */}
          <div className="space-y-1">
            <label
              className="text-[11px] inline-flex items-center gap-1"
              style={{ color: 'var(--text-3)' }}
            >
              <Clock className="w-3 h-3" />
              {t.timeRangeLabel}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="time"
                value={task.startTime || ''}
                onChange={(e) =>
                  updateTask(task.id, {
                    startTime: e.target.value || undefined,
                    due: task.due || today,
                  })
                }
                className="ap-input w-full text-[12px] py-1.5 px-2"
              />
              <input
                type="time"
                value={task.endTime || ''}
                disabled={!task.startTime}
                onChange={(e) =>
                  updateTask(task.id, {
                    endTime: e.target.value || undefined,
                  })
                }
                className="ap-input w-full text-[12px] py-1.5 px-2 disabled:opacity-45"
              />
            </div>
          </div>
        </div>

        {/* Project & Postpone Cost */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.projectLabel}
            </label>
            <select
              value={task.projectId}
              onChange={(e) => updateTask(task.id, { projectId: e.target.value })}
              className="ap-input w-full text-[12.5px] py-1.5"
            >
              <option value="">{t.noProject}</option>
              {activeProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.postponeCostLabel}
            </label>
            <div
              className="px-2.5 py-[7px] rounded-[9px] text-[12px] font-medium truncate"
              style={{
                background: task.rolls ? 'var(--status-orange-soft)' : 'var(--bg-subtle)',
                color: task.rolls ? 'var(--status-orange)' : 'var(--text-3)',
              }}
            >
              {task.rolls ? t.rollsBadge(task.rolls) : t.postponeZero}
            </div>
          </div>
        </div>

        {/* Rich Text Notes */}
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
            {t.notesLabel}
          </label>
          <RichTextEditor
            variant="input"
            value={task.note}
            onChange={(note) => updateTask(task.id, { note })}
            placeholder={t.richInspectorPh}
            minHeight={104}
            maxHeight={260}
            dropPriority={10}
            onAddAttachment={(att) => addAttachment('task', task.id, att)}
          />
        </div>

        {/* Attachments */}
        <AttachmentPanel
          attachments={task.attachments || []}
          onAdd={(att) => addAttachment('task', task.id, att)}
          onRemove={(attId) => removeAttachment('task', task.id, attId)}
        />

        {/* Delete */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="ap-btn ap-btn-danger ap-btn-sm w-full"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t.delete}
          </button>
        </div>
      </InspectorDrawer>

      <ConfirmDialog
        open={confirmDelete}
        title={t.delete}
        body={
          config.lang === 'zh'
            ? `确定删除任务「${task.title}」？`
            : `Delete task "${task.title}"?`
        }
        confirmLabel={t.delete}
        cancelLabel={t.cancel}
        danger
        onConfirm={() => {
          deleteTask(task.id);
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
