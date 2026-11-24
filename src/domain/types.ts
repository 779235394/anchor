export type Priority = 1 | 2 | 3 | 4;
export type TaskStatus = 'todo' | 'doing' | 'confirm' | 'done';
export type StorageMode = 'local' | 'git';
export type ProjectColor =
  | 'blue'
  | 'indigo'
  | 'purple'
  | 'pink'
  | 'orange'
  | 'green'
  | 'teal'
  | 'slate';
export type ThemeMode = 'system' | 'light' | 'dark';
export type AccentColor = 'blue' | 'indigo' | 'teal' | 'graphite';
export type Lang = 'zh' | 'en';
export type QuickCaptureDefaultMode = 'last' | 'note' | 'task';
export type ViewKey =
  | 'tasks'
  | 'kanban'
  | 'schedule'
  | 'projects'
  | 'knowledge'
  | 'notes'
  | 'review'
  | 'settings';

export const TASK_STATUS_ORDER: readonly TaskStatus[] = [
  'todo',
  'doing',
  'confirm',
  'done',
] as const;

export interface BaseEntity {
  id: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  _sample?: boolean;
}

export interface Meta {
  schemaVersion: 1;
  lastOpenDate: string; // YYYY-MM-DD
  hasSample: boolean;
  lastExportAt: number | null;
}

export type AttachmentKind = 'link' | 'image' | 'file';

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  url?: string;       // For link attachments
  relPath?: string;   // Relative POSIX path inside <dataDir>, e.g. "attachments/<id>.png"
  mimeType?: string;
  size?: number;
  dataUrl?: string;   // Browser-only preview fallback (not persisted in desktop JSON)
  createdAt: number;
}

export interface Task extends BaseEntity {
  title: string;
  note: string;
  prio: Priority;
  status: TaskStatus; // Kanban flow stage: todo -> doing -> confirm -> done
  due: string; // YYYY-MM-DD or '' (schedule end date / due date)
  startDate?: string; // Optional YYYY-MM-DD (schedule start date; empty means single-day on `due`)
  startTime?: string; // Optional "HH:mm"
  endTime?: string; // Optional "HH:mm"
  order?: number; // Optional sort weight inside Kanban column
  done: boolean;
  doneAt: number | null;
  projectId: string;
  rolls: number;
  carriedDate: string | null;
  attachments: Attachment[];
}

export interface Project extends BaseEntity {
  name: string;
  color: ProjectColor;
}

export interface Note extends BaseEntity {
  text: string;
  tags: string[];
  attachments: Attachment[];
}

export type GitAuthMode = 'system' | 'https_token';

export interface AppConfig {
  storageMode: StorageMode;
  localDataDir: string;
  gitDataDir: string;
  dataDir: string;
  theme: ThemeMode;
  accent: AccentColor;
  lang: Lang;
  closeToTray: boolean;
  quickCaptureEnabled: boolean;
  quickCaptureShortcut: string;
  quickCaptureDefaultMode: QuickCaptureDefaultMode;
  gitRemoteUrl: string;
  gitBranch: string;
  gitAuthMode: GitAuthMode;
  gitUsername: string;
  gitToken: string;
  gitPullOnStart: boolean;
  gitAutoPush: boolean;
  gitLastSyncAt: number | null;
  ignoredUpdateVersion: string;
  pinnedDocs?: string[];
}

export interface GitAuth {
  mode: GitAuthMode;
  username: string;
  token: string;
}

export interface GitCommitInfo {
  hash: string;
  message: string;
  date: string;
}

export interface GitStatus {
  gitAvailable: boolean;
  gitVersion: string;
  isRepo: boolean;
  remoteUrl: string;
  branch: string;
  dirtyCount: number;
  ahead: number;
  behind: number;
  recentCommits: GitCommitInfo[];
}

export interface GitConnectionResult {
  ok: boolean;
  defaultBranch: string;
  message: string;
}

export interface OrphanCleanupResult {
  removedCount: number;
  freedBytes: number;
}

export interface WorkspaceData {
  meta: Meta;
  tasks: Task[];
  projects: Project[];
  notes: Note[];
}

export interface SnapshotInfo {
  dateKey: string;
  fileCount: number;
}

export interface WorkspaceLoadResult {
  data: WorkspaceData;
  isNewWorkspace: boolean;
  warnings: string[];
}

export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isActive<T extends BaseEntity>(item: T): boolean {
  return !item.deletedAt;
}
