import { create } from 'zustand';
import {
  createId,
  isActive,
  type AppConfig,
  type Assignment,
  type AssignmentStatus,
  type Attachment,
  type DailyItem,
  type GitAuth,
  type GitStatus,
  type Lang,
  type Member,
  type Note,
  type Priority,
  type Project,
  type ProjectStatus,
  type SnapshotInfo,
  type Task,
  type ViewKey,
  type WorkspaceData,
} from '@/domain/types';
import { isoWeekKey, shiftDate, todayStr } from '@/domain/date';
import {
  createEmptyWorkspace,
  mergeWorkspaces,
  normalizeWorkspace,
  removeMemberFromWorkspace,
  removeProjectFromWorkspace,
} from '@/domain/merge';
import { rolloverPersonalTasks, rolloverTeamDaily } from '@/domain/rollover';
import { createSeedWorkspace } from '@/domain/seed';
import { isTauriRuntime, storageApi } from '@/services/storage';

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error';
export type GitSyncState = 'idle' | 'syncing' | 'error';

export interface ToastItem {
  id: string;
  message: string;
  tone: 'ok' | 'err' | 'info';
}

export interface InspectorTarget {
  kind: 'task' | 'project' | 'daily' | 'assignment' | 'member';
  id: string;
}

interface WorkbenchState {
  ready: boolean;
  config: AppConfig;
  data: WorkspaceData;
  view: ViewKey;
  inspector: InspectorTarget | null;
  commandPaletteOpen: boolean;
  taskProjectFilter: string;
  assignmentProjectPrefill: string;
  syncStatus: SyncStatus;
  lastError: string | null;
  warnings: string[];
  snapshots: SnapshotInfo[];
  toasts: ToastItem[];

  // Git sync state
  gitStatus: GitStatus | null;
  gitSyncState: GitSyncState;
  gitLastError: string | null;

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
  setTaskProjectFilter: (projectId: string) => void;
  setAssignmentProjectPrefill: (projectId: string) => void;
  pushToast: (message: string, tone?: 'ok' | 'err' | 'info') => void;

  // Config & Storage
  updateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  switchDataDir: (targetDir: string, mode: 'use_existing' | 'copy_current') => Promise<void>;
  refreshSnapshots: () => Promise<void>;
  restoreSnapshot: (dateKey: string) => Promise<void>;
  cleanupOrphanAttachments: () => Promise<void>;

  // Git Sync Actions
  refreshGitStatus: () => Promise<void>;
  bindGitRemote: (remoteUrl: string, branch: string) => Promise<void>;
  cloneGitRemote: (remoteUrl: string, targetDir: string, branch: string, auth: GitAuth) => Promise<void>;
  pullGitOnly: (silent?: boolean) => Promise<void>;
  syncGitNow: (silent?: boolean) => Promise<void>;

  // Tasks
  addTask: (input: {
    title: string;
    prio?: Priority;
    due?: string;
    projectId?: string;
    note?: string;
    attachments?: Attachment[];
  }) => Task;
  updateTask: (
    id: string,
    patch: Partial<Pick<Task, 'title' | 'note' | 'prio' | 'due' | 'projectId' | 'attachments'>>,
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
  addAttachment: (target: 'task' | 'assignment' | 'note', entityId: string, att: Attachment) => void;
  removeAttachment: (target: 'task' | 'assignment' | 'note', entityId: string, attachmentId: string) => void;

  // Projects
  addProject: (input: { name: string; status?: ProjectStatus; stage?: string; next?: string; blocker?: string }) => Project;
  updateProject: (id: string, patch: Partial<Pick<Project, 'name' | 'status' | 'stage' | 'next' | 'blocker'>>) => void;
  deleteProject: (id: string, mode: 'keep' | 'deleteAll') => void;

  // Daily
  addDaily: (title: string, ownerId: string, date?: string) => DailyItem;
  updateDaily: (id: string, patch: Partial<Pick<DailyItem, 'title' | 'ownerId'>>) => void;
  toggleDaily: (id: string) => void;
  deleteDaily: (id: string) => void;

  // Assignments
  addAssignment: (input: {
    title: string;
    desc?: string;
    ownerId: string;
    projectId?: string;
    dueAt: string;
    status?: AssignmentStatus;
    attachments?: Attachment[];
  }) => Assignment;
  updateAssignment: (
    id: string,
    patch: Partial<
      Pick<
        Assignment,
        'title' | 'desc' | 'ownerId' | 'projectId' | 'dueAt' | 'status' | 'attachments'
      >
    >,
  ) => void;
  deleteAssignment: (id: string) => void;

  // Members
  addMember: (input: { name: string; role: string; note?: string }) => Member | null;
  updateMember: (id: string, patch: Partial<Pick<Member, 'name' | 'role' | 'note'>>) => boolean;
  deleteMember: (id: string) => void;

  // Backup & Cleanup
  buildExportPayload: () => WorkspaceData;
  markExported: () => void;
  importBackup: (incoming: WorkspaceData, mode: 'merge' | 'replace') => void;
  clearSampleData: () => void;
  loadSampleData: () => void;
  wipeAllData: () => void;
}

const dirtyShards = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let autoPushTimer: ReturnType<typeof setTimeout> | null = null;
let unlistenExternal: (() => void) | null = null;

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
  if (shard === 'members') return data.members;
  if (shard === 'assignments') return data.assignments;
  if (shard.startsWith('daily:')) {
    const week = shard.slice('daily:'.length);
    return data.daily.filter((d) => isoWeekKey(d.date) === week);
  }
  return null;
}

function allShardsFor(data: WorkspaceData): string[] {
  const shards = new Set<string>(['meta', 'tasks', 'projects', 'notes', 'members', 'assignments']);
  for (const d of data.daily) {
    if (d.date) shards.add(`daily:${isoWeekKey(d.date)}`);
  }
  return [...shards];
}

function syncTrayForData(data: WorkspaceData, lang: Lang): void {
  const t = todayStr();
  const active = data.tasks.filter((k) => isActive(k) && !k.done);
  const openToday = active.filter((k) => !k.due || k.due <= t).length;
  const overdue = active.filter((k) => !!k.due && k.due < t).length;
  void storageApi.updateTrayBadge(openToday, overdue, lang);
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => {
  const scheduleAutoPushIfEnabled = () => {
    const { config, gitStatus } = get();
    if (!isTauriRuntime() || !config.gitAutoPush) return;
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
    const touched: string[] = [];
    let current = base;

    const pRes = rolloverPersonalTasks(current.tasks, current.meta, t);
    if (pRes.changed) {
      current = { ...current, tasks: pRes.tasks, meta: pRes.meta };
      touched.push('meta', 'tasks');
    }

    const dRes = rolloverTeamDaily(current.daily, t);
    if (dRes.changed) {
      current = { ...current, daily: dRes.daily };
      for (const dt of dRes.touchedDates) {
        touched.push(`daily:${isoWeekKey(dt)}`);
      }
    }

    return { next: current, touchedShards: touched, rolled: pRes.rolledCount };
  };

  return {
    ready: false,
    config: {
      dataDir: '',
      theme: 'system',
      accent: 'blue',
      lang: 'zh',
      closeToTray: true,
      gitRemoteUrl: '',
      gitBranch: 'main',
      gitAuthMode: 'system',
      gitUsername: '',
      gitToken: '',
      gitPullOnStart: false,
      gitAutoPush: false,
      gitLastSyncAt: null,
    },
    data: createEmptyWorkspace(todayStr()),
    view: 'tasks',
    inspector: null,
    commandPaletteOpen: false,
    taskProjectFilter: '',
    assignmentProjectPrefill: '',
    syncStatus: 'idle',
    lastError: null,
    warnings: [],
    snapshots: [],
    toasts: [],
    gitStatus: null,
    gitSyncState: 'idle',
    gitLastError: null,

    pushToast: (message, tone = 'ok') => {
      const id = createId();
      set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone }] }));
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, 2600);
    },

    dismissWarning: (idx) => {
      set((s) => ({ warnings: s.warnings.filter((_, i) => i !== idx) }));
    },

    init: async () => {
      const config = await storageApi.getAppConfig();
      const loaded = await storageApi.loadWorkspace();
      const snapshots = await storageApi.listSnapshots();
      const gitStatus = await storageApi.gitStatus();

      // Sync detected remote URL/branch into config display if folder is already a Git repo
      let effectiveConfig = config;
      if (gitStatus.isRepo && gitStatus.remoteUrl && !config.gitRemoteUrl) {
        effectiveConfig = {
          ...config,
          gitRemoteUrl: gitStatus.remoteUrl,
          gitBranch: gitStatus.branch || 'main',
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

      if (touchedShards.length > 0 && !loaded.isNewWorkspace) {
        schedulePersist(touchedShards);
      }
      if (rolled > 0) {
        const msg =
          effectiveConfig.lang === 'zh'
            ? `${rolled} 条逾期任务已结转到今天`
            : `${rolled} overdue task(s) carried to today`;
        get().pushToast(msg, 'info');
      }

      if (unlistenExternal) unlistenExternal();
      unlistenExternal = await storageApi.onExternalChange(() => {
        void get().handleExternalChange();
      });

      // Optional pull on startup if user opted in and Git remote is configured
      if (
        isTauriRuntime() &&
        effectiveConfig.gitPullOnStart &&
        gitStatus.isRepo &&
        gitStatus.remoteUrl
      ) {
        void get().pullGitOnly(true);
      }
    },

    handleExternalChange: async () => {
      try {
        const loaded = await storageApi.loadWorkspace();
        const state = get();

        const base =
          dirtyShards.size > 0
            ? mergeWorkspaces(state.data, loaded.data)
            : loaded.data;

        const { next: nextData, touchedShards } = applyRolloversIfNeeded(base);
        const changed = JSON.stringify(nextData) !== JSON.stringify(state.data);
        if (!changed && !loaded.warnings.length) return;

        set({
          data: nextData,
          warnings: loaded.warnings.length ? loaded.warnings : state.warnings,
          syncStatus: dirtyShards.size > 0 ? 'saving' : 'saved',
        });
        syncTrayForData(nextData, state.config.lang);
        if (touchedShards.length > 0) {
          schedulePersist(touchedShards);
        }
        if (changed && touchedShards.length === 0) {
          const msg =
            state.config.lang === 'zh'
              ? '已同步外部数据更新'
              : 'Synced external folder changes';
          get().pushToast(msg, 'info');
        }
      } catch {
        // ignore transient read race while external sync finishes
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
      const { data } = get();
      set({ syncStatus: 'saving', lastError: null });

      try {
        for (const shard of batch) {
          const payload = getShardPayload(data, shard);
          await storageApi.saveShard(shard, payload, data);
        }
        const [snapshots, gitStatus] = await Promise.all([
          storageApi.listSnapshots(),
          storageApi.gitStatus(),
        ]);
        set({ syncStatus: 'saved', snapshots, gitStatus });
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
    setTaskProjectFilter: (taskProjectFilter) => set({ taskProjectFilter }),
    setAssignmentProjectPrefill: (assignmentProjectPrefill) => set({ assignmentProjectPrefill }),

    updateConfig: async (patch) => {
      const prev = get().config;
      const next = { ...prev, ...patch };
      set({ config: next });
      await storageApi.saveAppConfig(next);
      if (patch.lang && patch.lang !== prev.lang) {
        syncTrayForData(get().data, next.lang);
      }
      if (patch.gitAutoPush === false && autoPushTimer) {
        clearTimeout(autoPushTimer);
        autoPushTimer = null;
      }
    },

    switchDataDir: async (targetDir, mode) => {
      await get().flushPendingWrites();
      const res = await storageApi.switchDataDir(targetDir, mode);
      const [config, snapshots, gitStatus] = await Promise.all([
        storageApi.getAppConfig(),
        storageApi.listSnapshots(),
        storageApi.gitStatus(),
      ]);
      set({
        config,
        data: res.data,
        warnings: res.warnings,
        snapshots,
        gitStatus,
        inspector: null,
        syncStatus: 'saved',
      });
      syncTrayForData(res.data, config.lang);
      get().pushToast(
        config.lang === 'zh' ? '已切换本地数据目录' : 'Switched local data folder',
      );
    },

    refreshSnapshots: async () => {
      const snapshots = await storageApi.listSnapshots();
      set({ snapshots });
    },

    restoreSnapshot: async (dateKey) => {
      await get().flushPendingWrites();
      const res = await storageApi.restoreSnapshot(dateKey);
      const snapshots = await storageApi.listSnapshots();
      set({
        data: res.data,
        warnings: res.warnings,
        snapshots,
        inspector: null,
        syncStatus: 'saved',
      });
      syncTrayForData(res.data, get().config.lang);
      get().pushToast(
        get().config.lang === 'zh'
          ? `已恢复至 ${dateKey} 快照`
          : `Restored snapshot ${dateKey}`,
      );
    },

    cleanupOrphanAttachments: async () => {
      await get().flushPendingWrites();
      try {
        const res = await storageApi.cleanupOrphanAttachments();
        const zh = get().config.lang === 'zh';
        if (res.removedCount === 0) {
          get().pushToast(zh ? '没有发现未引用的孤儿附件' : 'No unreferenced attachments found', 'info');
        } else {
          const mb = (res.freedBytes / (1024 * 1024)).toFixed(2);
          get().pushToast(
            zh
              ? `已清理 ${res.removedCount} 个孤儿附件，释放 ${mb} MB`
              : `Removed ${res.removedCount} orphan attachment(s), freed ${mb} MB`,
          );
        }
        await get().refreshGitStatus();
      } catch (err) {
        get().pushToast(err instanceof Error ? err.message : String(err), 'err');
      }
    },

    // ================= GIT SYNC =================
    refreshGitStatus: async () => {
      const gitStatus = await storageApi.gitStatus();
      set({ gitStatus });
    },

    bindGitRemote: async (remoteUrl, branch) => {
      await get().flushPendingWrites();
      try {
        const st = await storageApi.gitInitBind(remoteUrl, branch);
        const config = await storageApi.getAppConfig();
        set({ gitStatus: st, config, gitLastError: null });
        get().pushToast(
          config.lang === 'zh' ? '已绑定 Git 远程仓库' : 'Bound Git remote repository',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ gitLastError: msg });
        get().pushToast(msg, 'err');
      }
    },

    cloneGitRemote: async (remoteUrl, targetDir, branch, auth) => {
      await get().flushPendingWrites();
      set({ gitSyncState: 'syncing', gitLastError: null });
      try {
        const loaded = await storageApi.gitCloneIntoDir(remoteUrl, targetDir, branch, auth);
        const [config, snapshots, gitStatus] = await Promise.all([
          storageApi.getAppConfig(),
          storageApi.listSnapshots(),
          storageApi.gitStatus(),
        ]);
        set({
          config,
          data: loaded.data,
          warnings: loaded.warnings,
          snapshots,
          gitStatus,
          gitSyncState: 'idle',
          inspector: null,
          syncStatus: 'saved',
        });
        syncTrayForData(loaded.data, config.lang);
        get().pushToast(
          config.lang === 'zh' ? '已从 Git 仓库克隆并加载数据' : 'Cloned and loaded Git workspace',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ gitSyncState: 'error', gitLastError: msg });
        get().pushToast(msg, 'err');
      }
    },

    pullGitOnly: async (silent = false) => {
      if (!isTauriRuntime()) return;
      if (get().gitSyncState === 'syncing') return;
      await get().flushPendingWrites();
      set({ gitSyncState: 'syncing', gitLastError: null });
      const zh = get().config.lang === 'zh';

      try {
        const pull = await storageApi.gitPullPrepare();
        if (pull.outcome === 'semantic_merge' && pull.localBundle && pull.remoteBundle) {
          const merged = mergeWorkspaces(pull.localBundle.data, pull.remoteBundle.data);
          set({ data: merged });
          syncTrayForData(merged, get().config.lang);
          for (const shard of allShardsFor(merged)) {
            dirtyShards.add(shard);
          }
          await get().flushPendingWrites();
          const st = await storageApi.gitStatus();
          set({ gitStatus: st, gitSyncState: 'idle' });
          if (!silent) {
            get().pushToast(
              zh ? '已拉取远端并自动无损合并多端修改' : 'Pulled & auto-merged multi-device changes',
              'info',
            );
          }
          return;
        }
        if (pull.outcome === 'updated' && pull.remoteBundle) {
          set({ data: pull.remoteBundle.data });
          syncTrayForData(pull.remoteBundle.data, get().config.lang);
          if (!silent) {
            get().pushToast(zh ? '已拉取 Git 远端最新数据' : 'Pulled latest changes from Git');
          }
        }
        const st = await storageApi.gitStatus();
        set({ gitStatus: st, gitSyncState: 'idle' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ gitSyncState: 'error', gitLastError: msg });
        if (!silent) get().pushToast(msg, 'err');
      }
    },

    syncGitNow: async (silent = false) => {
      if (!isTauriRuntime()) return;
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
          for (const shard of allShardsFor(merged)) {
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
    addTask: ({ title, prio = 2, due = todayStr(), projectId = '', note = '', attachments = [] }) => {
      const now = Date.now();
      const task: Task = {
        id: createId(),
        title: title.trim(),
        note: note.trim(),
        prio,
        due,
        done: false,
        doneAt: null,
        projectId,
        rolls: 0,
        carriedDate: null,
        attachments,
        createdAt: now,
        updatedAt: now,
      };
      const prev = get().data;
      const projects = projectId
        ? prev.projects.map((p) => (p.id === projectId ? { ...p, updatedAt: now } : p))
        : prev.projects;
      const data: WorkspaceData = { ...prev, tasks: [task, ...prev.tasks], projects };
      set({ data });
      syncTrayForData(data, get().config.lang);
      schedulePersist(projectId ? ['tasks', 'projects'] : ['tasks']);
      return task;
    },

    updateTask: (id, patch) => {
      const now = Date.now();
      const prev = get().data;
      let touchedProjects = false;
      const affectedProjIds = new Set<string>();

      const tasks = prev.tasks.map((t) => {
        if (t.id !== id) return t;
        if (patch.projectId !== undefined && patch.projectId !== t.projectId) {
          touchedProjects = true;
          if (t.projectId) affectedProjIds.add(t.projectId);
          if (patch.projectId) affectedProjIds.add(patch.projectId);
        }
        return { ...t, ...patch, updatedAt: now };
      });

      const projects = touchedProjects
        ? prev.projects.map((p) => (affectedProjIds.has(p.id) ? { ...p, updatedAt: now } : p))
        : prev.projects;

      const data: WorkspaceData = { ...prev, tasks, projects };
      set({ data });
      syncTrayForData(data, get().config.lang);
      schedulePersist(touchedProjects ? ['tasks', 'projects'] : ['tasks']);
    },

    toggleTask: (id) => {
      const now = Date.now();
      const prev = get().data;
      let projToTouch = '';
      let completedTask: Task | null = null;

      const tasks = prev.tasks.map((t) => {
        if (t.id !== id) return t;
        const done = !t.done;
        if (t.projectId) projToTouch = t.projectId;
        const next: Task = { ...t, done, doneAt: done ? now : null, updatedAt: now };
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
      const tasks = prev.tasks.map((t) =>
        t.id === id
          ? { ...t, due: tomorrow, rolls: (t.rolls || 0) + 1, carriedDate: null, updatedAt: now }
          : t,
      );
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
        if (!isActive(k) || k.done || !k.due || k.due >= t) return k;
        count += 1;
        return {
          ...k,
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
      const firstLine = note.text.split(/\r?\n/)[0]?.trim() || note.text.trim();
      const title = firstLine.slice(0, 140);
      const copiedAttachments: Attachment[] = (note.attachments || []).map((a) => ({
        ...a,
        id: createId(),
      }));
      const task = get().addTask({
        title,
        prio: 2,
        due: todayStr(),
        note: note.text.length > title.length ? note.text : '',
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
      } else if (target === 'assignment') {
        const assignments = prev.assignments.map((a) =>
          a.id === entityId
            ? { ...a, attachments: [...(a.attachments || []), att], updatedAt: now }
            : a,
        );
        set({ data: { ...prev, assignments } });
        schedulePersist(['assignments']);
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
      } else if (target === 'assignment') {
        next = { ...prev, assignments: strip(prev.assignments) };
        set({ data: next });
        schedulePersist(['assignments']);
      } else {
        next = { ...prev, notes: strip(prev.notes) };
        set({ data: next });
        schedulePersist(['notes']);
      }

      if (removedRelPath) {
        const stillReferenced =
          next.tasks.some((t) => isActive(t) && t.attachments.some((a) => a.relPath === removedRelPath)) ||
          next.assignments.some((a) => isActive(a) && a.attachments.some((x) => x.relPath === removedRelPath)) ||
          next.notes.some((n) => isActive(n) && n.attachments.some((x) => x.relPath === removedRelPath));
        if (!stillReferenced) {
          void storageApi.deleteAttachmentFile(removedRelPath);
        }
      }
    },

    // ================= PROJECTS =================
    addProject: ({ name, status = 'active', stage = '', next = '', blocker = '' }) => {
      const now = Date.now();
      const project: Project = {
        id: createId(),
        name: name.trim(),
        status,
        stage: stage.trim(),
        next: next.trim(),
        blocker: blocker.trim(),
        createdAt: now,
        updatedAt: now,
      };
      const prev = get().data;
      set({ data: { ...prev, projects: [project, ...prev.projects] } });
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
      schedulePersist(['projects', 'tasks', 'assignments']);
      get().pushToast(get().config.lang === 'zh' ? '项目已删除' : 'Project deleted');
    },

    // ================= TEAM DAILY =================
    addDaily: (title, ownerId, date = todayStr()) => {
      const now = Date.now();
      const item: DailyItem = {
        id: createId(),
        date,
        title: title.trim(),
        ownerId,
        done: false,
        doneAt: null,
        carriedFromId: null,
        carriedToDate: null,
        carryCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      const prev = get().data;
      set({ data: { ...prev, daily: [...prev.daily, item] } });
      schedulePersist([`daily:${isoWeekKey(date)}`]);
      return item;
    },

    updateDaily: (id, patch) => {
      const now = Date.now();
      const prev = get().data;
      let weekShard = '';
      const daily = prev.daily.map((d) => {
        if (d.id !== id) return d;
        weekShard = `daily:${isoWeekKey(d.date)}`;
        return { ...d, ...patch, updatedAt: now };
      });
      set({ data: { ...prev, daily } });
      if (weekShard) schedulePersist([weekShard]);
    },

    toggleDaily: (id) => {
      const now = Date.now();
      const prev = get().data;
      let weekShard = '';
      const daily = prev.daily.map((d) => {
        if (d.id !== id) return d;
        weekShard = `daily:${isoWeekKey(d.date)}`;
        const done = !d.done;
        return { ...d, done, doneAt: done ? now : null, updatedAt: now };
      });
      set({ data: { ...prev, daily } });
      if (weekShard) schedulePersist([weekShard]);
    },

    deleteDaily: (id) => {
      const now = Date.now();
      const prev = get().data;
      let weekShard = '';
      const daily = prev.daily.map((d) => {
        if (d.id !== id) return d;
        weekShard = `daily:${isoWeekKey(d.date)}`;
        return { ...d, deletedAt: now, updatedAt: now };
      });
      set((s) => ({
        data: { ...prev, daily },
        inspector: s.inspector?.kind === 'daily' && s.inspector.id === id ? null : s.inspector,
      }));
      if (weekShard) schedulePersist([weekShard]);
      get().pushToast(get().config.lang === 'zh' ? '已删除事项' : 'Daily item deleted');
    },

    // ================= ASSIGNMENTS =================
    addAssignment: ({
      title,
      desc = '',
      ownerId,
      projectId = '',
      dueAt,
      status = 'todo',
      attachments = [],
    }) => {
      const now = Date.now();
      const item: Assignment = {
        id: createId(),
        title: title.trim(),
        desc: desc.trim(),
        ownerId,
        projectId,
        dueAt,
        status,
        doneAt: status === 'done' ? now : null,
        attachments,
        createdAt: now,
        updatedAt: now,
      };
      const prev = get().data;
      set({ data: { ...prev, assignments: [item, ...prev.assignments] } });
      schedulePersist(['assignments']);
      get().pushToast(get().config.lang === 'zh' ? '任务分配已创建' : 'Assignment created');
      return item;
    },

    updateAssignment: (id, patch) => {
      const now = Date.now();
      const prev = get().data;
      const assignments = prev.assignments.map((a) => {
        if (a.id !== id) return a;
        const nextStatus = patch.status ?? a.status;
        const doneAt = nextStatus === 'done' ? (a.doneAt ?? now) : null;
        return { ...a, ...patch, status: nextStatus, doneAt, updatedAt: now };
      });
      set({ data: { ...prev, assignments } });
      schedulePersist(['assignments']);
    },

    deleteAssignment: (id) => {
      const now = Date.now();
      const prev = get().data;
      const assignments = prev.assignments.map((a) =>
        a.id === id ? { ...a, deletedAt: now, updatedAt: now } : a,
      );
      set((s) => ({
        data: { ...prev, assignments },
        inspector:
          s.inspector?.kind === 'assignment' && s.inspector.id === id ? null : s.inspector,
      }));
      schedulePersist(['assignments']);
      get().pushToast(get().config.lang === 'zh' ? '已删除分配任务' : 'Assignment deleted');
    },

    // ================= MEMBERS =================
    addMember: ({ name, role, note = '' }) => {
      const cleanName = name.trim();
      if (!cleanName) return null;
      const prev = get().data;
      if (prev.members.some((m) => isActive(m) && m.name === cleanName)) {
        get().pushToast(
          get().config.lang === 'zh'
            ? `已有同名成员「${cleanName}」`
            : `Member "${cleanName}" already exists`,
          'err',
        );
        return null;
      }
      const now = Date.now();
      const member: Member = {
        id: createId(),
        name: cleanName,
        role: role.trim() || '前端开发',
        note: note.trim(),
        createdAt: now,
        updatedAt: now,
      };
      set({ data: { ...prev, members: [...prev.members, member] } });
      schedulePersist(['members']);
      get().pushToast(get().config.lang === 'zh' ? '成员已添加' : 'Member added');
      return member;
    },

    updateMember: (id, patch) => {
      const prev = get().data;
      if (patch.name !== undefined) {
        const clean = patch.name.trim();
        if (!clean) return false;
        if (prev.members.some((m) => isActive(m) && m.id !== id && m.name === clean)) {
          get().pushToast(
            get().config.lang === 'zh'
              ? `已有同名成员「${clean}」`
              : `Member "${clean}" already exists`,
            'err',
          );
          return false;
        }
      }
      const now = Date.now();
      const members = prev.members.map((m) =>
        m.id === id
          ? {
              ...m,
              ...patch,
              name: patch.name !== undefined ? patch.name.trim() : m.name,
              role: patch.role !== undefined ? patch.role.trim() || m.role : m.role,
              updatedAt: now,
            }
          : m,
      );
      set({ data: { ...prev, members } });
      schedulePersist(['members']);
      return true;
    },

    deleteMember: (id) => {
      const prev = get().data;
      const affectedWeeks = new Set(
        prev.daily.filter((d) => d.ownerId === id && isActive(d)).map((d) => `daily:${isoWeekKey(d.date)}`),
      );
      const next = removeMemberFromWorkspace(prev, id);
      set((s) => ({
        data: next,
        inspector: s.inspector?.kind === 'member' && s.inspector.id === id ? null : s.inspector,
      }));
      schedulePersist(['members', 'assignments', ...affectedWeeks]);
      get().pushToast(get().config.lang === 'zh' ? '成员已删除（关联记录已保留）' : 'Member removed');
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
      schedulePersist([...new Set([...allShardsFor(prev), ...allShardsFor(next)])]);
      get().pushToast(get().config.lang === 'zh' ? '导入完成' : 'Import complete');
    },

    clearSampleData: () => {
      const now = Date.now();
      const prev = get().data;
      const mark = <T extends { _sample?: boolean; deletedAt?: number | null; updatedAt: number }>(
        arr: T[],
      ) =>
        arr.map((x) => (x._sample && !x.deletedAt ? { ...x, deletedAt: now, updatedAt: now } : x));
      const next = normalizeWorkspace({
        ...prev,
        meta: { ...prev.meta, hasSample: false },
        tasks: mark(prev.tasks),
        projects: mark(prev.projects),
        notes: mark(prev.notes),
        members: mark(prev.members),
        assignments: mark(prev.assignments),
        daily: mark(prev.daily),
      });
      set({ data: next, inspector: null });
      syncTrayForData(next, get().config.lang);
      schedulePersist(allShardsFor(next));
      get().pushToast(get().config.lang === 'zh' ? '示例数据已精确清空' : 'Sample data cleared');
    },

    loadSampleData: () => {
      const seed = createSeedWorkspace(get().config.lang);
      const next = mergeWorkspaces(get().data, seed);
      set({ data: next });
      syncTrayForData(next, get().config.lang);
      schedulePersist(allShardsFor(next));
      get().pushToast(get().config.lang === 'zh' ? '已载入示例数据' : 'Sample data loaded');
    },

    wipeAllData: () => {
      const prev = get().data;
      const empty = createEmptyWorkspace(todayStr());
      set({ data: empty, inspector: null, taskProjectFilter: '' });
      syncTrayForData(empty, get().config.lang);
      schedulePersist([...new Set([...allShardsFor(prev), ...allShardsFor(empty)])]);
      get().pushToast(get().config.lang === 'zh' ? '已清空全部数据' : 'All data cleared');
    },
  };
});
