import {
  isActive,
  TOMBSTONE_TTL_MS,
  type Assignment,
  type Attachment,
  type BaseEntity,
  type DailyItem,
  type Member,
  type Meta,
  type Note,
  type Project,
  type Task,
  type WorkspaceData,
} from './types';
import { todayStr } from './date';

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
    members: [],
    assignments: [],
    daily: [],
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

export function mergeMeta(local: Meta, remote: Meta): Meta {
  const lastOpenDate =
    local.lastOpenDate >= remote.lastOpenDate ? local.lastOpenDate : remote.lastOpenDate;
  const lastExportAt = Math.max(local.lastExportAt || 0, remote.lastExportAt || 0) || null;
  return {
    schemaVersion: 1,
    lastOpenDate,
    hasSample: local.hasSample && remote.hasSample,
    lastExportAt,
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
    members: mergeEntityArrays(local.members, remote.members, nowTs),
    assignments: mergeEntityArrays(local.assignments, remote.assignments, nowTs),
    daily: mergeEntityArrays(local.daily, remote.daily, nowTs),
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

/** Ensures referential integrity without deleting orphaned tasks/assignments/daily records. */
export function normalizeWorkspace(data: WorkspaceData): WorkspaceData {
  const activeProjIds = new Set(data.projects.filter(isActive).map((p) => p.id));
  const activeMemberIds = new Set(data.members.filter(isActive).map((m) => m.id));

  const tasks: Task[] = data.tasks.map((t) => ({
    ...t,
    note: t.note ?? '',
    prio: ([1, 2, 3, 4].includes(t.prio) ? t.prio : 2) as Task['prio'],
    due: t.due ?? '',
    done: !!t.done,
    doneAt: t.done ? (t.doneAt ?? t.updatedAt ?? t.createdAt) : null,
    projectId: t.projectId && activeProjIds.has(t.projectId) ? t.projectId : '',
    rolls: typeof t.rolls === 'number' && Number.isFinite(t.rolls) ? t.rolls : 0,
    carriedDate: t.carriedDate ?? null,
    attachments: normalizeAttachments(t.attachments),
  }));

  const projects: Project[] = data.projects.map((p) => ({
    ...p,
    status: (['active', 'blocked', 'done'].includes(p.status)
      ? p.status
      : 'active') as Project['status'],
    stage: p.stage ?? '',
    next: p.next ?? '',
    blocker: p.blocker ?? '',
  }));

  const notes: Note[] = data.notes.map((n) => ({
    ...n,
    tags: Array.isArray(n.tags) ? n.tags.filter(Boolean).slice(0, 6) : [],
    attachments: normalizeAttachments(n.attachments),
  }));

  const members: Member[] = data.members.map((m) => ({
    ...m,
    role: m.role?.trim() || '前端开发',
    note: m.note ?? '',
  }));

  const assignments: Assignment[] = data.assignments.map((a) => ({
    ...a,
    desc: a.desc ?? '',
    ownerId: a.ownerId && activeMemberIds.has(a.ownerId) ? a.ownerId : '',
    projectId: a.projectId && activeProjIds.has(a.projectId) ? a.projectId : '',
    status: (['todo', 'doing', 'blocked', 'done'].includes(a.status)
      ? a.status
      : 'todo') as Assignment['status'],
    doneAt: a.status === 'done' ? (a.doneAt ?? a.updatedAt ?? a.createdAt) : null,
    attachments: normalizeAttachments(a.attachments),
  }));

  const daily: DailyItem[] = data.daily.map((d) => ({
    ...d,
    ownerId: d.ownerId && activeMemberIds.has(d.ownerId) ? d.ownerId : '',
    done: !!d.done,
    doneAt: d.done ? (d.doneAt ?? d.updatedAt ?? d.createdAt) : null,
    carriedFromId: d.carriedFromId ?? null,
    carriedToDate: d.carriedToDate ?? null,
    carryCount: typeof d.carryCount === 'number' ? d.carryCount : 0,
  }));

  const hasSample =
    tasks.some((x) => isActive(x) && x._sample) ||
    projects.some((x) => isActive(x) && x._sample) ||
    notes.some((x) => isActive(x) && x._sample) ||
    members.some((x) => isActive(x) && x._sample) ||
    assignments.some((x) => isActive(x) && x._sample) ||
    daily.some((x) => isActive(x) && x._sample);

  return {
    meta: { ...data.meta, schemaVersion: 1, hasSample },
    tasks,
    projects,
    notes,
    members,
    assignments,
    daily,
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

  const assignments = data.assignments.map((a) => {
    if (a.projectId !== projectId || !isActive(a)) return a;
    if (mode === 'deleteAll') {
      return { ...a, deletedAt: nowTs, updatedAt: nowTs };
    }
    return { ...a, projectId: '', updatedAt: nowTs };
  });

  return { ...data, projects, tasks, assignments };
}

/** Soft-delete member and unlink their assignments & daily items so history is preserved. */
export function removeMemberFromWorkspace(
  data: WorkspaceData,
  memberId: string,
  nowTs: number = Date.now(),
): WorkspaceData {
  const members = data.members.map((m) =>
    m.id === memberId ? { ...m, deletedAt: nowTs, updatedAt: nowTs } : m,
  );
  const assignments = data.assignments.map((a) =>
    a.ownerId === memberId && isActive(a) ? { ...a, ownerId: '', updatedAt: nowTs } : a,
  );
  const daily = data.daily.map((d) =>
    d.ownerId === memberId && isActive(d) ? { ...d, ownerId: '', updatedAt: nowTs } : d,
  );
  return { ...data, members, assignments, daily };
}
