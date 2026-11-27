import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  CornerDownLeft,
  FileText,
  Hash,
  Image as ImageIcon,
  Lightbulb,
  Link2,
  Paperclip,
  Pin,
  X,
} from 'lucide-react';
import {
  createId,
  isActive,
  type AppConfig,
  type Attachment,
  type Note,
  type Priority,
  type Project,
  type Task,
} from '@/domain/types';
import { shiftDate, todayStr } from '@/domain/date';
import { normalizeTask } from '@/domain/merge';
import { buildTaskFieldsFromContent } from '@/domain/taskContent';
import { getDict } from '@/i18n';
import { isTauriRuntime, storageApi } from '@/services/storage';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { PRIO_COLORS } from '@/components/CircularCheck';
import {
  ingestBrowserFilesToAttachments,
  ingestLocalPathsToAttachments,
} from '@/components/AttachmentPanel';
import { RichTextEditor, type RichTextEditorHandle } from '@/components/RichTextEditor';

type CaptureMode = 'note' | 'task';

const LAST_MODE_KEY = 'anchor_quick_capture_last_mode';

function parseTags(raw: string): string[] {
  const parts = raw
    .split(/[,，;；\s]+/)
    .map((s) => s.replace(/^#/, '').trim())
    .filter(Boolean);
  return [...new Set(parts)].slice(0, 6);
}

function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const candidate = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function resolveInitialMode(defaultPref: AppConfig['quickCaptureDefaultMode']): CaptureMode {
  if (defaultPref === 'note' || defaultPref === 'task') return defaultPref;
  try {
    const saved = localStorage.getItem(LAST_MODE_KEY);
    if (saved === 'task' || saved === 'note') return saved;
  } catch {
    // ignore
  }
  return 'note';
}

interface QuickCaptureProps {
  /** `true` when rendered inside the dedicated Tauri floating `quick-capture` window. */
  standalone?: boolean;
  onClose?: () => void;
}

export function QuickCaptureWindow({ standalone = false, onClose }: QuickCaptureProps) {
  const store = useWorkbenchStore();

  const [cfg, setCfg] = useState<AppConfig>(store.config);
  const [projects, setProjects] = useState<Project[]>([]);
  const [mode, setMode] = useState<CaptureMode>(() =>
    resolveInitialMode(store.config.quickCaptureDefaultMode),
  );

  // Note draft
  const [noteText, setNoteText] = useState('');
  const [noteTags, setNoteTags] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [noteAttachments, setNoteAttachments] = useState<Attachment[]>([]);

  // Task draft (unified single-body content; first line auto-derives display title)
  const [taskContent, setTaskContent] = useState('');
  const [taskPrio, setTaskPrio] = useState<Priority>(2);
  const [taskDue, setTaskDue] = useState<string>(todayStr());
  const [taskStartTime, setTaskStartTime] = useState('');
  const [taskProjectId, setTaskProjectId] = useState('');
  const [taskAttachments, setTaskAttachments] = useState<Attachment[]>([]);

  // Shared inline link popover & feedback
  const [linkBarOpen, setLinkBarOpen] = useState(false);
  const [linkUrlDraft, setLinkUrlDraft] = useState('');
  const [savedBanner, setSavedBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const noteEditorRef = useRef<RichTextEditorHandle | null>(null);
  const taskEditorRef = useRef<RichTextEditorHandle | null>(null);
  const tagInputRef = useRef<HTMLInputElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const webImgInputRef = useRef<HTMLInputElement | null>(null);
  const webFileInputRef = useRef<HTMLInputElement | null>(null);

  const effectiveConfig = standalone ? cfg : store.config;
  const zh = effectiveConfig.lang === 'zh';
  const activeProjects = standalone
    ? projects
    : store.data.projects.filter(isActive);
  const t = getDict(effectiveConfig.lang);
  const today = todayStr();

  const focusActiveInput = useCallback((targetMode: CaptureMode) => {
    setTimeout(() => {
      if (targetMode === 'task') {
        taskEditorRef.current?.focus();
      } else {
        noteEditorRef.current?.focus();
      }
    }, 30);
  }, []);

  const applyThemeToDocument = useCallback((configObj: AppConfig) => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const resolved =
      configObj.theme === 'system' ? (mq.matches ? 'dark' : 'light') : configObj.theme;
    root.dataset.theme = resolved;
    root.dataset.accent = configObj.accent;
    root.lang = configObj.lang === 'en' ? 'en' : 'zh-CN';
  }, []);

  const refreshStandaloneContext = useCallback(async () => {
    if (!standalone) return;
    try {
      const [latestCfg, loaded] = await Promise.all([
        storageApi.getAppConfig(),
        storageApi.loadWorkspace(),
      ]);
      setCfg(latestCfg);
      applyThemeToDocument(latestCfg);
      setProjects(loaded.data.projects.filter(isActive));
      const nextMode = resolveInitialMode(latestCfg.quickCaptureDefaultMode);
      setMode(nextMode);
      setTaskDue(todayStr());
      focusActiveInput(nextMode);
    } catch {
      // ignore
    }
  }, [standalone, applyThemeToDocument, focusActiveInput]);

  useEffect(() => {
    if (!standalone) {
      focusActiveInput(mode);
      return;
    }
    void refreshStandaloneContext();
    let unlisten: (() => void) | null = null;
    void storageApi
      .onQuickCaptureShown(() => {
        void refreshStandaloneContext();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [standalone, refreshStandaloneContext]);

  const dismiss = useCallback(() => {
    setLinkBarOpen(false);
    if (standalone) {
      void storageApi.hideQuickCapture();
    } else {
      onClose?.();
    }
  }, [standalone, onClose]);

  // Standalone Quick Capture stays strictly always-on-top even when referencing other apps;
  // it dismisses explicitly via Cmd/Ctrl+Enter (save), Esc, global shortcut toggle, or the close button.

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (linkBarOpen) {
          setLinkBarOpen(false);
          focusActiveInput(mode);
          return;
        }
        dismiss();
      } else if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag !== 'SELECT' && !linkBarOpen) {
          e.preventDefault();
          const nextMode: CaptureMode = mode === 'note' ? 'task' : 'note';
          setMode(nextMode);
          try {
            localStorage.setItem(LAST_MODE_KEY, nextMode);
          } catch {
            // ignore
          }
          focusActiveInput(nextMode);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dismiss, mode, linkBarOpen, focusActiveInput]);

  const switchMode = (nextMode: CaptureMode) => {
    setMode(nextMode);
    setLinkBarOpen(false);
    try {
      localStorage.setItem(LAST_MODE_KEY, nextMode);
    } catch {
      // ignore
    }
    focusActiveInput(nextMode);
  };

  const resetDrafts = () => {
    setNoteText('');
    setNoteTags('');
    setShowTagInput(false);
    setNoteAttachments([]);
    setTaskContent('');
    setTaskPrio(2);
    setTaskDue(todayStr());
    setTaskStartTime('');
    setTaskProjectId('');
    setTaskAttachments([]);
    setLinkBarOpen(false);
    setLinkUrlDraft('');
  };

  const currentAttachments = mode === 'note' ? noteAttachments : taskAttachments;
  const addCurrentAttachment = (att: Attachment) => {
    if (mode === 'note') {
      setNoteAttachments((prev) => [...prev, att]);
    } else {
      setTaskAttachments((prev) => [...prev, att]);
    }
  };
  const removeCurrentAttachment = (id: string) => {
    if (mode === 'note') {
      setNoteAttachments((prev) => prev.filter((a) => a.id !== id));
    } else {
      setTaskAttachments((prev) => prev.filter((a) => a.id !== id));
    }
  };

  const pushFeedbackToast = (msg: string, tone?: 'ok' | 'err' | 'info') => {
    if (!standalone) {
      store.pushToast(msg, tone);
    }
  };

  const handlePickFiles = async (imagesOnly: boolean) => {
    if (isTauriRuntime()) {
      const paths = await storageApi.pickAttachmentFiles(imagesOnly);
      if (paths.length > 0) {
        await ingestLocalPathsToAttachments(
          paths,
          addCurrentAttachment,
          pushFeedbackToast,
          t.attAdded,
          t.attLargeWarn,
        );
      }
      return;
    }
    if (imagesOnly) {
      webImgInputRef.current?.click();
    } else {
      webFileInputRef.current?.click();
    }
  };

  const handleAddLink = () => {
    const clean = normalizeUrl(linkUrlDraft);
    if (!clean) return;
    let host = clean;
    try {
      host = new URL(clean).hostname.replace(/^www\./, '');
    } catch {
      // ignore
    }
    addCurrentAttachment({
      id: createId(),
      kind: 'link',
      name: host,
      url: clean,
      createdAt: Date.now(),
    });
    setLinkUrlDraft('');
    setLinkBarOpen(false);
    focusActiveInput(mode);
  };

  const submitCapture = async () => {
    if (saving) return;
    if (mode === 'note') {
      const cleanText = noteText.trim() || (noteAttachments[0]?.name ?? '');
      if (!cleanText && noteAttachments.length === 0) return;

      setSaving(true);
      try {
        if (standalone && isTauriRuntime()) {
          const loaded = await storageApi.loadWorkspace();
          const now = Date.now();
          const note: Note = {
            id: createId(),
            text: cleanText,
            tags: parseTags(noteTags),
            attachments: noteAttachments,
            createdAt: now,
            updatedAt: now,
          };
          const nextNotes = [note, ...loaded.data.notes];
          await storageApi.saveShard('notes', nextNotes);
          await storageApi.notifyQuickCaptureSaved('note');
        } else {
          store.addNote(cleanText, noteTags, noteAttachments);
        }
        resetDrafts();
        setSavedBanner(t.qcSavedNote);
        setTimeout(() => {
          setSavedBanner(null);
          dismiss();
        }, 160);
      } finally {
        setSaving(false);
      }
      return;
    }

    const { title: derivedTitle, note: cleanBody } = buildTaskFieldsFromContent(
      taskContent,
      taskAttachments,
      true,
    );
    if (!derivedTitle && !cleanBody && taskAttachments.length === 0) return;

    setSaving(true);
    try {
      if (standalone && isTauriRuntime()) {
        const loaded = await storageApi.loadWorkspace();
        const now = Date.now();
        const rawTask: Task = {
          id: createId(),
          title: derivedTitle,
          note: cleanBody || derivedTitle,
          prio: taskPrio,
          status: 'todo',
          due: taskDue,
          startTime: taskStartTime || undefined,
          order: now,
          done: false,
          doneAt: null,
          projectId: taskProjectId,
          rolls: 0,
          carriedDate: null,
          attachments: taskAttachments,
          createdAt: now,
          updatedAt: now,
        };
        const activeProjIds = new Set(loaded.data.projects.filter(isActive).map((p) => p.id));
        const normalized = normalizeTask(rawTask, activeProjIds);
        const nextTasks = [normalized, ...loaded.data.tasks];
        await storageApi.saveShard('tasks', nextTasks);
        await storageApi.notifyQuickCaptureSaved('task');
      } else {
        store.addTask({
          title: derivedTitle,
          note: cleanBody,
          prio: taskPrio,
          status: 'todo',
          due: taskDue,
          startTime: taskStartTime || undefined,
          projectId: taskProjectId,
          attachments: taskAttachments,
        });
      }
      resetDrafts();
      setSavedBanner(t.qcSavedTask);
      setTimeout(() => {
        setSavedBanner(null);
        dismiss();
      }, 160);
    } finally {
      setSaving(false);
    }
  };

  const canSubmit =
    mode === 'note'
      ? noteText.trim().length > 0 || noteAttachments.length > 0
      : taskContent.trim().length > 0 || taskAttachments.length > 0;

  const cyclePrio = () => {
    setTaskPrio((p) => ((p % 4) + 1) as Priority);
  };

  const cardBody = (
    <div
      className={`w-full flex flex-col overflow-hidden ${
        standalone ? 'h-full' : 'max-w-[560px] rounded-[16px]'
      }`}
      style={{
        background: 'var(--bg-elevated)',
        border: standalone ? 'none' : '1px solid var(--hairline)',
        boxShadow: standalone ? 'var(--glass-specular)' : 'var(--shadow-modal)',
        backdropFilter: standalone ? undefined : 'var(--glass-blur-lg)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Hidden browser-fallback file inputs */}
      <input
        ref={webImgInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            void ingestBrowserFilesToAttachments(
              e.target.files,
              addCurrentAttachment,
              pushFeedbackToast,
              t.attAdded,
              t.attLargeWarn,
            );
            e.target.value = '';
          }
        }}
      />
      <input
        ref={webFileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            void ingestBrowserFilesToAttachments(
              e.target.files,
              addCurrentAttachment,
              pushFeedbackToast,
              t.attAdded,
              t.attLargeWarn,
            );
            e.target.value = '';
          }
        }}
      />

      {/* Minimal Whisper-Clean Top Bar (Draggable in Standalone Mode) */}
      <div
        data-tauri-drag-region={standalone ? 'deep' : undefined}
        className="px-4 pt-3 pb-1.5 shrink-0 flex items-center justify-between gap-2 select-none"
      >
        <div className="flex items-center gap-2.5">
          <img
            src="/app-icon.png"
            alt="Anchor"
            draggable={false}
            className="w-[18px] h-[18px] rounded-[5px] object-cover opacity-90"
          />
          <div
            className="inline-flex items-center p-[3px] rounded-[10px]"
            style={{
              background: 'var(--bg-subtle)',
              border: '1px solid var(--hairline-soft)',
            }}
          >
            <button
              type="button"
              onClick={() => switchMode('note')}
              className="px-2.5 py-[3px] rounded-[7px] text-[12px] font-medium inline-flex items-center gap-1.5 ap-ease"
              style={{
                background: mode === 'note' ? 'var(--seg-active-bg)' : 'transparent',
                color: mode === 'note' ? 'var(--text-1)' : 'var(--text-3)',
                boxShadow: mode === 'note' ? 'var(--seg-active-shadow)' : 'none',
              }}
            >
              <Lightbulb
                className="w-3 h-3"
                style={{ color: mode === 'note' ? 'var(--accent)' : 'currentColor' }}
              />
              {zh ? '灵感' : 'Note'}
            </button>
            <button
              type="button"
              onClick={() => switchMode('task')}
              className="px-2.5 py-[3px] rounded-[7px] text-[12px] font-medium inline-flex items-center gap-1.5 ap-ease"
              style={{
                background: mode === 'task' ? 'var(--seg-active-bg)' : 'transparent',
                color: mode === 'task' ? 'var(--text-1)' : 'var(--text-3)',
                boxShadow: mode === 'task' ? 'var(--seg-active-shadow)' : 'none',
              }}
            >
              <CheckCircle2
                className="w-3 h-3"
                style={{ color: mode === 'task' ? 'var(--accent)' : 'currentColor' }}
              />
              {zh ? '待办' : 'Task'}
            </button>
          </div>
          <span className="ap-kbd text-[10.5px] px-1.5 py-[1px] font-medium hidden sm:inline">
            Tab
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {savedBanner && (
            <span
              className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-0.5 rounded-full"
              style={{ background: 'var(--status-green-soft)', color: 'var(--status-green)' }}
            >
              <Check className="w-3 h-3" />
              {savedBanner}
            </span>
          )}
          {standalone && (
            <span
              title={zh ? '始终置顶于所有窗口之上' : 'Always on top'}
              className="inline-flex items-center gap-1 px-1.5 py-[2px] rounded-[6px] text-[10.5px] font-medium"
              style={{
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
              }}
            >
              <Pin className="w-2.5 h-2.5" />
              {zh ? '置顶' : 'Top'}
            </span>
          )}
          <button
            type="button"
            onClick={dismiss}
            title="Esc"
            className="w-6 h-6 rounded-full inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle)]"
            style={{ color: 'var(--text-4)' }}
            aria-label={t.close}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Airy Writing Canvas */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-2 space-y-2.5">
        {mode === 'note' ? (
          <>
            <RichTextEditor
              value={noteText}
              onChange={setNoteText}
              placeholder={zh ? '记录此刻的想法…' : 'Capture a thought…'}
              minHeight={106}
              maxHeight={160}
              onSubmit={() => void submitCapture()}
              onAddAttachment={addCurrentAttachment}
              editorRef={noteEditorRef}
              className="text-[15px]"
            />

            {(showTagInput || noteTags.trim().length > 0) && (
              <div className="flex items-center gap-1.5 pt-0.5">
                <Hash className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                <input
                  ref={tagInputRef}
                  type="text"
                  value={noteTags}
                  onChange={(e) => setNoteTags(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void submitCapture();
                    }
                  }}
                  placeholder={zh ? '输入标签，空格或逗号分隔…' : 'Tags separated by space or comma…'}
                  className="flex-1 bg-transparent border-0 outline-none text-[12.5px]"
                  style={{ color: 'var(--text-2)' }}
                />
              </div>
            )}
          </>
        ) : (
          <>
            {/* Unified Single-Box Task Editor (First line auto-derives display title) */}
            <div className="flex items-start gap-2.5 pt-1">
              <button
                type="button"
                onClick={cyclePrio}
                title={`P${taskPrio}`}
                className="w-[19px] h-[19px] mt-1 rounded-full inline-flex items-center justify-center shrink-0 transition-transform hover:scale-110"
                style={{
                  border: `1.8px solid ${PRIO_COLORS[taskPrio].color}`,
                  background: PRIO_COLORS[taskPrio].soft,
                }}
              >
                <span
                  className="w-[7px] h-[7px] rounded-full"
                  style={{ background: PRIO_COLORS[taskPrio].color }}
                />
              </button>
              <div className="flex-1 min-w-0">
                <RichTextEditor
                  value={taskContent}
                  onChange={setTaskContent}
                  placeholder={zh ? '写下待办内容，首行自动作为摘要，支持 [] 清单…' : 'Write task content (first line becomes summary), supports [] checklists…'}
                  minHeight={72}
                  maxHeight={135}
                  onSubmit={() => void submitCapture()}
                  onAddAttachment={addCurrentAttachment}
                  editorRef={taskEditorRef}
                  className="text-[15px]"
                />
              </div>
            </div>

            {/* Subtle Compact Schedule & Project Chips */}
            <div className="flex flex-wrap items-center gap-1.5 pl-7">
              <button
                type="button"
                onClick={() => setTaskDue(today)}
                className="px-2 py-0.5 rounded-[7px] text-[11.5px] font-medium ap-ease"
                style={{
                  background: taskDue === today ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                  color: taskDue === today ? 'var(--accent)' : 'var(--text-2)',
                }}
              >
                {t.scheduleToday}
              </button>
              <button
                type="button"
                onClick={() => setTaskDue(shiftDate(today, 1))}
                className="px-2 py-0.5 rounded-[7px] text-[11.5px] font-medium ap-ease"
                style={{
                  background:
                    taskDue === shiftDate(today, 1) ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                  color:
                    taskDue === shiftDate(today, 1) ? 'var(--accent)' : 'var(--text-2)',
                }}
              >
                {zh ? '明天' : 'Tomorrow'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTaskDue('');
                  setTaskStartTime('');
                }}
                className="px-2 py-0.5 rounded-[7px] text-[11.5px] font-medium ap-ease"
                style={{
                  background: !taskDue ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                  color: !taskDue ? 'var(--accent)' : 'var(--text-2)',
                }}
              >
                {zh ? '无日期' : 'No date'}
              </button>

              <label
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[7px] text-[11.5px]"
                style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
              >
                <Calendar className="w-3 h-3 opacity-70" />
                <input
                  type="date"
                  value={taskDue}
                  onChange={(e) => setTaskDue(e.target.value)}
                  className="bg-transparent border-0 outline-none text-[11.5px] w-[104px]"
                />
              </label>

              <label
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[7px] text-[11.5px]"
                style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
              >
                <Clock className="w-3 h-3 opacity-70" />
                <input
                  type="time"
                  value={taskStartTime}
                  onChange={(e) => {
                    setTaskStartTime(e.target.value);
                    if (e.target.value && !taskDue) setTaskDue(today);
                  }}
                  className="bg-transparent border-0 outline-none text-[11.5px] w-[66px]"
                />
              </label>

              {activeProjects.length > 0 && (
                <select
                  value={taskProjectId}
                  onChange={(e) => setTaskProjectId(e.target.value)}
                  className="px-2 py-0.5 rounded-[7px] text-[11.5px] border-0 outline-none max-w-[120px]"
                  style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
                >
                  <option value="">{t.noProject}</option>
                  {activeProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </>
        )}

        {/* Inline Attachment Chips (Only renders when non-empty!) */}
        {currentAttachments.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {currentAttachments.map((att) => (
              <span
                key={att.id}
                className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-full text-[11.5px] max-w-[200px]"
                style={{
                  background: 'var(--bg-subtle)',
                  color: 'var(--text-2)',
                  border: '1px solid var(--hairline-soft)',
                }}
              >
                {att.kind === 'link' ? (
                  <Link2 className="w-3 h-3 shrink-0" style={{ color: 'var(--accent)' }} />
                ) : att.kind === 'image' ? (
                  <ImageIcon className="w-3 h-3 shrink-0" style={{ color: 'var(--status-green)' }} />
                ) : (
                  <FileText className="w-3 h-3 shrink-0" style={{ color: 'var(--text-3)' }} />
                )}
                <span className="truncate">{att.name}</span>
                <button
                  type="button"
                  onClick={() => removeCurrentAttachment(att.id)}
                  className="w-4 h-4 rounded-full inline-flex items-center justify-center hover:bg-[var(--bg-subtle-hover)]"
                  style={{ color: 'var(--text-3)' }}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Optional Sleek Inline Link Input Bar */}
        {linkBarOpen && (
          <div
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-[9px]"
            style={{
              background: 'var(--bg-subtle)',
              border: '1px solid var(--hairline)',
            }}
          >
            <Link2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
            <input
              ref={linkInputRef}
              type="text"
              value={linkUrlDraft}
              onChange={(e) => setLinkUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddLink();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setLinkBarOpen(false);
                }
              }}
              placeholder="https://..."
              autoFocus
              className="flex-1 bg-transparent border-0 outline-none text-[12.5px]"
              style={{ color: 'var(--text-1)' }}
            />
            <button
              type="button"
              onClick={handleAddLink}
              className="text-[11.5px] font-medium px-2 py-0.5 rounded-[6px]"
              style={{ background: 'var(--accent)', color: '#ffffff' }}
            >
              {t.add}
            </button>
          </div>
        )}
      </div>

      {/* Single Unified Minimal Action Dock */}
      <div
        className="px-4 py-2.5 shrink-0 flex items-center justify-between gap-2 select-none"
        style={{
          borderTop: '1px solid var(--hairline-soft)',
          background: 'color-mix(in srgb, var(--bg-subtle) 35%, var(--bg-card))',
        }}
      >
        <div className="flex items-center gap-0.5">
          {mode === 'note' && (
            <button
              type="button"
              title={zh ? '添加标签' : 'Add tags'}
              onClick={() => {
                setShowTagInput(true);
                setTimeout(() => tagInputRef.current?.focus(), 20);
              }}
              className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle-hover)]"
              style={{
                color: showTagInput || noteTags ? 'var(--accent)' : 'var(--text-3)',
                background: showTagInput || noteTags ? 'var(--accent-soft)' : 'transparent',
              }}
            >
              <Hash className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            title={t.attAddLink}
            onClick={() => {
              setLinkBarOpen((v) => !v);
              setTimeout(() => linkInputRef.current?.focus(), 20);
            }}
            className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle-hover)]"
            style={{
              color: linkBarOpen ? 'var(--accent)' : 'var(--text-3)',
              background: linkBarOpen ? 'var(--accent-soft)' : 'transparent',
            }}
          >
            <Link2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            title={t.attAddImage}
            onClick={() => void handlePickFiles(true)}
            className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle-hover)]"
            style={{ color: 'var(--text-3)' }}
          >
            <ImageIcon className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            title={t.attAddFile}
            onClick={() => void handlePickFiles(false)}
            className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle-hover)]"
            style={{ color: 'var(--text-3)' }}
          >
            <Paperclip className="w-3.5 h-3.5" />
          </button>

          <span
            className="h-3.5 w-[1px] mx-1.5"
            style={{ background: 'var(--hairline)' }}
          />
          <span className="text-[11px]" style={{ color: 'var(--text-4)' }}>
            {(() => {
              const mod = /mac/i.test(navigator.platform || navigator.userAgent) ? '⌘↵' : 'Ctrl+↵';
              return zh ? `${mod} 存盘 · ↵ 换行` : `${mod} Save · ↵ Newline`;
            })()}
          </span>
        </div>

        <button
          type="button"
          disabled={saving || !canSubmit}
          onClick={() => void submitCapture()}
          className="ap-btn ap-btn-primary ap-btn-sm px-3.5 disabled:opacity-40"
        >
          <span>{mode === 'note' ? (zh ? '记录' : 'Save') : t.add}</span>
          <CornerDownLeft className="w-3 h-3 opacity-80" />
        </button>
      </div>
    </div>
  );

  if (standalone) {
    return (
      <div
        className="h-full w-full overflow-hidden"
        style={{ background: 'var(--bg-elevated)' }}
      >
        {cardBody}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] px-4"
      style={{ background: 'var(--backdrop-mask)', backdropFilter: 'blur(8px)' }}
      onClick={dismiss}
    >
      {cardBody}
    </div>
  );
}
