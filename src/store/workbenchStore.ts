import { create } from 'zustand';
import {
  createId,
  isActive,
  type AppConfig,
  type Assignment,
  type AssignmentStatus,
  type DailyItem,
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
import { storageApi } from '@/services/storage';

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error';

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
  showOnboarding: boolean;
  config: AppConfig;
  data: WorkspaceData;
  view: ViewKey;
  inspector: InspectorTarget | null;
  taskProjectFilter: string;
  syncStatus: SyncStatus;
  lastError: string | null;
  warnings: string[];
  snapshots: SnapshotInfo[];
  toasts: ToastItem[];

  // Lifecycle
  init: () => Promise<void>;
  handleExternalChange: () => Promise<void>;
  flushPendingWrites: () => Promise<void>;
  retryFailedWrites: () => Promise<void>;
  dismissWarning: (idx: number) => void;

  // Navigation & UI
  setView: (view: ViewKey) => void;
  openInspector: (target: InspectorTarget | null) => void;
  setTaskProjectFilter: (projectId: string) => void;
  pushToast: (message: string, tone?: 'ok' | 'err' | 'info') => void;

  // Config & Onboarding
  updateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  chooseOnboarding: (withSample: boolean) => Promise<void>;
  switchDataDir: (targetDir: string, mode: 'use_existing' | 'copy_current') => Promise<void>;
  refreshSnapshots: () => Promise<void>;
  restoreSnapshot: (dateKey: string) => Promise<void>;

  // Tasks
  addTask: (input: { title: string; prio?: Priority; due?: string; projectId?: string; note?: string }) => Task;
  updateTask: (id: string, patch: Partial<Pick<Task, 'title' | 'note' | 'prio' | 'due' | 'projectId'>>) => void;
  toggleTask: (id: string) => void;
  postponeTask: (id: string) => void;
  postponeAllOverdue: () => number;
  deleteTask: (id: string) => void;

  // Notes
  addNote: (text: string, rawTags: string) => Note;
  updateNote: (id: string, text: string, rawTags: string) => void;
  deleteNote: (id: string) => void;
  convertNoteToTask: (id: string) => Task | null;

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
  }) => Assignment;
  updateAssignment: (
    id: string,
    patch: Partial<Pick<Assignment, 'title' | 'desc' | 'ownerId' | 'projectId' | 'dueAt' | 'status'>>,
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

function syncTrayForData(data: WorkspaceData): void {
  const t = todayStr();
  const active = data.tasks.filter((k) => isActive(k) && !k.done);
  const openToday = active.filter((k) => !k.due || k.due <= t).length;
  const overdue = active.filter((k) => !!k.due && k.due < t).length;
  void storageApi.updateTrayBadge(openToday, overdue);
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => {
  const schedulePersist = (shards: string[]) => {
    for (const s of shards) dirtyShards.add(s);
    set({ syncStatus: 'saving' });
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      void get().flushPendingWrites();
    }, 400);
  };

  const applyRolloversIfNeeded = (base: WorkspaceData): { next: WorkspaceData; touchedShards: string[]; rolled: number } => {
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
    showOnboarding: false,
    config: {
      dataDir: '',
      theme: 'system',
      accent: 'blue',
      lang: 'zh',
      closeToTray: true,
    },
    data: createEmptyWorkspace(todayStr()),
    view: 'tasks',
    inspector: null,
    taskProjectFilter: '',
    syncStatus: 'idle',
    lastError: null,
    warnings: [],
    snapshots: [],
    toasts: [],

    pushToast: (message, tone = 'ok') => {
      const id = createId();
      set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone }] }));
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, 2400);
    },

    dismissWarning: (idx) => {
      set((s) => ({ warnings: s.warnings.filter((_, i) => i !== idx) }));
    },

    init: async () => {
      const config = await storageApi.getAppConfig();
      const loaded = await storageApi.loadWorkspace();
      const snapshots = await storageApi.listSnapshots();

      const { next, touchedShards, rolled } = applyRolloversIfNeeded(loaded.data);
      set({
        ready: true,
        config,
        data: next,
        showOnboarding: loaded.isNewWorkspace,
        warnings: loaded.warnings,
        snapshots,
        syncStatus: 'saved',
      });
      syncTrayForData(next);

      if (touchedShards.length > 0 && !loaded.isNewWorkspace) {
        schedulePersist(touchedShards);
      }
      if (rolled > 0) {
        const msg =
          config.lang === 'zh'
            ? `${rolled} 条逾期任务已结转到今天`
            : `${rolled} overdue task(s) carried to today`;
        get().pushToast(msg, 'info');
      }

      if (unlistenExternal) unlistenExternal();
      unlistenExternal = await storageApi.onExternalChange(() => {
        void get().handleExternalChange();
      });
    },

    handleExternalChange: async () => {
      try {
        const loaded = await storageApi.loadWorkspace();
        const state = get();
        if (state.showOnboarding && loaded.isNewWorkspace) return;

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
        syncTrayForData(nextData);
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
        const snapshots = await storageApi.listSnapshots();
        set({ syncStatus: 'saved', snapshots });
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
    setTaskProjectFilter: (taskProjectFilter) => set({ taskProjectFilter }),

    updateConfig: async (patch) => {
      const next = { ...get().config, ...patch };
      set({ config: next });
      await storageApi.saveAppConfig(next);
    },

    chooseOnboarding: async (withSample) => {
      const { config } = get();
      const data = withSample
        ? createSeedWorkspace(config.lang)
        : createEmptyWorkspace(todayStr());
      set({ data, showOnboarding: false });
      syncTrayForData(data);
      schedulePersist(allShardsFor(data));
      await get().flushPendingWrites();
    },

    switchDataDir: async (targetDir, mode) => {
      await get().flushPendingWrites();
      const res = await storageApi.switchDataDir(targetDir, mode);
      const config = await storageApi.getAppConfig();
      const snapshots = await storageApi.listSnapshots();
      set({
        config,
        data: res.data,
        warnings: res.warnings,
        snapshots,
        inspector: null,
        showOnboarding: false,
        syncStatus: 'saved',
      });
      syncTrayForData(res.data);
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
      syncTrayForData(res.data);
      get().pushToast(
        get().config.lang === 'zh'
          ? `已恢复至 ${dateKey} 快照`
          : `Restored snapshot ${dateKey}`,
      );
    },

    // ================= TASKS =================
    addTask: ({ title, prio = 2, due = todayStr(), projectId = '', note = '' }) => {
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
        createdAt: now,
        updatedAt: now,
      };
      const prev = get().data;
      const projects = projectId
        ? prev.projects.map((p) => (p.id === projectId ? { ...p, updatedAt: now } : p))
        : prev.projects;
      const data: WorkspaceData = { ...prev, tasks: [task, ...prev.tasks], projects };
      set({ data });
      syncTrayForData(data);
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
      syncTrayForData(data);
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
      syncTrayForData(data);
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
      syncTrayForData(data);
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
      syncTrayForData(data);
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
      syncTrayForData(data);
      schedulePersist(['tasks']);
      get().pushToast(get().config.lang === 'zh' ? '已删除任务' : 'Task deleted');
    },

    // ================= NOTES =================
    addNote: (text, rawTags) => {
      const now = Date.now();
      const note: Note = {
        id: createId(),
        text: text.trim(),
        tags: parseTags(rawTags),
        createdAt: now,
        updatedAt: now,
      };
      const prev = get().data;
      set({ data: { ...prev, notes: [note, ...prev.notes] } });
      schedulePersist(['notes']);
      get().pushToast(get().config.lang === 'zh' ? '已记下灵感' : 'Note saved');
      return note;
    },

    updateNote: (id, text, rawTags) => {
      const now = Date.now();
      const prev = get().data;
      const notes = prev.notes.map((n) =>
        n.id === id ? { ...n, text: text.trim(), tags: parseTags(rawTags), updatedAt: now } : n,
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
      const task = get().addTask({
        title,
        prio: 2,
        due: todayStr(),
        note: note.text.length > title.length ? note.text : '',
      });
      get().pushToast(get().config.lang === 'zh' ? '已转为今日待办' : 'Converted to today’s task');
      return task;
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
      syncTrayForData(next);
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
    addAssignment: ({ title, desc = '', ownerId, projectId = '', dueAt, status = 'todo' }) => {
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
        const doneAt =
          nextStatus === 'done' ? (a.doneAt ?? now) : null;
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
      set({ data: next, inspector: null, showOnboarding: false });
      syncTrayForData(next);
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
      syncTrayForData(next);
      schedulePersist(allShardsFor(next));
      get().pushToast(get().config.lang === 'zh' ? '示例数据已精确清空' : 'Sample data cleared');
    },

    loadSampleData: () => {
      const seed = createSeedWorkspace(get().config.lang);
      const next = mergeWorkspaces(get().data, seed);
      set({ data: next, showOnboarding: false });
      syncTrayForData(next);
      schedulePersist(allShardsFor(next));
      get().pushToast(get().config.lang === 'zh' ? '已载入示例数据' : 'Sample data loaded');
    },

    wipeAllData: () => {
      const prev = get().data;
      const empty = createEmptyWorkspace(todayStr());
      set({ data: empty, inspector: null, taskProjectFilter: '' });
      syncTrayForData(empty);
      schedulePersist([...new Set([...allShardsFor(prev), ...allShardsFor(empty)])]);
      get().pushToast(get().config.lang === 'zh' ? '已清空全部数据' : 'All data cleared');
    },
  };
});
