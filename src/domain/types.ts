export type Priority = 1 | 2 | 3 | 4;
export type ProjectStatus = 'active' | 'blocked' | 'done';
export type AssignmentStatus = 'todo' | 'doing' | 'blocked' | 'done';
export type ThemeMode = 'system' | 'light' | 'dark';
export type AccentColor = 'blue' | 'indigo' | 'teal' | 'graphite';
export type Lang = 'zh' | 'en';
export type ViewKey =
  | 'tasks'
  | 'notes'
  | 'projects'
  | 'daily'
  | 'assignments'
  | 'members'
  | 'review'
  | 'settings';

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
  due: string; // YYYY-MM-DD or ''
  done: boolean;
  doneAt: number | null;
  projectId: string;
  rolls: number;
  carriedDate: string | null;
  attachments: Attachment[];
}

export interface Project extends BaseEntity {
  name: string;
  status: ProjectStatus;
  stage: string;
  next: string;
  blocker: string;
}

export interface Note extends BaseEntity {
  text: string;
  tags: string[];
  attachments: Attachment[];
}

export interface Member extends BaseEntity {
  name: string;
  role: string;
  note: string;
}

export interface Assignment extends BaseEntity {
  title: string;
  desc: string;
  ownerId: string;
  projectId: string;
  dueAt: string; // YYYY-MM-DDTHH:mm
  status: AssignmentStatus;
  doneAt: number | null;
  attachments: Attachment[];
}

export interface DailyItem extends BaseEntity {
  date: string; // YYYY-MM-DD
  title: string;
  ownerId: string;
  done: boolean;
  doneAt: number | null;
  carriedFromId: string | null;
  carriedToDate: string | null;
  carryCount: number;
}

export interface AppConfig {
  dataDir: string;
  theme: ThemeMode;
  accent: AccentColor;
  lang: Lang;
  closeToTray: boolean;
}

export interface WorkspaceData {
  meta: Meta;
  tasks: Task[];
  projects: Project[];
  notes: Note[];
  members: Member[];
  assignments: Assignment[];
  daily: DailyItem[];
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

export const PRESET_ROLES = [
  '技术经理',
  '前端开发',
  '前端组长',
  '后端开发',
  '后端组长',
  '测试',
  '运维',
  '运维组长',
] as const;

export const ROLE_EN_MAP: Record<string, string> = {
  技术经理: 'Tech Manager',
  前端开发: 'Frontend Dev',
  前端组长: 'Frontend Lead',
  后端开发: 'Backend Dev',
  后端组长: 'Backend Lead',
  测试: 'QA',
  运维: 'Ops',
  运维组长: 'Ops Lead',
};

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
