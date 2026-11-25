import type {
  AccentColor,
  Attachment,
  Lang,
  Meta,
  Note,
  Priority,
  Project,
  ProjectColor,
  Task,
  TaskStatus,
  ThemeMode,
} from '@/domain/types';
import type { DocEntry, DocFileContent, DocSearchHit } from '@/domain/docs';

export interface MobileBootstrapPayload {
  prefs: {
    lang: Lang;
    accent: AccentColor;
    theme: ThemeMode;
  };
  meta: Meta;
  tasks: Task[];
  projects: Project[];
  notes: Note[];
  docsTree: DocEntry[];
  serverTime: number;
}

export class MobileApiError extends Error {
  status: number;
  data?: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  includeCsrf = false,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (includeCsrf) {
    headers.set('X-Anchor-Client', 'mobile');
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const resp = await fetch(url, {
    ...init,
    headers,
    credentials: 'same-origin',
  });
  let payload: unknown = null;
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      payload = await resp.json();
    } catch {
      payload = null;
    }
  }
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    if (payload && typeof payload === 'object') {
      const rec = payload as Record<string, unknown>;
      if (typeof rec.message === 'string' && rec.message) {
        msg = rec.message;
      } else if (typeof rec.error === 'string' && rec.error) {
        msg = rec.error;
      }
    }
    throw new MobileApiError(resp.status, msg, payload);
  }
  return payload as T;
}

const DEVICE_KEY_STORAGE = 'anchor_mobile_device_key_v1';

function getOrCreateDeviceKey(): string | undefined {
  try {
    let key = localStorage.getItem(DEVICE_KEY_STORAGE);
    if (!key) {
      key =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(DEVICE_KEY_STORAGE, key);
    }
    return key;
  } catch {
    return undefined;
  }
}

export const mobileApi = {
  pair(token: string, deviceName?: string) {
    return requestJson<{ ok: boolean; sessionId: string; deviceName: string }>(
      '/api/auth/pair',
      {
        method: 'POST',
        body: JSON.stringify({ token, deviceName, deviceKey: getOrCreateDeviceKey() }),
      },
      false,
    );
  },

  checkSession() {
    return requestJson<{ authenticated: boolean; sessionId?: string; deviceName?: string }>(
      '/api/auth/session',
    );
  },

  logout() {
    return requestJson<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }, true);
  },

  bootstrap() {
    return requestJson<MobileBootstrapPayload>('/api/bootstrap');
  },

  // Tasks
  createTask(payload: {
    title?: string;
    note?: string;
    prio?: Priority;
    status?: TaskStatus;
    due?: string;
    startDate?: string;
    startTime?: string;
    endTime?: string;
    projectId?: string;
    attachments?: Attachment[];
  }) {
    return requestJson<Task>(
      '/api/tasks',
      { method: 'POST', body: JSON.stringify(payload) },
      true,
    );
  },

  updateTask(
    id: string,
    patch: Partial<{
      title: string;
      note: string;
      prio: Priority;
      status: TaskStatus;
      done: boolean;
      due: string;
      startDate: string;
      startTime: string;
      endTime: string;
      projectId: string;
      attachments: Attachment[];
    }>,
  ) {
    return requestJson<Task>(
      `/api/tasks/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
      true,
    );
  },

  deleteTask(id: string) {
    return requestJson<Task>(
      `/api/tasks/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      true,
    );
  },

  // Projects
  createProject(payload: { name: string; color?: ProjectColor }) {
    return requestJson<Project>(
      '/api/projects',
      { method: 'POST', body: JSON.stringify(payload) },
      true,
    );
  },

  updateProject(id: string, patch: Partial<{ name: string; color: ProjectColor }>) {
    return requestJson<Project>(
      `/api/projects/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
      true,
    );
  },

  deleteProject(id: string) {
    return requestJson<Project>(
      `/api/projects/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      true,
    );
  },

  // Notes
  createNote(payload: { text: string; tags?: string[]; attachments?: Attachment[] }) {
    return requestJson<Note>(
      '/api/notes',
      { method: 'POST', body: JSON.stringify(payload) },
      true,
    );
  },

  updateNote(
    id: string,
    patch: Partial<{ text: string; tags: string[]; attachments: Attachment[] }>,
  ) {
    return requestJson<Note>(
      `/api/notes/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
      true,
    );
  },

  deleteNote(id: string) {
    return requestJson<Note>(
      `/api/notes/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      true,
    );
  },

  // Knowledge Base Docs
  listDocsTree() {
    return requestJson<DocEntry[]>('/api/docs/tree');
  },

  searchDocs(q: string) {
    return requestJson<DocSearchHit[]>(`/api/docs/search?q=${encodeURIComponent(q)}`);
  },

  readDocFile(relPath: string) {
    return requestJson<DocFileContent>(`/api/docs/file?path=${encodeURIComponent(relPath)}`);
  },

  writeDocFile(payload: {
    relPath: string;
    content: string;
    expectedUpdatedAt?: number;
    force?: boolean;
  }) {
    return requestJson<DocFileContent>(
      '/api/docs/file',
      { method: 'PUT', body: JSON.stringify(payload) },
      true,
    );
  },

  createDocFolder(relPath: string) {
    return requestJson<DocEntry>(
      '/api/docs/folder',
      { method: 'POST', body: JSON.stringify({ relPath }) },
      true,
    );
  },

  renameDocEntry(oldRelPath: string, newRelPath: string) {
    return requestJson<{ relPath: string }>(
      '/api/docs/rename',
      { method: 'POST', body: JSON.stringify({ oldRelPath, newRelPath }) },
      true,
    );
  },

  deleteDocEntry(relPath: string) {
    return requestJson<{ ok: boolean }>(
      `/api/docs/entry?path=${encodeURIComponent(relPath)}`,
      { method: 'DELETE' },
      true,
    );
  },

  // Image attachment upload
  uploadImage(file: File) {
    const fd = new FormData();
    fd.append('file', file, file.name || 'photo.jpg');
    return requestJson<Attachment>(
      '/api/attachments/upload',
      { method: 'POST', body: fd },
      true,
    );
  },
};
