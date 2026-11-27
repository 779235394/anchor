import { useMemo, useState } from 'react';
import { Calendar, ChevronUp, Clock, Folder, Plus, Trash2, X } from 'lucide-react';
import {
  isActive,
  TASK_STATUS_ORDER,
  type Priority,
  type Task,
  type TaskStatus,
} from '@/domain/types';
import { getProjectColorMeta } from '@/domain/projectColor';
import {
  buildTaskFieldsFromContent,
  getTaskDisplayTitle,
  getTaskEditorContent,
} from '@/domain/taskContent';
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

export function TaskDetailContent({
  task,
  showDeleteButton = true,
}: {
  task: Task;
  showDeleteButton?: boolean;
}) {
  const {
    config,
    data,
    updateTask,
    moveTaskStatus,
    deleteTask,
    addAttachment,
    removeAttachment,
  } = useWorkbenchStore();

  const t = getDict(config.lang);
  const today = todayStr();
  const tomorrow = shiftDate(today, 1);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expandedScheduleTaskId, setExpandedScheduleTaskId] = useState<string | null>(null);

  const activeProjects = useMemo(() => data.projects.filter(isActive), [data.projects]);
  const selectedProj = useMemo(
    () => activeProjects.find((p) => p.id === task.projectId) || null,
    [activeProjects, task.projectId],
  );
  const selectedProjColor = selectedProj ? getProjectColorMeta(selectedProj) : null;

  const status: TaskStatus = task.status || (task.done ? 'done' : 'todo');
  const hasExtendedSchedule = Boolean(task.startDate || task.startTime || task.endTime);
  const showExtendedSchedule = hasExtendedSchedule || expandedScheduleTaskId === task.id;

  const prioMeta: Record<Priority, { short: string; full: string }> = {
    1: { short: t.prio1Short, full: t.prio1 },
    2: { short: t.prio2Short, full: t.prio2 },
    3: { short: t.prio3Short, full: t.prio3 },
    4: { short: t.prio4Short, full: t.prio4 },
  };

  const editorContent = getTaskEditorContent(task);
  const displayTitle = getTaskDisplayTitle(task, config.lang);

  return (
    <>
      {/* 1. Unified Content + Links & Attachments Writing Canvas (Simultaneous View) */}
      <div
        className="rounded-[11px] border overflow-hidden ap-ease border-[var(--hairline)] shadow-[inset_0_1px_0_var(--glass-specular)] focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_var(--accent-soft)]"
        style={{
          background: 'var(--bg-card-solid)',
        }}
      >
        <RichTextEditor
          key={task.id}
          variant="plain"
          showToolbar
          value={editorContent}
          onChange={(nextContent) =>
            updateTask(task.id, buildTaskFieldsFromContent(nextContent, task.attachments, false))
          }
          placeholder={t.richInspectorPh}
          minHeight={168}
          maxHeight={340}
          dropPriority={10}
          onAddAttachment={(att) => addAttachment('task', task.id, att)}
          className="px-3 pt-2 pb-1.5"
        />

        <AttachmentPanel
          embedded
          attachments={task.attachments || []}
          onAdd={(att) => addAttachment('task', task.id, att)}
          onRemove={(attId) => removeAttachment('task', task.id, attId)}
        />
      </div>

      {/* 2. Compact Grouped Properties Card */}
      <div
        className="rounded-[11px] border overflow-hidden"
        style={{
          background: 'color-mix(in srgb, var(--bg-subtle) 48%, var(--bg-card-solid))',
          borderColor: 'var(--hairline-soft)',
        }}
      >
        {/* Row 1 & 2: Single-Row Status Strip + Single-Row Priority Strip */}
        <div className="p-2 space-y-1.5">
          <div
            role="group"
            aria-label={t.taskStatusLabel}
            className={config.lang === 'zh' ? 'grid grid-cols-4 gap-1' : 'flex items-center gap-1'}
          >
            {TASK_STATUS_ORDER.map((st) => {
              const active = status === st;
              const style = STATUS_COLORS[st];
              const label = taskStatusLabel(st, config.lang);
              return (
                <button
                  key={st}
                  type="button"
                  title={`${t.taskStatusLabel}: ${label}`}
                  onClick={() => moveTaskStatus(task.id, st)}
                  className={`${
                    config.lang === 'zh' ? '' : 'flex-auto'
                  } h-[28px] px-1.5 rounded-[7px] text-[11.5px] font-medium inline-flex items-center justify-center gap-1.5 ap-ease whitespace-nowrap`}
                  style={{
                    background: active ? style.soft : 'var(--bg-card-solid)',
                    color: active ? style.color : 'var(--text-2)',
                    boxShadow: active
                      ? `inset 0 0 0 1px ${style.dot}`
                      : 'inset 0 0 0 1px var(--hairline-soft)',
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: style.dot }}
                  />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>

          <div
            role="group"
            aria-label={t.prioLabel}
            className="grid grid-cols-4 gap-1"
          >
            {([1, 2, 3, 4] as Priority[]).map((p) => {
              const active = task.prio === p;
              return (
                <button
                  key={p}
                  type="button"
                  title={`${t.prioLabel}: ${prioMeta[p].full}`}
                  onClick={() => updateTask(task.id, { prio: p })}
                  className="h-[28px] px-1 rounded-[7px] text-[11.5px] font-medium inline-flex items-center justify-center gap-1 ap-ease"
                  style={{
                    background: active ? PRIO_COLORS[p].soft : 'var(--bg-card-solid)',
                    color: active ? PRIO_COLORS[p].color : 'var(--text-2)',
                    boxShadow: active
                      ? `inset 0 0 0 1px ${PRIO_COLORS[p].color}`
                      : 'inset 0 0 0 1px var(--hairline-soft)',
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: PRIO_COLORS[p].color }}
                  />
                  <span className="truncate">{prioMeta[p].short}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 3: Project Select + Inline Postpone Cost */}
        <div
          className="px-2.5 py-2 flex items-center gap-2"
          style={{ borderTop: '1px solid var(--hairline-soft)' }}
        >
          <span
            className={`${
              config.lang === 'zh' ? 'w-[50px]' : 'w-[58px]'
            } shrink-0 inline-flex items-center gap-1.5 text-[11.5px] font-medium select-none`}
            style={{ color: 'var(--text-3)' }}
          >
            <Folder className="w-3.5 h-3.5 shrink-0" />
            {config.lang === 'zh' ? '项目' : 'Project'}
          </span>

          <div className="relative flex-1 min-w-0">
            {selectedProjColor && (
              <span
                className="w-2 h-2 rounded-full pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
                style={{ background: selectedProjColor.dot }}
              />
            )}
            <select
              aria-label={t.projectLabel}
              value={task.projectId}
              onChange={(e) => updateTask(task.id, { projectId: e.target.value })}
              className={`ap-input w-full h-[30px] rounded-[8px] text-[12px] font-medium py-0 pr-7 ${
                selectedProjColor ? 'pl-6' : 'pl-2.5'
              }`}
              style={{
                backgroundColor: 'var(--bg-card-solid)',
                borderColor: 'var(--hairline-soft)',
              }}
            >
              <option value="">{t.noProject}</option>
              {activeProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {task.rolls ? (
            <span
              title={`${t.postponeCostLabel}: ${t.rollsBadge(task.rolls)}`}
              className="h-[30px] px-2.5 rounded-[8px] text-[11.5px] font-medium inline-flex items-center shrink-0 select-none"
              style={{
                background: 'var(--status-orange-soft)',
                color: 'var(--status-orange)',
              }}
            >
              {t.rollsBadge(task.rolls)}
            </span>
          ) : (
            <span
              title={`${t.postponeCostLabel}: ${t.postponeZero}`}
              className="px-1.5 text-[11px] shrink-0 select-none"
              style={{ color: 'var(--text-3)' }}
            >
              {config.lang === 'zh' ? '准时' : 'On track'}
            </span>
          )}
        </div>

        {/* Row 4: Aligned Due Date + Unified Today/Tmrw Mini-Segment */}
        <div
          className="px-2.5 py-2 flex items-center gap-2"
          style={{ borderTop: '1px solid var(--hairline-soft)' }}
        >
          <span
            className={`${
              config.lang === 'zh' ? 'w-[50px]' : 'w-[58px]'
            } shrink-0 inline-flex items-center gap-1.5 text-[11.5px] font-medium select-none`}
            style={{ color: 'var(--text-3)' }}
          >
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            {config.lang === 'zh' ? '截止' : 'Due'}
          </span>

          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            <input
              type="date"
              aria-label={t.dueDateLabel}
              title={t.dueDateLabel}
              value={task.due}
              onChange={(e) => updateTask(task.id, { due: e.target.value })}
              className="ap-input flex-1 min-w-[114px] h-[30px] rounded-[8px] text-[12px] font-medium tabular-nums py-0 px-2"
              style={{
                backgroundColor: 'var(--bg-card-solid)',
                borderColor: 'var(--hairline-soft)',
              }}
            />

            <div
              className="h-[30px] p-[2px] rounded-[8px] inline-flex items-center shrink-0 border"
              style={{
                backgroundColor: 'var(--bg-card-solid)',
                borderColor: 'var(--hairline-soft)',
              }}
            >
              <button
                type="button"
                onClick={() => updateTask(task.id, { startDate: '', due: today })}
                className="h-[24px] px-2 rounded-[6px] text-[11.5px] font-medium ap-ease"
                style={{
                  background: task.due === today ? 'var(--accent-soft)' : 'transparent',
                  color: task.due === today ? 'var(--accent)' : 'var(--text-2)',
                }}
              >
                {t.scheduleToday}
              </button>
              <button
                type="button"
                onClick={() => updateTask(task.id, { startDate: '', due: tomorrow })}
                className="h-[24px] px-2 rounded-[6px] text-[11.5px] font-medium ap-ease"
                style={{
                  background: task.due === tomorrow ? 'var(--accent-soft)' : 'transparent',
                  color: task.due === tomorrow ? 'var(--accent)' : 'var(--text-2)',
                }}
              >
                {config.lang === 'zh' ? '明天' : 'Tmrw'}
              </button>
            </div>

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
                className="w-[24px] h-[30px] rounded-[7px] shrink-0 inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle-hover)]"
                style={{ color: 'var(--text-3)' }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Row 5: Quiet Collapsible Start Date & Time Slot Row */}
        <div style={{ borderTop: '1px solid var(--hairline-soft)' }}>
          {!showExtendedSchedule ? (
            <button
              type="button"
              onClick={() => setExpandedScheduleTaskId(task.id)}
              className="w-full px-2.5 py-2 flex items-center gap-2 text-left ap-ease hover:bg-[var(--bg-subtle-hover)]"
            >
              <span
                className={`${
                  config.lang === 'zh' ? 'w-[50px]' : 'w-[58px]'
                } shrink-0 inline-flex items-center gap-1.5 text-[11.5px] font-medium`}
                style={{ color: 'var(--text-3)' }}
              >
                <Clock className="w-3.5 h-3.5 shrink-0" />
                {config.lang === 'zh' ? '时段' : 'Time'}
              </span>
              <span className="flex-1 text-[11.5px] truncate" style={{ color: 'var(--text-3)' }}>
                {config.lang === 'zh'
                  ? '添加开始日期或具体时间段…'
                  : 'Add start date or time slot…'}
              </span>
              <Plus className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-3)' }} />
            </button>
          ) : (
            <div className="px-2.5 py-2 space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className={`${
                    config.lang === 'zh' ? 'w-[50px]' : 'w-[58px]'
                  } shrink-0 inline-flex items-center gap-1.5 text-[11.5px] font-medium select-none`}
                  style={{ color: 'var(--text-3)' }}
                >
                  <Calendar className="w-3.5 h-3.5 shrink-0 opacity-70" />
                  {config.lang === 'zh' ? '开始' : 'Start'}
                </span>
                <input
                  type="date"
                  aria-label={t.startDateLabel}
                  value={task.startDate || ''}
                  onChange={(e) => {
                    const nextStart = e.target.value;
                    const nextDue = task.due || nextStart;
                    updateTask(task.id, { startDate: nextStart, due: nextDue });
                  }}
                  className="ap-input flex-1 h-[30px] rounded-[8px] text-[12px] font-medium tabular-nums py-0 px-2"
                  style={{
                    backgroundColor: 'var(--bg-card-solid)',
                    borderColor: 'var(--hairline-soft)',
                  }}
                />
                {!hasExtendedSchedule && (
                  <button
                    type="button"
                    title={config.lang === 'zh' ? '收起' : 'Collapse'}
                    onClick={() => setExpandedScheduleTaskId(null)}
                    className="w-[24px] h-[30px] rounded-[7px] shrink-0 inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle-hover)]"
                    style={{ color: 'var(--text-3)' }}
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`${
                    config.lang === 'zh' ? 'w-[50px]' : 'w-[58px]'
                  } shrink-0 inline-flex items-center gap-1.5 text-[11.5px] font-medium select-none`}
                  style={{ color: 'var(--text-3)' }}
                >
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  {config.lang === 'zh' ? '时段' : 'Time'}
                </span>
                <div className="flex-1 flex items-center gap-1.5 min-w-0">
                  <input
                    type="time"
                    aria-label={t.timeRangeLabel}
                    value={task.startTime || ''}
                    onChange={(e) =>
                      updateTask(task.id, {
                        startTime: e.target.value || undefined,
                        due: task.due || today,
                      })
                    }
                    className="ap-input flex-1 min-w-0 h-[30px] rounded-[8px] text-[12px] font-medium tabular-nums py-0 px-2"
                    style={{
                      backgroundColor: 'var(--bg-card-solid)',
                      borderColor: 'var(--hairline-soft)',
                    }}
                  />
                  <span className="text-[11px] shrink-0" style={{ color: 'var(--text-3)' }}>
                    –
                  </span>
                  <input
                    type="time"
                    aria-label={t.timeRangeLabel}
                    value={task.endTime || ''}
                    disabled={!task.startTime}
                    onChange={(e) =>
                      updateTask(task.id, {
                        endTime: e.target.value || undefined,
                      })
                    }
                    className="ap-input flex-1 min-w-0 h-[30px] rounded-[8px] text-[12px] font-medium tabular-nums py-0 px-2 disabled:opacity-45"
                    style={{
                      backgroundColor: 'var(--bg-card-solid)',
                      borderColor: 'var(--hairline-soft)',
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Quiet Compact Delete Action */}
      {showDeleteButton && (
        <div className="flex items-center justify-end pt-0.5">
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="h-[28px] px-2.5 rounded-[8px] text-[12px] font-medium inline-flex items-center gap-1.5 ap-ease hover:bg-[var(--status-red-soft)]"
            style={{ color: 'var(--status-red)' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t.delete}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t.delete}
        body={
          config.lang === 'zh'
            ? `确定删除任务「${displayTitle}」？`
            : `Delete task "${displayTitle}"?`
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

interface TaskInspectorProps {
  task: Task | null;
  overlay?: boolean;
}

export function TaskInspector({ task, overlay = false }: TaskInspectorProps) {
  const {
    config,
    openInspector,
    toggleTask,
    postponeTask,
    addAttachment,
    pushToast,
  } = useWorkbenchStore();

  const t = getDict(config.lang);

  if (!task) return null;

  const status: TaskStatus = task.status || (task.done ? 'done' : 'todo');
  const stStyle = STATUS_COLORS[status];

  return (
    <InspectorDrawer
      title={t.inspector}
      overlay={overlay}
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
      <TaskDetailContent task={task} />
    </InspectorDrawer>
  );
}
