import { useRef, useState } from 'react';
import {
  Calendar,
  Clock,
  ImagePlus,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';
import {
  TASK_STATUS_ORDER,
  type Attachment,
  type Lang,
  type Priority,
  type Project,
  type Task,
  type TaskStatus,
} from '@/domain/types';
import { attachmentRelPathToMobileUrl } from '@/domain/mobileSync';
import { buildTaskFieldsFromContent, getTaskEditorContent } from '@/domain/taskContent';
import { getProjectColorMeta } from '@/domain/projectColor';
import { shiftDate, todayStr } from '@/domain/date';
import { mobileApi } from './api';

interface MobileTaskEditorProps {
  lang: Lang;
  task: Task | null; // null => creating new task
  defaultDue?: string;
  defaultProjectId?: string;
  defaultStatus?: TaskStatus;
  projects: Project[];
  onClose: () => void;
  onSaved: (saved: Task) => void;
  onDeleted?: (deleted: Task) => void;
  onPreviewImage: (url: string) => void;
  onToast: (msg: string, tone?: 'ok' | 'err') => void;
}

const STATUS_LABELS: Record<TaskStatus, { zh: string; en: string }> = {
  todo: { zh: '待办', en: 'To Do' },
  doing: { zh: '进行中', en: 'Doing' },
  confirm: { zh: '待确认', en: 'Confirm' },
  done: { zh: '已完成', en: 'Done' },
};

const PRIO_COLORS: Record<Priority, string> = {
  1: 'var(--status-red)',
  2: 'var(--status-orange)',
  3: 'var(--accent)',
  4: 'var(--status-gray)',
};

export function MobileTaskEditor({
  lang,
  task,
  defaultDue = '',
  defaultProjectId = '',
  defaultStatus = 'todo',
  projects,
  onClose,
  onSaved,
  onDeleted,
  onPreviewImage,
  onToast,
}: MobileTaskEditorProps) {
  const zh = lang !== 'en';
  const isNew = !task;
  const today = todayStr();

  const [content, setContent] = useState(() => (task ? getTaskEditorContent(task) : ''));
  const [prio, setPrio] = useState<Priority>(task?.prio || 2);
  const [status, setStatus] = useState<TaskStatus>(
    task?.status || (task?.done ? 'done' : defaultStatus),
  );
  const [projectId, setProjectId] = useState(task?.projectId || defaultProjectId);
  const [startDate, setStartDate] = useState(task?.startDate || '');
  const [due, setDue] = useState(task ? task.due || '' : defaultDue);
  const [startTime, setStartTime] = useState(task?.startTime || '');
  const [endTime, setEndTime] = useState(task?.endTime || '');
  const [attachments, setAttachments] = useState<Attachment[]>(task?.attachments || []);

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleSave = async () => {
    const { title: derivedTitle, note: cleanNote } = buildTaskFieldsFromContent(
      content,
      attachments,
      true,
    );
    if (!derivedTitle && !cleanNote && attachments.length === 0) {
      onToast(zh ? '请输入待办内容或添加图片' : 'Please enter task content or add a photo', 'err');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: derivedTitle,
        note: cleanNote,
        prio,
        status,
        projectId,
        startDate,
        due,
        startTime,
        endTime,
        attachments,
      };
      const saved = isNew
        ? await mobileApi.createTask(payload)
        : await mobileApi.updateTask(task.id, payload);
      onSaved(saved);
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    setSaving(true);
    try {
      const deleted = await mobileApi.deleteTask(task.id);
      onDeleted?.(deleted);
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const att = await mobileApi.uploadImage(file);
      setAttachments((prev) => [...prev, att]);
      onToast(zh ? '图片已上传' : 'Image uploaded', 'ok');
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      style={{ background: 'var(--backdrop-mask)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-h-[92vh] rounded-t-[20px] flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          boxShadow: 'var(--shadow-modal)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div
          className="px-4 py-3 flex items-center justify-between gap-2 shrink-0"
          style={{ borderBottom: '1px solid var(--hairline-soft)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-[14px]"
            style={{ color: 'var(--text-2)' }}
          >
            {zh ? '取消' : 'Cancel'}
          </button>
          <span className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>
            {isNew ? (zh ? '新建待办' : 'New Task') : zh ? '编辑待办' : 'Edit Task'}
          </span>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="ap-btn-primary px-3.5 py-1.5 rounded-[10px] text-[13.5px] font-semibold inline-flex items-center gap-1"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {zh ? '保存' : 'Save'}
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto m-scroll px-4 py-4 space-y-4 m-safe-bottom">
          {/* Unified Single-Box Task Content */}
          <textarea
            rows={5}
            autoFocus={isNew}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              zh
                ? '写下待办内容（首行自动作为摘要，支持 Markdown 与 - [ ] 子清单）…'
                : 'Write task details (first line becomes summary; Markdown & - [ ] checklists supported)…'
            }
            className="w-full text-[15.5px] leading-relaxed px-3.5 py-3 rounded-[12px] resize-y"
            style={{
              background: 'var(--bg-subtle)',
              color: 'var(--text-1)',
              border: '1px solid var(--hairline-soft)',
            }}
          />

          {/* Status */}
          <div className="space-y-1.5">
            <div className="text-[12px] font-medium" style={{ color: 'var(--text-3)' }}>
              {zh ? '任务状态' : 'Status'}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {TASK_STATUS_ORDER.map((st) => {
                const active = status === st;
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatus(st)}
                    className="py-2 rounded-[10px] text-[12.5px] font-medium"
                    style={{
                      background: active ? 'var(--accent)' : 'var(--bg-subtle)',
                      color: active ? '#ffffff' : 'var(--text-2)',
                    }}
                  >
                    {zh ? STATUS_LABELS[st].zh : STATUS_LABELS[st].en}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <div className="text-[12px] font-medium" style={{ color: 'var(--text-3)' }}>
              {zh ? '优先级' : 'Priority'}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {([1, 2, 3, 4] as Priority[]).map((p) => {
                const active = prio === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPrio(p)}
                    className="py-2 rounded-[10px] text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5"
                    style={{
                      background: active ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                      color: active ? PRIO_COLORS[p] : 'var(--text-2)',
                      border: active ? `1px solid ${PRIO_COLORS[p]}` : '1px solid transparent',
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: PRIO_COLORS[p] }}
                    />
                    P{p}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Project */}
          <div className="space-y-1.5">
            <div className="text-[12px] font-medium" style={{ color: 'var(--text-3)' }}>
              {zh ? '所属项目' : 'Project'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setProjectId('')}
                className="px-3 py-1.5 rounded-full text-[12.5px] font-medium"
                style={{
                  background: projectId === '' ? 'var(--accent)' : 'var(--bg-subtle)',
                  color: projectId === '' ? '#ffffff' : 'var(--text-2)',
                }}
              >
                {zh ? '未分类' : 'None'}
              </button>
              {projects.map((p) => {
                const active = projectId === p.id;
                const meta = getProjectColorMeta(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProjectId(p.id)}
                    className="px-3 py-1.5 rounded-full text-[12.5px] font-medium inline-flex items-center gap-1.5"
                    style={{
                      background: active ? meta.dot : meta.soft,
                      color: active ? '#ffffff' : meta.dot,
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: active ? '#ffffff' : meta.dot }}
                    />
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Schedule Date & Time */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span
                className="text-[12px] font-medium inline-flex items-center gap-1"
                style={{ color: 'var(--text-3)' }}
              >
                <Calendar className="w-3.5 h-3.5" />
                {zh ? '日程排期' : 'Schedule'}
              </span>
              <div className="flex items-center gap-1.5">
                {[
                  { label: zh ? '今天' : 'Today', val: today },
                  { label: zh ? '明天' : 'Tomorrow', val: shiftDate(today, 1) },
                  { label: zh ? '清除' : 'Clear', val: '' },
                ].map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => {
                      setDue(q.val);
                      if (!q.val) {
                        setStartDate('');
                        setStartTime('');
                        setEndTime('');
                      }
                    }}
                    className="px-2 py-0.5 rounded-[7px] text-[11.5px] font-medium"
                    style={{
                      background: due === q.val && q.val ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                      color: due === q.val && q.val ? 'var(--accent)' : 'var(--text-2)',
                    }}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {zh ? '开始日期（可选）' : 'Start Date'}
                </span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="ap-input w-full text-[13px]"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {zh ? '截止日期' : 'Due Date'}
                </span>
                <input
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  className="ap-input w-full text-[13px]"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span
                  className="text-[11px] inline-flex items-center gap-1"
                  style={{ color: 'var(--text-3)' }}
                >
                  <Clock className="w-3 h-3" />
                  {zh ? '开始时间' : 'Start Time'}
                </span>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="ap-input w-full text-[13px]"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {zh ? '结束时间' : 'End Time'}
                </span>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="ap-input w-full text-[13px]"
                />
              </label>
            </div>
          </div>

          {/* Image Attachments */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium" style={{ color: 'var(--text-3)' }}>
                {zh ? `图片与附件（${attachments.length}）` : `Attachments (${attachments.length})`}
              </span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void handleUploadFile(e.target.files?.[0])}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="px-2.5 py-1 rounded-[8px] text-[12px] font-medium inline-flex items-center gap-1.5"
                style={{
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                }}
              >
                {uploading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="w-3.5 h-3.5" />
                )}
                {zh ? '拍照 / 选图' : 'Add Photo'}
              </button>
            </div>

            {attachments.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {attachments.map((att) => {
                  const imgUrl =
                    att.kind === 'image' && att.relPath
                      ? attachmentRelPathToMobileUrl(att.relPath)
                      : null;
                  return (
                    <div
                      key={att.id}
                      className="relative rounded-[10px] overflow-hidden aspect-square flex items-center justify-center"
                      style={{
                        background: 'var(--bg-subtle)',
                        border: '1px solid var(--hairline-soft)',
                      }}
                    >
                      {imgUrl ? (
                        <img
                          src={imgUrl}
                          alt={att.name}
                          onClick={() => onPreviewImage(imgUrl)}
                          className="w-full h-full object-cover cursor-pointer"
                        />
                      ) : (
                        <div className="p-2 text-[11px] text-center truncate" style={{ color: 'var(--text-2)' }}>
                          {att.name}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setAttachments((prev) => prev.filter((x) => x.id !== att.id))
                        }
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white inline-flex items-center justify-center"
                        aria-label="Remove"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Delete button */}
          {!isNew && (
            <div className="pt-2">
              {confirmDel ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleDelete()}
                    className="flex-1 py-2.5 rounded-[12px] text-[13.5px] font-semibold"
                    style={{
                      background: 'var(--status-red)',
                      color: '#ffffff',
                    }}
                  >
                    {zh ? '确认删除此待办' : 'Confirm Delete'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDel(false)}
                    className="px-4 py-2.5 rounded-[12px] text-[13.5px]"
                    style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
                  >
                    {zh ? '取消' : 'Cancel'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDel(true)}
                  className="w-full py-2.5 rounded-[12px] text-[13.5px] font-medium inline-flex items-center justify-center gap-1.5"
                  style={{
                    background: 'var(--status-red-soft)',
                    color: 'var(--status-red)',
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                  {zh ? '删除待办' : 'Delete Task'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
