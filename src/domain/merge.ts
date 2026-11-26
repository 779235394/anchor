import {
  isActive,
  TASK_STATUS_ORDER,
  TOMBSTONE_TTL_MS,
  type Attachment,
  type BaseEntity,
  type Meta,
  type Note,
  type Project,
  type StickyNote,
  type Task,
  type TaskStatus,
  type WorkspaceData,
} from './types';
import { todayStr } from './date';
import { resolveProjectColor } from './projectColor';
import { normalizeSticky } from './stickies';

export function createEmptyWorkspace(today: string = todayStr()): WorkspaceData {
  return {
    meta: {
      schemaVersion: 1,
      lastOpenDate: today,
      hasSample: false,
      lastExportAt: null,
    },
    tasks: [],
    projects: [],
    notes: [],
    stickies: [],
  };
}

/**
 * Record-level Last-Write-Wins merge by `id` + `updatedAt`.
 * Preserves soft-delete tombstones (`deletedAt`) for 30 days so deletions on one
 * machine don't resurrect when synced via OneDrive / Nutstore / Git.
 */
export function mergeEntityArrays<T extends BaseEntity>(
  localItems: T[],
  remoteItems: T[],
  nowTs: number = Date.now(),
): T[] {
  const byId = new Map<string, T>();

  for (const item of remoteItems) {
    if (item && item.id) {
      byId.set(item.id, item);
    }
  }

  for (const item of localItems) {
    if (!item || !item.id) continue;
    const existing = byId.get(item.id);
    if (!existing || (item.updatedAt || 0) >= (existing.updatedAt || 0)) {
      byId.set(item.id, item);
    }
  }

  return pruneExpiredTombstones([...byId.values()], nowTs);
}

export function pruneExpiredTombstones<T extends BaseEntity>(
  items: T[],
  nowTs: number = Date.now(),
): T[] {
  return items.filter((item) => {
    if (!item.deletedAt) return true;
    return nowTs - item.deletedAt < TOMBSTONE_TTL_MS;
  });
}

function normalizeDocOrder(raw: unknown): Record<string, string[]> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string[]> = {};
  let hasEntries = false;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(val)) continue;
    const seen = new Set<string>();
    const clean: string[] = [];
    for (const item of val) {
      if (typeof item === 'string' && item.trim() && !seen.has(item)) {
        seen.add(item);
        clean.push(item);
      }
    }
    if (clean.length > 0) {
      out[key] = clean;
      hasEntries = true;
    }
  }
  return hasEntries ? out : undefined;
}

export function mergeMeta(local: Meta, remote: Meta): Meta {
  const lastOpenDate =
    local.lastOpenDate >= remote.lastOpenDate ? local.lastOpenDate : remote.lastOpenDate;
  const lastExportAt = Math.max(local.lastExportAt || 0, remote.lastExportAt || 0) || null;
  const localOrder = normalizeDocOrder(local.docOrder);
  const remoteOrder = normalizeDocOrder(remote.docOrder);
  const localOrderTs = typeof local.docOrderUpdatedAt === 'number' ? local.docOrderUpdatedAt : 0;
  const remoteOrderTs = typeof remote.docOrderUpdatedAt === 'number' ? remote.docOrderUpdatedAt : 0;
  const mergedOrderTs = Math.max(localOrderTs, remoteOrderTs);

  let docOrder: Record<string, string[]> | undefined;
  if (localOrder || remoteOrder) {
    const primary = localOrderTs >= remoteOrderTs ? localOrder : remoteOrder;
    const secondary = localOrderTs >= remoteOrderTs ? remoteOrder : localOrder;
    docOrder = {
      ...(secondary ?? {}),
      ...(primary ?? {}),
    };
  }

  return {
    schemaVersion: 1,
    lastOpenDate,
    hasSample: local.hasSample && remote.hasSample,
    lastExportAt,
    ...(docOrder ? { docOrder } : {}),
    ...(mergedOrderTs > 0 ? { docOrderUpdatedAt: mergedOrderTs } : {}),
  };
}

export function mergeWorkspaces(
  local: WorkspaceData,
  remote: WorkspaceData,
  nowTs: number = Date.now(),
): WorkspaceData {
  const merged: WorkspaceData = {
    meta: mergeMeta(local.meta, remote.meta),
    tasks: mergeEntityArrays(local.tasks, remote.tasks, nowTs),
    projects: mergeEntityArrays(local.projects, remote.projects, nowTs),
    notes: mergeEntityArrays(local.notes, remote.notes, nowTs),
    stickies: mergeEntityArrays(local.stickies ?? [], remote.stickies ?? [], nowTs),
  };
  return normalizeWorkspace(merged);
}

function normalizeAttachments(arr: Attachment[] | undefined): Attachment[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((a) => a && typeof a === 'object' && typeof a.id === 'string' && typeof a.name === 'string')
    .map((a) => ({
      id: a.id,
      kind: (['link', 'image', 'file'].includes(a.kind) ? a.kind : 'file') as Attachment['kind'],
      name: a.name.trim() || 'Untitled',
      url: a.url,
      relPath: a.relPath,
      mimeType: a.mimeType,
      size: typeof a.size === 'number' ? a.size : undefined,
      dataUrl: a.dataUrl,
      createdAt: typeof a.createdAt === 'number' ? a.createdAt : Date.now(),
    }));
}

function normalizeTaskStatus(rawStatus: unknown, rawDone: boolean): TaskStatus {
  if (typeof rawStatus === 'string' && (TASK_STATUS_ORDER as readonly string[]).includes(rawStatus)) {
    return rawStatus as TaskStatus;
  }
  return rawDone ? 'done' : 'todo';
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Normalizes a task for full backward compatibility with legacy v0.1–v0.5 JSON shards. */
export function normalizeTask(t: Task, activeProjIds?: Set<string>): Task {
  const status = normalizeTaskStatus((t as Partial<Task>).status, !!t.done);
  const done = status === 'done';

  let startDate = typeof t.startDate === 'string' ? t.startDate.trim() : '';
  let due = typeof t.due === 'string' ? t.due.trim() : '';
  if (startDate && due && startDate > due) {
    [startDate, due] = [due, startDate];
  } else if (startDate && !due) {
    due = startDate;
    startDate = '';
  } else if (startDate && due && startDate === due) {
    startDate = '';
  }

  const startTime =
    typeof t.startTime === 'string' && TIME_RE.test(t.startTime.trim())
      ? t.startTime.trim()
      : undefined;
  const endTime =
    startTime &&
    typeof t.endTime === 'string' &&
    TIME_RE.test(t.endTime.trim()) &&
    t.endTime.trim() > startTime
      ? t.endTime.trim()
      : undefined;

  const projectId =
    t.projectId && (!activeProjIds || activeProjIds.has(t.projectId)) ? t.projectId : '';

  return {
    ...t,
    note: t.note ?? '',
    prio: ([1, 2, 3, 4].includes(t.prio) ? t.prio : 2) as Task['prio'],
    status,
    due,
    startDate: startDate || undefined,
    startTime,
    endTime,
    order: typeof t.order === 'number' && Number.isFinite(t.order) ? t.order : undefined,
    done,
    doneAt: done ? (t.doneAt ?? t.updatedAt ?? t.createdAt) : null,
    projectId,
    rolls: typeof t.rolls === 'number' && Number.isFinite(t.rolls) ? t.rolls : 0,
    carriedDate: t.carriedDate ?? null,
    attachments: normalizeAttachments(t.attachments),
  };
}

/** Ensures referential integrity without deleting orphaned tasks. */
export function normalizeWorkspace(data: WorkspaceData): WorkspaceData {
  const activeProjIds = new Set(data.projects.filter(isActive).map((p) => p.id));

  const tasks: Task[] = data.tasks.map((t) => normalizeTask(t, activeProjIds));

  const projects: Project[] = data.projects.map((p) => {
    const clean: Project = {
      id: p.id,
      name: typeof p.name === 'string' ? p.name : '',
      color: resolveProjectColor((p as Partial<Project>).color, p.id),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
    if (p.deletedAt !== undefined) clean.deletedAt = p.deletedAt;
    if (p._sample !== undefined) clean._sample = p._sample;
    return clean;
  });

  const notes: Note[] = data.notes.map((n) => ({
    ...n,
    tags: Array.isArray(n.tags) ? n.tags.filter(Boolean).slice(0, 6) : [],
    attachments: normalizeAttachments(n.attachments),
  }));

  const stickies: StickyNote[] = Array.isArray(data.stickies)
    ? data.stickies.filter((s) => s && typeof s === 'object').map((s) => normalizeSticky(s))
    : [];

  const hasSample =
    tasks.some((x) => isActive(x) && x._sample) ||
    projects.some((x) => isActive(x) && x._sample) ||
    notes.some((x) => isActive(x) && x._sample);

  const normalizedDocOrder = normalizeDocOrder(data.meta?.docOrder);
  const docOrderUpdatedAt =
    typeof data.meta?.docOrderUpdatedAt === 'number' && Number.isFinite(data.meta.docOrderUpdatedAt)
      ? data.meta.docOrderUpdatedAt
      : undefined;

  return {
    meta: {
      ...data.meta,
      schemaVersion: 1,
      hasSample,
      ...(normalizedDocOrder ? { docOrder: normalizedDocOrder } : {}),
      ...(docOrderUpdatedAt !== undefined ? { docOrderUpdatedAt } : {}),
    },
    tasks,
    projects,
    notes,
    stickies,
  };
}

/** Delete project with explicit cascade choice: keep (unlink) or deleteAll (soft-delete children). */
export function removeProjectFromWorkspace(
  data: WorkspaceData,
  projectId: string,
  mode: 'keep' | 'deleteAll',
  nowTs: number = Date.now(),
): WorkspaceData {
  const projects = data.projects.map((p) =>
    p.id === projectId ? { ...p, deletedAt: nowTs, updatedAt: nowTs } : p,
  );

  const tasks = data.tasks.map((t) => {
    if (t.projectId !== projectId || !isActive(t)) return t;
    if (mode === 'deleteAll') {
      return { ...t, deletedAt: nowTs, updatedAt: nowTs };
    }
    return { ...t, projectId: '', updatedAt: nowTs };
  });

  return { ...data, projects, tasks };
}
