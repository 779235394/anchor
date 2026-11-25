import { create } from 'zustand';
import {
  createId,
  isActive,
  type AppConfig,
  type Attachment,
  type GitAuth,
  type GitStatus,
  type Lang,
  type Note,
  type Priority,
  type Project,
  type ProjectColor,
  type SnapshotInfo,
  type StorageMode,
  type Task,
  type TaskStatus,
  type ViewKey,
  type WorkspaceData,
} from '@/domain/types';
import { pickNextProjectColor } from '@/domain/projectColor';
import { shiftDate, todayStr } from '@/domain/date';
import {
  createEmptyWorkspace,
  mergeWorkspaces,
  normalizeTask,
  normalizeWorkspace,
  removeProjectFromWorkspace,
} from '@/domain/merge';
import { rolloverPersonalTasks } from '@/domain/rollover';
import { markdownToPlainText } from '@/domain/markdown';
import {
  defaultQuickCaptureShortcut,
  isTauriRuntime,
  storageApi,
} from '@/services/storage';
import {
  AUTO_UPDATE_INTERVAL_MS,
  checkForAppUpdate,
  downloadAndInstallPendingUpdate,
  INITIAL_UPDATE_STATE,
  relaunchApplication,
  shouldShowUpdatePrompt,
  type UpdateState,
} from '@/services/updater';

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error';
export type GitSyncState = 'idle' | 'syncing' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  message: string;
  tone: 'ok' | 'err' | 'info';
  action?: ToastAction;
}

export interface InspectorTarget {
  kind: 'task' | 'project';
  id: string;
}

interface WorkbenchState {
  ready: boolean;
  config: AppConfig;
  data: WorkspaceData;
  view: ViewKey;
  inspector: InspectorTarget | null;
  commandPaletteOpen: boolean;
  quickCapturePreviewOpen: boolean;
  taskProjectFilter: string;
  activeDocPath: string | null;
  syncStatus: SyncStatus;
  lastError: string | null;
  warnings: string[];
  snapshots: SnapshotInfo[];
  toasts: ToastItem[];

  // Git sync state
  gitStatus: GitStatus | null;
  gitSyncState: GitSyncState;
  gitLastError: string | null;

  // In-app updater state
  updateState: UpdateState;
  updateModalOpen: boolean;
  dismissedUpdateVersionInSession: string | null;
  lastUpdateCheckAt: number;

  // Lifecycle
  init: () => Promise<void>;
  handleExternalChange: () => Promise<void>;
  flushPendingWrites: () => Promise<void>;
  retryFailedWrites: () => Promise<void>;
  dismissWarning: (idx: number) => void;

  // Navigation & UI
  setView: (view: ViewKey) => void;
  openInspector: (target: InspectorTarget | null) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setQuickCapturePreviewOpen: (open: boolean) => void;
  openQuickCapture: () => Promise<void>;
  setTaskProjectFilter: (projectId: string) => void;
  setActiveDocPath: (relPath: string | null) => void;
  openDoc: (relPath: string) => void;
  togglePinDoc: (relPath: string) => Promise<void>;
  pushToast: (message: string, tone?: 'ok' | 'err' | 'info', action?: ToastAction) => void;
  dismissToast: (id: string) => void;

  // Config & Storage
  updateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  updateQuickCaptureShortcut: (
    shortcut: string,
    enabled: boolean,
  ) => Promise<{ ok: boolean; error?: string }>;
  switchDataDir: (targetDir: string, mode: 'use_existing' | 'copy_current') => Promise<void>;
  switchStorageMode: (mode: StorageMode, migration: 'none' | 'copy_current') => Promise<void>;
  refreshSnapshots: () => Promise<void>;
  restoreSnapshot: (dateKey: string) => Promise<void>;
  cleanupOrphanAttachments: () => Promise<void>;

  // Git Sync Actions
  refreshGitStatus: () => Promise<void>;
  bindGitRemote: (remoteUrl: string, branch: string) => Promise<void>;
  cloneGitRemote: (remoteUrl: string, targetDir: string, branch: string, auth: GitAuth) => Promise<void>;
  pullGitOnly: (silent?: boolean) => Promise<void>;
  syncGitNow: (silent?: boolean) => Promise<void>;

  // In-App Updater Actions
  checkForUpdates: (silent?: boolean) => Promise<void>;
  checkForUpdatesIfStale: () => Promise<void>;
  setUpdateModalOpen: (open: boolean) => void;
  snoozeUpdateModal: () => void;
  skipUpdateVersion: (version: string) => Promise<void>;
  clearIgnoredUpdateVersion: () => Promise<void>;
  downloadAndInstallUpdate: () => Promise<void>;
  relaunchToApplyUpdate: () => Promise<void>;

  // Tasks
  addTask: (input: {
    title: string;
    prio?: Priority;
    status?: TaskStatus;
    due?: string;
    startDate?: string;
    startTime?: string;
    endTime?: string;
    projectId?: string;
    note?: string;
    attachments?: Attachment[];
  }) => Task;
  updateTask: (
    id: string,
    patch: Partial<
      Pick<
        Task,
        | 'title'
        | 'note'
        | 'prio'
        | 'status'
        | 'due'
        | 'startDate'
        | 'startTime'
        | 'endTime'
        | 'order'
        | 'projectId'
        | 'attachments'
      >
    >,
  ) => void;
  moveTaskStatus: (id: string, status: TaskStatus, order?: number) => void;
  scheduleTask: (
    id: string,
    schedule: { startDate?: string; due: string; startTime?: string; endTime?: string },
  ) => void;
  toggleTask: (id: string) => void;
  postponeTask: (id: string) => void;
  postponeAllOverdue: () => number;
  deleteTask: (id: string) => void;

  // Notes
  addNote: (text: string, rawTags: string, attachments?: Attachment[]) => Note;
  updateNote: (id: string, text: string, rawTags: string, attachments?: Attachment[]) => void;
  deleteNote: (id: string) => void;
  convertNoteToTask: (id: string) => Task | null;

  // Attachments helper (ref-counted disk cleanup)
  addAttachment: (target: 'task' | 'note', entityId: string, att: Attachment) => void;
  removeAttachment: (target: 'task' | 'note', entityId: string, attachmentId: string) => void;

  // Projects
  addProject: (input: { name: string; color?: ProjectColor }) => Project;
  updateProject: (id: string, patch: Partial<Pick<Project, 'name' | 'color'>>) => void;
  deleteProject: (id: string, mode: 'keep' | 'deleteAll') => void;

  // Backup & Cleanup
  buildExportPayload: () => WorkspaceData;
  markExported: () => void;
  importBackup: (incoming: WorkspaceData, mode: 'merge' | 'replace') => void;
  wipeAllData: () => void;
}

const dirtyShards = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let autoPushTimer: ReturnType<typeof setTimeout> | null = null;
let unlistenExternal: (() => void) | null = null;
let unlistenQuickCapture: (() => void) | null = null;

function parseTags(raw: string): string[] {
  const parts = raw
    .split(/[,，;；\s]+/)
    .map((s) => s.replace(/^#/, '').trim())
    .filter(Boolean);
  return [...new Set(parts)].slice(0, 6);
}

function getShardPayload(data: WorkspaceData, shard: string): unknown {
  if (shard === 'meta') return data.meta;
  if (shard === 'tasks') return data.tasks;
  if (shard === 'projects') return data.projects;
  if (shard === 'notes') return data.notes;
  return null;
}

function allPersonalShards(): string[] {
  return ['meta', 'tasks', 'projects', 'notes'];
}

function syncTrayForData(data: WorkspaceData, lang: Lang): void {
  const t = todayStr();
  const active = data.tasks.filter((k) => isActive(k) && !k.done && k.status !== 'done');
  const openToday = active.filter((k) => !k.due || k.due <= t).length;
  const overdue = active.filter((k) => !!k.due && k.due < t).length;
  void storageApi.updateTrayBadge(openToday, overdue, lang);
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => {
  const scheduleAutoPushIfEnabled = () => {
    const { config, gitStatus } = get();
    if (!isTauriRuntime() || config.storageMode !== 'git' || !config.gitAutoPush) return;
    if (!gitStatus?.isRepo || !gitStatus.remoteUrl) return;
    if (autoPushTimer) clearTimeout(autoPushTimer);
    autoPushTimer = setTimeout(() => {
      autoPushTimer = null;
      void get().syncGitNow(true);
    }, 45_000);
  };

  const schedulePersist = (shards: string[]) => {
    for (const s of shards) dirtyShards.add(s);
    set({ syncStatus: 'saving' });
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      void get().flushPendingWrites();
    }, 400);
    scheduleAutoPushIfEnabled();
  };

  const applyRolloversIfNeeded = (
    base: WorkspaceData,
  ): { next: WorkspaceData; touchedShards: string[]; rolled: number } => {
    const t = todayStr();
    const pRes = rolloverPersonalTasks(base.tasks, base.meta, t);
    if (pRes.changed) {
      return {
        next: { ...base, tasks: pRes.tasks, meta: pRes.meta },
        touchedShards: ['meta', 'tasks'],
        rolled: pRes.rolledCount,
      };
    }
    return { next: base, touchedShards: [], rolled: 0 };
  };

  return {
    ready: false,
    config: {
      storageMode: 'local',
      localDataDir: '',
      gitDataDir: '',
      dataDir: '',
      theme: 'system',
      accent: 'blue',
      lang: 'zh',
      closeToTray: true,
      quickCaptureEnabled: true,
      quickCaptureShortcut: defaultQuickCaptureShortcut(),
      quickCaptureDefaultMode: 'last',
      gitRemoteUrl: '',
      gitBranch: 'main',
      gitAuthMode: 'system',
      gitUsername: '',
      gitToken: '',
      gitPullOnStart: false,
      gitAutoPush: false,
      gitLastSyncAt: null,
      ignoredUpdateVersion: '',
      pinnedDocs: [],
    },
    data: createEmptyWorkspace(todayStr()),
    view: 'tasks',
    inspector: null,
    commandPaletteOpen: false,
    quickCapturePreviewOpen: false,
    taskProjectFilter: '',
    activeDocPath: null,
    syncStatus: 'idle',
    lastError: null,
    warnings: [],
    snapshots: [],
    toasts: [],
    gitStatus: null,
    gitSyncState: 'idle',
    gitLastError: null,
    updateState: { ...INITIAL_UPDATE_STATE },
    updateModalOpen: false,
    dismissedUpdateVersionInSession: null,
    lastUpdateCheckAt: 0,

    pushToast: (message, tone = 'ok', action) => {
      const id = createId();
      set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone, action }] }));
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, action ? 5200 : 2600);
    },

    dismissToast: (id) => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },

    dismissWarning: (idx) => {
      set((s) => ({ warnings: s.warnings.filter((_, i) => i !== idx) }));
    },

    init: async () => {
      const [config, loaded, snapshots] = await Promise.all([
        storageApi.getAppConfig(),
        storageApi.loadWorkspace(),
        storageApi.listSnapshots(),
      ]);

      const gitMode = config.storageMode === 'git';
      const gitStatus = gitMode ? await storageApi.gitStatus() : null;

      let effectiveConfig = config;
      if (gitMode && gitStatus?.isRepo && gitStatus.remoteUrl && !config.gitRemoteUrl) {
        effectiveConfig = {
          ...config,
          gitRemoteUrl: gitStatus.remoteUrl,
          gitBranch: gitStatus.branch || config.gitBranch || 'main',
        };
      }

      const { next, touchedShards, rolled } = applyRolloversIfNeeded(loaded.data);

      set({
        ready: true,
        config: effectiveConfig,
        data: next,
        warnings: loaded.warnings,
        snapshots,
        gitStatus,
        syncStatus: 'saved',
      });

      syncTrayForData(next, effectiveConfig.lang);

      if (touchedShards.length > 0) {
        schedulePersist(touchedShards);
      }
      if (rolled > 0) {
        const msg =
          effectiveConfig.lang === 'zh'
            ? `昨日有 ${rolled} 件待办未完成，已自动带到今天`
            : `${rolled} unfinished task(s) carried into today`;
        get().pushToast(msg, 'info');
      }

      if (unlistenExternal) unlistenExternal();
      unlistenExternal = await storageApi.onExternalChange(() => {
        void get().handleExternalChange();
      });

      if (unlistenQuickCapture) unlistenQuickCapture();
      unlistenQuickCapture = await storageApi.onQuickCaptureSaved(() => {
        void get().handleExternalChange();
      });

      if (
        isTauriRuntime() &&
        gitMode &&
        effectiveConfig.gitPullOnStart &&
        gitStatus?.isRepo &&
        gitStatus.remoteUrl
      ) {
        void get().pullGitOnly(true);
      }

      if (isTauriRuntime()) {
        setTimeout(() => {
          void get().checkForUpdates(true);
        }, 3000);
      }
    },

    checkForUpdates: async (silent = false) => {
      const current = get().updateState;
      if (current.status === 'checking' || current.status === 'downloading') return;
      const zh = get().config.lang === 'zh';
      set({ lastUpdateCheckAt: Date.now() });
      if (!silent) {
        set({
          updateState: {
            ...current,
            status: 'checking',
            error: null,
          },
        });
      }
      try {
        const res = await checkForAppUpdate();
        if (res.available) {
          const shouldPop =
            silent &&
            shouldShowUpdatePrompt({
              available: true,
              version: res.version,
              ignoredVersion: get().config.ignoredUpdateVersion,
              snoozedVersion: get().dismissedUpdateVersionInSession,
            });
          set((s) => ({
            updateState: {
              ...INITIAL_UPDATE_STATE,
              status: 'available',
              version: res.version,
              body: res.body,
              date: res.date,
              fallbackUrl: res.fallbackUrl,
            },
            updateModalOpen: shouldPop ? true : s.updateModalOpen,
          }));
        } else if (!silent) {
          set({
            updateState: {
              ...INITIAL_UPDATE_STATE,
              status: 'up-to-date',
              version: res.version,
              fallbackUrl: res.fallbackUrl,
            },
          });
          get().pushToast(zh ? '当前已是最新版本' : 'You are up to date');
        }
      } catch (err) {
        if (silent) return;
        const msg = err instanceof Error ? err.message : String(err);
        set({
          updateState: {
            ...get().updateState,
            status: 'error',
            error: msg,
          },
        });
      }
    },

    checkForUpdatesIfStale: async () => {
      if (!isTauriRuntime() || !get().ready) return;
      const elapsed = Date.now() - get().lastUpdateCheckAt;
      if (elapsed >= AUTO_UPDATE_INTERVAL_MS) {
        await get().checkForUpdates(true);
      }
    },

    setUpdateModalOpen: (updateModalOpen) => set({ updateModalOpen }),

    snoozeUpdateModal: () => {
      const ver = get().updateState.version;
      set({
        updateModalOpen: false,
        dismissedUpdateVersionInSession: ver || get().dismissedUpdateVersionInSession,
      });
    },

    skipUpdateVersion: async (version) => {
      const clean = version.trim().replace(/^v/i, '');
      set({
        updateModalOpen: false,
        dismissedUpdateVersionInSession: clean || null,
      });
      if (clean) {
        await get().updateConfig({ ignoredUpdateVersion: clean });
      }
    },

    clearIgnoredUpdateVersion: async () => {
      set({ dismissedUpdateVersionInSession: null });
      await get().updateConfig({ ignoredUpdateVersion: '' });
    },

    downloadAndInstallUpdate: async () => {
      const st = get().updateState;
      if (st.status === 'downloading') return;
      const zh = get().config.lang === 'zh';

      await get().flushPendingWrites();

      set({
        updateState: {
          ...st,
          status: 'downloading',
          downloadedBytes: 0,
          totalBytes: null,
          percent: 0,
          error: null,
        },
      });

      try {
        await downloadAndInstallPendingUpdate((downloadedBytes, totalBytes, percent) => {
          set((s) => ({
            updateState: {
              ...s.updateState,
              status: 'downloading',
              downloadedBytes,
              totalBytes,
              percent,
            },
          }));
        });
        set((s) => ({
          updateState: {
            ...s.updateState,
            status: 'ready',
            percent: 100,
            error: null,
          },
        }));
        get().pushToast(
          zh ? '更新已安装就绪，点击重启即可生效' : 'Update installed — restart to apply',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set((s) => ({
          updateState: {
            ...s.updateState,
            status: 'error',
            error: msg,
          },
        }));
        get().pushToast(zh ? `下载更新失败：${msg}` : `Update failed: ${msg}`, 'err');
      }
    },

    relaunchToApplyUpdate: async () => {
      await get().flushPendingWrites();
      await relaunchApplication();
    },

    handleExternalChange: async () => {
      if (!get().ready) return;
      try {
        const loaded = await storageApi.loadWorkspace();
        const hasDirty = dirtyShards.size > 0;
        const nextData = hasDirty
          ? mergeWorkspaces(get().data, loaded.data)
          : loaded.data;

        set({ data: nextData });
        syncTrayForData(nextData, get().config.lang);
        if (isTauriRuntime() && get().config.storageMode === 'git') {
          void get().refreshGitStatus();
        }
        if (hasDirty) {
          void get().flushPendingWrites();
        }
      } catch (err) {
        console.error('External sync failed:', err);
      }
    },

    flushPendingWrites: async () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (dirtyShards.size === 0) return;

      const batch = [...dirtyShards];
      dirtyShards.clear();
      const snapshot = get().data;

      try {
        for (const shard of batch) {
          const payload = getShardPayload(snapshot, shard);
          await storageApi.saveShard(shard, payload, snapshot);
        }
        set({ syncStatus: 'saved', lastError: null });
        const gitMode = get().config.storageMode === 'git';
        const [snapshots, gitStatus] = await Promise.all([
          storageApi.listSnapshots(),
          gitMode ? storageApi.gitStatus() : Promise.resolve(null),
        ]);
        set({ snapshots, gitStatus });
      } catch (err) {
        for (const shard of batch) dirtyShards.add(shard);
        const msg = err instanceof Error ? err.message : String(err);
        set({ syncStatus: 'error', lastError: msg });
        get().pushToast(msg, 'err');
      }
    },

    retryFailedWrites: async () => {
      await get().flushPendingWrites();
    },

    setView: (view) => set({ view, inspector: null }),
    openInspector: (inspector) => set({ inspector }),
    setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
    setQuickCapturePreviewOpen: (quickCapturePreviewOpen) => set({ quickCapturePreviewOpen }),
    openQuickCapture: async () => {
      if (isTauriRuntime()) {
        await storageApi.toggleQuickCapture();
      } else {
        set({ quickCapturePreviewOpen: true });
      }
    },
    setTaskProjectFilter: (taskProjectFilter) => set({ taskProjectFilter }),
    setActiveDocPath: (activeDocPath) => set({ activeDocPath }),
    openDoc: (relPath) => set({ view: 'knowledge', inspector: null, activeDocPath: relPath }),
    togglePinDoc: async (relPath) => {
      const current = get().config.pinnedDocs ?? [];
      const next = current.includes(relPath)
        ? current.filter((p) => p !== relPath)
        : [relPath, ...current];
      await get().updateConfig({ pinnedDocs: next });
    },

    updateConfig: async (patch) => {
      const merged: AppConfig = { ...get().config, ...patch };
      set({ config: merged });
      if (patch.lang) {
        syncTrayForData(get().data, merged.lang);
      }
      try {
        const saved = await storageApi.saveAppConfig(merged);
        set({ config: saved });
      } catch (err) {
        get().pushToast(err instanceof Error ? err.message : String(err), 'err');
      }
    },

    updateQuickCaptureShortcut: async (shortcut, enabled) => {
      const zh = get().config.lang === 'zh';
      try {
        const saved = await storageApi.updateQuickCaptureShortcut(shortcut, enabled);
        set({ config: saved });
        get().pushToast(
          enabled
            ? zh
              ? `快捷呼出已生效（${saved.quickCaptureShortcut}）`
              : `Quick capture shortcut active (${saved.quickCaptureShortcut})`
            : zh
              ? '已暂停全局快捷呼出'
              : 'Global quick capture paused',
        );
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        get().pushToast(msg, 'err');
        return { ok: false, error: msg };
      }
    },

    switchDataDir: async (targetDir, mode) => {
      await get().flushPendingWrites();
      try {
        const loaded = await storageApi.switchDataDir(targetDir, mode);
        const config = await storageApi.getAppConfig();
        const gitMode = config.storageMode === 'git';
        const [snapshots, gitStatus] = await Promise.all([
          storageApi.listSnapshots(),
          gitMode ? storageApi.gitStatus() : Promise.resolve(null),
        ]);
        const { next, touchedShards } = applyRolloversIfNeeded(loaded.data);
        set({
          config,
          data: next,
          snapshots,
          gitStatus,
          warnings: loaded.warnings,
          inspector: null,
          syncStatus: 'saved',
        });
        syncTrayForData(next, config.lang);
        if (touchedShards.length) schedulePersist(touchedShards);
        get().pushToast(config.lang === 'zh' ? '已切换数据目录' : 'Data folder switched');
      } catch (err) {
        get().pushToast(err instanceof Error ? err.message : String(err), 'err');
      }
    },

    switchStorageMode: async (mode, migration) => {
      await get().flushPendingWrites();
      if (autoPushTimer) {
        clearTimeout(autoPushTimer);
        autoPushTimer = null;
      }
      const zh = get().config.lang === 'zh';
      try {
        const { config, workspace } = await storageApi.switchStorageMode(mode, migration);
        const gitMode = config.storageMode === 'git';
        const [snapshots, gitStatus] = await Promise.all([
          storageApi.listSnapshots(),
          gitMode ? storageApi.gitStatus() : Promise.resolve(null),
        ]);
        const { next, touchedShards } = applyRolloversIfNeeded(workspace.data);
        set({
          config,
          data: next,
          snapshots,
          gitStatus,
          gitSyncState: 'idle',
          gitLastError: null,
          warnings: workspace.warnings,
          inspector: null,
          taskProjectFilter: '',
          syncStatus: 'saved',
        });
        syncTrayForData(next, config.lang);
        if (touchedShards.length) schedulePersist(touchedShards);
        get().pushToast(
          gitMode
            ? zh
              ? '已切换至「Git 云端存储与同步」模式，本地目录已停用'
              : 'Switched to Git Cloud Sync (local storage inactive)'
            : zh
              ? '已切换至「本地明文存储」模式，Git 同步已停用'
              : 'Switched to Local Plain-Text Storage (Git sync disabled)',
        );
        if (isTauriRuntime() && gitMode && config.gitPullOnStart && gitStatus?.isRepo && gitStatus.remoteUrl) {
          void get().pullGitOnly(true);
        }
      } catch (err) {
        get().pushToast(err instanceof Error ? err.message : String(err), 'err');
      }
    },

    refreshSnapshots: async () => {
      const snapshots = await storageApi.listSnapshots();
      set({ snapshots });
    },

    restoreSnapshot: async (dateKey) => {
      await get().flushPendingWrites();
      try {
        const loaded = await storageApi.restoreSnapshot(dateKey);
        const snapshots = await storageApi.listSnapshots();
        set({ data: loaded.data, snapshots, inspector: null, warnings: loaded.warnings });
        syncTrayForData(loaded.data, get().config.lang);
        get().pushToast(
          get().config.lang === 'zh' ? `已恢复至 ${dateKey} 快照` : `Restored snapshot ${dateKey}`,
        );
      } catch (err) {
        get().pushToast(err instanceof Error ? err.message : String(err), 'err');
      }
    },

    cleanupOrphanAttachments: async () => {
      await get().flushPendingWrites();
      const zh = get().config.lang === 'zh';
      try {
        const res = await storageApi.cleanupOrphanAttachments();
        if (res.removedCount === 0) {
          get().pushToast(
            zh ? '附件目录很干净，没有孤儿文件' : 'Attachments folder is already clean',
            'info',
          );
        } else {
          const mb = (res.freedBytes / (1024 * 1024)).toFixed(2);
          get().pushToast(
            zh
              ? `已清理 ${res.removedCount} 个孤儿附件，释放 ${mb} MB`
              : `Removed ${res.removedCount} orphan file(s), freed ${mb} MB`,
          );
        }
        if (isTauriRuntime() && get().config.storageMode === 'git') void get().refreshGitStatus();
      } catch (err) {
        get().pushToast(err instanceof Error ? err.message : String(err), 'err');
      }
    },

    // ================= GIT SYNC =================
    refreshGitStatus: async () => {
      if (get().config.storageMode !== 'git') {
        set({ gitStatus: null, gitSyncState: 'idle', gitLastError: null });
        return;
      }
      const gitStatus = await storageApi.gitStatus();
      set({ gitStatus });
    },

    bindGitRemote: async (remoteUrl, branch) => {
      await get().flushPendingWrites();
      const zh = get().config.lang === 'zh';
      set({ gitSyncState: 'syncing', gitLastError: null });
      try {
        const st = await storageApi.gitInitBind(remoteUrl, branch);
        const config = await storageApi.getAppConfig();
        set({ config, gitStatus: st, gitSyncState: 'idle' });
        get().pushToast(
          zh ? '已绑定 Git 远程仓库，可点击「立即同步」' : 'Git remote bound — ready to sync',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ gitSyncState: 'error', gitLastError: msg });
        get().pushToast(msg, 'err');
      }
    },

    cloneGitRemote: async (remoteUrl, targetDir, branch, auth) => {
      await get().flushPendingWrites();
      const zh = get().config.lang === 'zh';
      set({ gitSyncState: 'syncing', gitLastError: null });
      try {
        const loaded = await storageApi.gitCloneIntoDir(remoteUrl, targetDir, branch, auth);
        const [config, snapshots, gitStatus] = await Promise.all([
          storageApi.getAppConfig(),
          storageApi.listSnapshots(),
          storageApi.gitStatus(),
        ]);
        const { next, touchedShards } = applyRolloversIfNeeded(loaded.data);
        set({
          config,
          data: next,
          snapshots,
          gitStatus,
          warnings: loaded.warnings,
          inspector: null,
          gitSyncState: 'idle',
          syncStatus: 'saved',
        });
        syncTrayForData(next, config.lang);
        if (touchedShards.length) schedulePersist(touchedShards);
        get().pushToast(
          zh ? '已从 Git 仓库克隆并切换数据目录' : 'Cloned Git repository and switched folder',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ gitSyncState: 'error', gitLastError: msg });
        get().pushToast(msg, 'err');
      }
    },

    pullGitOnly: async (silent = false) => {
      if (!isTauriRuntime() || get().config.storageMode !== 'git') return;
      await get().flushPendingWrites();
      set({ gitSyncState: 'syncing', gitLastError: null });
      const zh = get().config.lang === 'zh';
      try {
        const pull = await storageApi.gitPullPrepare();
        if (pull.outcome === 'semantic_merge' && pull.localBundle && pull.remoteBundle) {
          const merged = mergeWorkspaces(pull.localBundle.data, pull.remoteBundle.data);
          set({ data: merged });
          syncTrayForData(merged, get().config.lang);
          for (const shard of allPersonalShards()) {
            dirtyShards.add(shard);
          }
          await get().flushPendingWrites();
          if (!silent) {
            get().pushToast(
              zh ? '检测到多端分叉，已按记录自动无损合并' : 'Auto-merged diverged changes',
            );
          }
        } else if (pull.outcome === 'updated' && pull.remoteBundle) {
          set({ data: pull.remoteBundle.data });
          syncTrayForData(pull.remoteBundle.data, get().config.lang);
          if (!silent) {
            get().pushToast(zh ? '已拉取远端 Git 最新数据' : 'Pulled latest changes from Git');
          }
        }
        const gitStatus = await storageApi.gitStatus();
        set({ gitStatus, gitSyncState: 'idle' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ gitSyncState: 'error', gitLastError: msg });
        if (!silent) get().pushToast(msg, 'err');
      }
    },

    syncGitNow: async (silent = false) => {
      if (!isTauriRuntime() || get().config.storageMode !== 'git') return;
      if (get().gitSyncState === 'syncing') return;
      if (autoPushTimer) {
        clearTimeout(autoPushTimer);
        autoPushTimer = null;
      }

      await get().flushPendingWrites();
      set({ gitSyncState: 'syncing', gitLastError: null });
      const zh = get().config.lang === 'zh';

      try {
        let hadSemanticMerge = false;
        const pull = await storageApi.gitPullPrepare();

        if (pull.outcome === 'semantic_merge' && pull.localBundle && pull.remoteBundle) {
          hadSemanticMerge = true;
          const merged = mergeWorkspaces(pull.localBundle.data, pull.remoteBundle.data);
          set({ data: merged });
          syncTrayForData(merged, get().config.lang);
          for (const shard of allPersonalShards()) {
            dirtyShards.add(shard);
          }
          await get().flushPendingWrites();
        } else if (pull.outcome === 'updated' && pull.remoteBundle) {
          set({ data: pull.remoteBundle.data });
          syncTrayForData(pull.remoteBundle.data, get().config.lang);
        }

        const pushMsg = hadSemanticMerge
          ? 'sync(anchor): auto-merged multi-device changes'
          : undefined;
        const pushed = await storageApi.gitCommitAndPush(pushMsg);
        const config = await storageApi.getAppConfig();
        set({
          config,
          gitStatus: pushed.status,
          gitSyncState: 'idle',
          gitLastError: null,
        });

        if (!silent) {
          if (hadSemanticMerge) {
            get().pushToast(
              zh ? '已自动解决分叉并推送至 Git 仓库' : 'Auto-merged & synced to Git',
            );
          } else if (pushed.committed || pull.outcome === 'updated') {
            get().pushToast(zh ? 'Git 同步完成' : 'Git sync complete');
          } else {
            get().pushToast(zh ? '已是最新状态' : 'Already up to date', 'info');
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ gitSyncState: 'error', gitLastError: msg });
        if (!silent) get().pushToast(msg, 'err');
      }
    },

    // ================= TASKS =================
    addTask: ({
      title,
      prio = 2,
      status = 'todo',
      due = todayStr(),
      startDate = '',
      startTime = '',
      endTime = '',
      projectId = '',
      note = '',
      attachments = [],
    }) => {
      const now = Date.now();
      const raw: Task = {
        id: createId(),
        title: title.trim(),
        note: note.trim(),
        prio,
        status,
        due,
        startDate: startDate || undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        order: now,
        done: status === 'done',
        doneAt: status === 'done' ? now : null,
        projectId,
        rolls: 0,
        carriedDate: null,
        attachments,
        createdAt: now,
        updatedAt: now,
      };
      const prev = get().data;
      const activeProjIds = new Set(prev.projects.filter(isActive).map((p) => p.id));
      const task = normalizeTask(raw, activeProjIds);
      const projects = task.projectId
        ? prev.projects.map((p) => (p.id === task.projectId ? { ...p, updatedAt: now } : p))
        : prev.projects;
      const data: WorkspaceData = { ...prev, tasks: [task, ...prev.tasks], projects };
      set({ data });
      syncTrayForData(data, get().config.lang);
      schedulePersist(task.projectId ? ['tasks', 'projects'] : ['tasks']);
      return task;
    },

    updateTask: (id, patch) => {
      const now = Date.now();
      const prev = get().data;
      const activeProjIds = new Set(prev.projects.filter(isActive).map((p) => p.id));
      let touchedProjects = false;
      const affectedProjIds = new Set<string>();

      const tasks = prev.tasks.map((t) => {
        if (t.id !== id) return t;
        if (patch.projectId !== undefined && patch.projectId !== t.projectId) {
          touchedProjects = true;
          if (t.projectId) affectedProjIds.add(t.projectId);
          if (patch.projectId) affectedProjIds.add(patch.projectId);
        }
        const nextStatus: TaskStatus = patch.status ?? t.status ?? (t.done ? 'done' : 'todo');
        const nextDone = nextStatus === 'done';
        const merged: Task = {
          ...t,
          ...patch,
          status: nextStatus,
          done: nextDone,
          doneAt: nextDone ? (t.doneAt ?? now) : null,
          updatedAt: now,
        };
        return normalizeTask(merged, activeProjIds);
      });

      const projects = touchedProjects
        ? prev.projects.map((p) => (affectedProjIds.has(p.id) ? { ...p, updatedAt: now } : p))
        : prev.projects;

      const data: WorkspaceData = { ...prev, tasks, projects };
      set({ data });
      syncTrayForData(data, get().config.lang);
      schedulePersist(touchedProjects ? ['tasks', 'projects'] : ['tasks']);
    },

    moveTaskStatus: (id, status, order) => {
      const now = Date.now();
      const prev = get().data;
      let projToTouch = '';
      let becameDoneTitle = '';

      const tasks = prev.tasks.map((t) => {
        if (t.id !== id) return t;
        const done = status === 'done';
        if (done && !t.done) becameDoneTitle = t.title;
        if (t.projectId) projToTouch = t.projectId;
        return {
          ...t,
          status,
          done,
          doneAt: done ? (t.doneAt ?? now) : null,
          order: order !== undefined ? order : now,
          updatedAt: now,
        };
      });

      const projects = projToTouch
        ? prev.projects.map((p) => (p.id === projToTouch ? { ...p, updatedAt: now } : p))
        : prev.projects;

      const data: WorkspaceData = { ...prev, tasks, projects };
      set({ data });
      syncTrayForData(data, get().config.lang);
      schedulePersist(projToTouch ? ['tasks', 'projects'] : ['tasks']);

      if (becameDoneTitle) {
        const zh = get().config.lang === 'zh';
        get().pushToast(
          zh ? `已完成：${becameDoneTitle.slice(0, 18)}` : `Done: ${becameDoneTitle.slice(0, 22)}`,
        );
      }
    },

    scheduleTask: (id, schedule) => {
      get().updateTask(id, {
        startDate: schedule.startDate ?? '',
        due: schedule.due,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
      });
    },

    toggleTask: (id) => {
      const now = Date.now();
      const prev = get().data;
      let projToTouch = '';
      let completedTask: Task | null = null;

      const tasks = prev.tasks.map((t) => {
        if (t.id !== id) return t;
        const done = !t.done;
        const status: TaskStatus = done ? 'done' : 'todo';
        if (t.projectId) projToTouch = t.projectId;
        const next: Task = { ...t, status, done, doneAt: done ? now : null, updatedAt: now };
        if (done) completedTask = next;
        return next;
      });

      const projects = projToTouch
        ? prev.projects.map((p) => (p.id === projToTouch ? { ...p, updatedAt: now } : p))
        : prev.projects;

      const data: WorkspaceData = { ...prev, tasks, projects };
      set({ data });
      syncTrayForData(data, get().config.lang);
      schedulePersist(projToTouch ? ['tasks', 'projects'] : ['tasks']);

      if (completedTask) {
        const zh = get().config.lang === 'zh';
        const ct = completedTask as Task;
        get().pushToast(
          zh ? `已完成：${ct.title.slice(0, 18)}` : `Done: ${ct.title.slice(0, 22)}`,
        );
      }
    },

    postponeTask: (id) => {
      const now = Date.now();
      const tomorrow = shiftDate(todayStr(), 1);
      const prev = get().data;
      const tasks = prev.tasks.map((t) => {
        if (t.id !== id) return t;
        const nextStart = t.startDate && t.startDate > tomorrow ? '' : t.startDate;
        return {
          ...t,
          startDate: nextStart,
          due: tomorrow,
          rolls: (t.rolls || 0) + 1,
          carriedDate: null,
          updatedAt: now,
        };
      });
      const data: WorkspaceData = { ...prev, tasks };
      set({ data });
      syncTrayForData(data, get().config.lang);
      schedulePersist(['tasks']);
      get().pushToast(get().config.lang === 'zh' ? '已顺延到明天' : 'Postponed to tomorrow');
    },

    postponeAllOverdue: () => {
      const now = Date.now();
      const t = todayStr();
      const tomorrow = shiftDate(t, 1);
      const prev = get().data;
      let count = 0;
      const tasks = prev.tasks.map((k) => {
        if (!isActive(k) || k.done || k.status === 'done' || !k.due || k.due >= t) return k;
        count += 1;
        return {
          ...k,
          startDate: k.startDate && k.startDate > tomorrow ? '' : k.startDate,
          due: tomorrow,
          rolls: (k.rolls || 0) + 1,
          carriedDate: null,
          updatedAt: now,
        };
      });
      if (count === 0) return 0;
      const data: WorkspaceData = { ...prev, tasks };
      set({ data });
      syncTrayForData(data, get().config.lang);
      schedulePersist(['tasks']);
      get().pushToast(
        get().config.lang === 'zh'
          ? `${count} 条逾期任务已顺延到明天`
          : `${count} overdue task(s) postponed to tomorrow`,
      );
      return count;
    },

    deleteTask: (id) => {
      const now = Date.now();
      const prev = get().data;
      const tasks = prev.tasks.map((t) =>
        t.id === id ? { ...t, deletedAt: now, updatedAt: now } : t,
      );
      const data: WorkspaceData = { ...prev, tasks };
      set((s) => ({
        data,
        inspector: s.inspector?.kind === 'task' && s.inspector.id === id ? null : s.inspector,
      }));
      syncTrayForData(data, get().config.lang);
      schedulePersist(['tasks']);
      get().pushToast(get().config.lang === 'zh' ? '已删除任务' : 'Task deleted');
    },

    // ================= NOTES =================
    addNote: (text, rawTags, attachments = []) => {
      const now = Date.now();
      const note: Note = {
        id: createId(),
        text: text.trim(),
        tags: parseTags(rawTags),
        attachments,
        createdAt: now,
        updatedAt: now,
      };
      const prev = get().data;
      set({ data: { ...prev, notes: [note, ...prev.notes] } });
      schedulePersist(['notes']);
      get().pushToast(get().config.lang === 'zh' ? '已记下灵感' : 'Note saved');
      return note;
    },

    updateNote: (id, text, rawTags, attachments) => {
      const now = Date.now();
      const prev = get().data;
      const notes = prev.notes.map((n) =>
        n.id === id
          ? {
              ...n,
              text: text.trim(),
              tags: parseTags(rawTags),
              attachments: attachments ?? n.attachments,
              updatedAt: now,
            }
          : n,
      );
      set({ data: { ...prev, notes } });
      schedulePersist(['notes']);
      get().pushToast(get().config.lang === 'zh' ? '灵感已更新' : 'Note updated');
    },

    deleteNote: (id) => {
      const now = Date.now();
      const prev = get().data;
      const notes = prev.notes.map((n) =>
        n.id === id ? { ...n, deletedAt: now, updatedAt: now } : n,
      );
      set({ data: { ...prev, notes } });
      schedulePersist(['notes']);
      get().pushToast(get().config.lang === 'zh' ? '已删除灵感' : 'Note deleted');
    },

    convertNoteToTask: (id) => {
      const note = get().data.notes.find((n) => n.id === id && isActive(n));
      if (!note) return null;
      const plain = markdownToPlainText(note.text);
      const firstLine = plain.split(/\r?\n/)[0]?.trim() || plain.trim() || note.text.trim();
      const title = firstLine.slice(0, 140);
      const copiedAttachments: Attachment[] = (note.attachments || []).map((a) => ({
        ...a,
        id: createId(),
      }));
      const task = get().addTask({
        title,
        prio: 2,
        status: 'todo',
        due: todayStr(),
        note: note.text.trim() !== title ? note.text : '',
        attachments: copiedAttachments,
      });
      get().pushToast(get().config.lang === 'zh' ? '已转为今日待办' : 'Converted to today’s task');
      return task;
    },

    addAttachment: (target, entityId, att) => {
      const now = Date.now();
      const prev = get().data;
      if (target === 'task') {
        const tasks = prev.tasks.map((t) =>
          t.id === entityId
            ? { ...t, attachments: [...(t.attachments || []), att], updatedAt: now }
            : t,
        );
        set({ data: { ...prev, tasks } });
        schedulePersist(['tasks']);
      } else {
        const notes = prev.notes.map((n) =>
          n.id === entityId
            ? { ...n, attachments: [...(n.attachments || []), att], updatedAt: now }
            : n,
        );
        set({ data: { ...prev, notes } });
        schedulePersist(['notes']);
      }
    },

    removeAttachment: (target, entityId, attachmentId) => {
      const now = Date.now();
      const prev = get().data;
      let removedRelPath = '';

      const strip = <T extends { id: string; attachments?: Attachment[] }>(arr: T[]) =>
        arr.map((item) => {
          if (item.id !== entityId) return item;
          const hit = (item.attachments || []).find((a) => a.id === attachmentId);
          if (hit?.relPath) removedRelPath = hit.relPath;
          return {
            ...item,
            attachments: (item.attachments || []).filter((a) => a.id !== attachmentId),
            updatedAt: now,
          };
        });

      let next: WorkspaceData;
      if (target === 'task') {
        next = { ...prev, tasks: strip(prev.tasks) };
        set({ data: next });
        schedulePersist(['tasks']);
      } else {
        next = { ...prev, notes: strip(prev.notes) };
        set({ data: next });
        schedulePersist(['notes']);
      }

      if (removedRelPath) {
        const stillReferenced =
          next.tasks.some((t) => isActive(t) && t.attachments.some((a) => a.relPath === removedRelPath)) ||
          next.notes.some((n) => isActive(n) && n.attachments.some((x) => x.relPath === removedRelPath));
        if (!stillReferenced) {
          void storageApi.deleteAttachmentFile(removedRelPath);
        }
      }
    },

    // ================= PROJECTS =================
    addProject: ({ name, color }) => {
      const now = Date.now();
      const prev = get().data;
      const activeCount = prev.projects.filter(isActive).length;
      const project: Project = {
        id: createId(),
        name: name.trim(),
        color: color || pickNextProjectColor(activeCount),
        createdAt: now,
        updatedAt: now,
      };
      set({ data: { ...prev, projects: [...prev.projects, project] } });
      schedulePersist(['projects']);
      get().pushToast(get().config.lang === 'zh' ? '项目已创建' : 'Project created');
      return project;
    },

    updateProject: (id, patch) => {
      const now = Date.now();
      const prev = get().data;
      const projects = prev.projects.map((p) =>
        p.id === id ? { ...p, ...patch, updatedAt: now } : p,
      );
      set({ data: { ...prev, projects } });
      schedulePersist(['projects']);
    },

    deleteProject: (id, mode) => {
      const next = removeProjectFromWorkspace(get().data, id, mode);
      set((s) => ({
        data: next,
        taskProjectFilter: s.taskProjectFilter === id ? '' : s.taskProjectFilter,
        inspector: s.inspector?.kind === 'project' && s.inspector.id === id ? null : s.inspector,
      }));
      syncTrayForData(next, get().config.lang);
      schedulePersist(['projects', 'tasks']);
      get().pushToast(get().config.lang === 'zh' ? '项目已删除' : 'Project deleted');
    },

    // ================= BACKUP & CLEANUP =================
    buildExportPayload: () => get().data,

    markExported: () => {
      const prev = get().data;
      const next: WorkspaceData = {
        ...prev,
        meta: { ...prev.meta, lastExportAt: Date.now() },
      };
      set({ data: next });
      schedulePersist(['meta']);
    },

    importBackup: (incoming, mode) => {
      const normalized = normalizeWorkspace(incoming);
      const prev = get().data;
      const next = mode === 'replace' ? normalized : mergeWorkspaces(prev, normalized);
      set({ data: next, inspector: null });
      syncTrayForData(next, get().config.lang);
      schedulePersist(allPersonalShards());
      get().pushToast(get().config.lang === 'zh' ? '导入完成' : 'Import complete');
    },

    wipeAllData: () => {
      const empty = createEmptyWorkspace(todayStr());
      set({ data: empty, inspector: null, taskProjectFilter: '' });
      syncTrayForData(empty, get().config.lang);
      schedulePersist(allPersonalShards());
      get().pushToast(get().config.lang === 'zh' ? '已清空全部数据' : 'All data cleared');
    },
  };
});
