import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import {
  disable as autostartDisable,
  enable as autostartEnable,
  isEnabled as autostartIsEnabledRaw,
} from '@tauri-apps/plugin-autostart';
import {
  createEmptyWorkspace,
  normalizeWorkspace,
} from '@/domain/merge';
import { todayStr } from '@/domain/date';
import type { DocEntry, DocFileContent, DocSearchHit } from '@/domain/docs';
import { getBaseName, normalizeDocRelPath } from '@/domain/docs';
import type {
  AppConfig,
  Attachment,
  GitAuth,
  GitConnectionResult,
  GitStatus,
  Lang,
  OrphanCleanupResult,
  SnapshotInfo,
  StorageMode,
  WorkspaceData,
  WorkspaceLoadResult,
} from '@/domain/types';

export interface StoredAttachmentMeta {
  id: string;
  name: string;
  relPath: string;
  mimeType: string;
  size: number;
}

export interface GitPullResult {
  outcome: 'up_to_date' | 'updated' | 'empty_remote' | 'semantic_merge';
  hadConflict: boolean;
  localBundle: WorkspaceLoadResult | null;
  remoteBundle: WorkspaceLoadResult | null;
}

export interface GitPushResult {
  committed: boolean;
  pushed: boolean;
  status: GitStatus;
}

export interface LatestReleaseInfo {
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string;
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Macintosh|Mac OS X/i.test(navigator.userAgent);
}

export function defaultQuickCaptureShortcut(): string {
  return isMacPlatform() ? 'Alt+Space' : 'Alt+Shift+Space';
}

const WEB_CONFIG_KEY = 'anchor_web_config_v1';
const WEB_DATA_KEY = 'anchor_web_data_v1';

const DEFAULT_WEB_CONFIG: AppConfig = {
  storageMode: 'local',
  localDataDir: '~/Documents/Anchor (Browser Preview)',
  gitDataDir: '~/Documents/Anchor-Git (Browser Preview)',
  dataDir: '~/Documents/Anchor (Browser Preview)',
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
};

interface RawWorkspaceBundle {
  meta: WorkspaceData['meta'];
  tasks: WorkspaceData['tasks'];
  projects: WorkspaceData['projects'];
  notes: WorkspaceData['notes'];
  isNewWorkspace: boolean;
  warnings: string[];
}

function hydrateBundle(raw: RawWorkspaceBundle): WorkspaceLoadResult {
  const empty = createEmptyWorkspace(todayStr());
  const data = normalizeWorkspace({
    meta: raw.meta && typeof raw.meta === 'object' ? { ...empty.meta, ...raw.meta } : empty.meta,
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    projects: Array.isArray(raw.projects) ? raw.projects : [],
    notes: Array.isArray(raw.notes) ? raw.notes : [],
  });
  return {
    data,
    isNewWorkspace: !!raw.isNewWorkspace,
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
  };
}

export const storageApi = {
  async getAppConfig(): Promise<AppConfig> {
    if (isTauriRuntime()) {
      const cfg = await invoke<AppConfig>('get_app_config');
      return {
        ...DEFAULT_WEB_CONFIG,
        ...cfg,
        quickCaptureShortcut: cfg.quickCaptureShortcut || defaultQuickCaptureShortcut(),
        quickCaptureDefaultMode: cfg.quickCaptureDefaultMode || 'last',
      };
    }
    try {
      const raw = localStorage.getItem(WEB_CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AppConfig>;
        return {
          ...DEFAULT_WEB_CONFIG,
          ...parsed,
          quickCaptureShortcut: parsed.quickCaptureShortcut || defaultQuickCaptureShortcut(),
        };
      }
    } catch {
      // ignore
    }
    return { ...DEFAULT_WEB_CONFIG };
  },

  async saveAppConfig(config: AppConfig): Promise<AppConfig> {
    if (isTauriRuntime()) {
      return invoke<AppConfig>('save_app_config_cmd', { config });
    }
    localStorage.setItem(WEB_CONFIG_KEY, JSON.stringify(config));
    return config;
  },

  async pickDataDir(): Promise<string | null> {
    if (isTauriRuntime()) {
      return invoke<string | null>('pick_data_dir');
    }
    return null;
  },

  async switchDataDir(
    targetDir: string,
    mode: 'use_existing' | 'copy_current',
  ): Promise<WorkspaceLoadResult> {
    if (isTauriRuntime()) {
      const raw = await invoke<RawWorkspaceBundle>('switch_data_dir', {
        targetDir,
        mode,
      });
      return hydrateBundle(raw);
    }
    return this.loadWorkspace();
  },

  async switchStorageMode(
    mode: StorageMode,
    migration: 'none' | 'copy_current',
  ): Promise<{ config: AppConfig; workspace: WorkspaceLoadResult }> {
    if (isTauriRuntime()) {
      const raw = await invoke<{ config: AppConfig; workspace: RawWorkspaceBundle }>(
        'switch_storage_mode_cmd',
        { mode, migration },
      );
      return {
        config: {
          ...DEFAULT_WEB_CONFIG,
          ...raw.config,
        },
        workspace: hydrateBundle(raw.workspace),
      };
    }
    const current = await this.getAppConfig();
    const nextDir = mode === 'git' ? current.gitDataDir : current.localDataDir;
    const saved = await this.saveAppConfig({
      ...current,
      storageMode: mode,
      dataDir: nextDir,
    });
    const workspace = await this.loadWorkspace();
    return { config: saved, workspace };
  },

  async openDataDir(): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('open_data_dir');
    }
  },

  async loadWorkspace(): Promise<WorkspaceLoadResult> {
    if (isTauriRuntime()) {
      const raw = await invoke<RawWorkspaceBundle>('load_workspace_cmd');
      return hydrateBundle(raw);
    }
    try {
      const raw = localStorage.getItem(WEB_DATA_KEY);
      if (!raw) {
        return {
          data: createEmptyWorkspace(todayStr()),
          isNewWorkspace: true,
          warnings: [],
        };
      }
      const parsed = JSON.parse(raw) as WorkspaceData;
      return {
        data: normalizeWorkspace({
          meta: parsed.meta,
          tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
          projects: Array.isArray(parsed.projects) ? parsed.projects : [],
          notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        }),
        isNewWorkspace: false,
        warnings: [],
      };
    } catch {
      return {
        data: createEmptyWorkspace(todayStr()),
        isNewWorkspace: true,
        warnings: [],
      };
    }
  },

  async saveShard(shard: string, payload: unknown, fullWebFallback?: WorkspaceData): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('save_shard_cmd', {
        shard,
        payloadJson: JSON.stringify(payload),
      });
      return;
    }
    if (fullWebFallback) {
      localStorage.setItem(WEB_DATA_KEY, JSON.stringify(fullWebFallback));
    }
  },

  async exportMarkdownReport(weekKey: string, content: string): Promise<string> {
    if (isTauriRuntime()) {
      return invoke<string>('export_markdown_report_cmd', { weekKey, content });
    }
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${weekKey}.md`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 500);
    return `${weekKey}.md`;
  },

  async listSnapshots(): Promise<SnapshotInfo[]> {
    if (isTauriRuntime()) {
      return invoke<SnapshotInfo[]>('list_snapshots_cmd');
    }
    return [];
  },

  async restoreSnapshot(dateKey: string): Promise<WorkspaceLoadResult> {
    if (isTauriRuntime()) {
      const raw = await invoke<RawWorkspaceBundle>('restore_snapshot_cmd', { dateKey });
      return hydrateBundle(raw);
    }
    return this.loadWorkspace();
  },

  async updateTrayBadge(openToday: number, overdue: number, lang: Lang): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('update_tray_badge_cmd', { openToday, overdue, lang });
    }
  },

  async onExternalChange(cb: () => void): Promise<UnlistenFn> {
    if (isTauriRuntime()) {
      return listen('workspace://external-change', () => cb());
    }
    return () => {};
  },

  async onDocsExternalChange(cb: () => void): Promise<UnlistenFn> {
    if (isTauriRuntime()) {
      return listen('workspace://docs-external-change', () => cb());
    }
    return () => {};
  },

  // ================= KNOWLEDGE BASE / MARKDOWN DOCS =================
  async listDocsTree(): Promise<DocEntry[]> {
    if (isTauriRuntime()) {
      return invoke<DocEntry[]>('list_docs_tree_cmd');
    }
    return browserDocsList();
  },

  async readDocFile(relPath: string): Promise<DocFileContent> {
    if (isTauriRuntime()) {
      return invoke<DocFileContent>('read_doc_file_cmd', { relPath });
    }
    return browserDocsRead(relPath);
  },

  async writeDocFile(relPath: string, content: string): Promise<DocFileContent> {
    if (isTauriRuntime()) {
      return invoke<DocFileContent>('write_doc_file_cmd', { relPath, content });
    }
    return browserDocsWrite(relPath, content);
  },

  async createDocFolder(relPath: string): Promise<DocEntry> {
    if (isTauriRuntime()) {
      return invoke<DocEntry>('create_doc_folder_cmd', { relPath });
    }
    return browserDocsCreateFolder(relPath);
  },

  async renameDocEntry(oldRelPath: string, newRelPath: string): Promise<string> {
    if (isTauriRuntime()) {
      return invoke<string>('rename_doc_entry_cmd', { oldRelPath, newRelPath });
    }
    return browserDocsRename(oldRelPath, newRelPath);
  },

  async deleteDocEntry(relPath: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('delete_doc_entry_cmd', { relPath });
      return;
    }
    browserDocsDelete(relPath);
  },

  async importMdFiles(targetDirRelPath: string): Promise<DocEntry[]> {
    if (isTauriRuntime()) {
      return invoke<DocEntry[]>('import_md_files_cmd', { targetDirRelPath });
    }
    return [];
  },

  async exportDocFile(relPath: string): Promise<string | null> {
    if (isTauriRuntime()) {
      return invoke<string | null>('export_doc_file_cmd', { relPath });
    }
    const file = browserDocsRead(relPath);
    const blob = new Blob([file.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getBaseName(relPath) || 'document.md';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 500);
    return a.download;
  },

  async exportDocPdf(defaultName: string, html: string): Promise<string | null> {
    if (isTauriRuntime()) {
      return invoke<string | null>('export_doc_pdf_cmd', { defaultName, html });
    }
    return null;
  },

  async revealDocEntry(relPath: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('reveal_doc_entry_cmd', { relPath });
    }
  },

  async searchDocs(query: string): Promise<DocSearchHit[]> {
    if (!query.trim()) return [];
    if (isTauriRuntime()) {
      return invoke<DocSearchHit[]>('search_docs_cmd', { query });
    }
    return browserDocsSearch(query);
  },

  // ================= QUICK CAPTURE FLOATING WINDOW & GLOBAL SHORTCUT =================
  async toggleQuickCapture(): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('toggle_quick_capture_cmd');
    }
  },

  async hideQuickCapture(): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('hide_quick_capture_cmd');
    }
  },

  async updateQuickCaptureShortcut(shortcut: string, enabled: boolean): Promise<AppConfig> {
    if (isTauriRuntime()) {
      return invoke<AppConfig>('update_quick_capture_shortcut_cmd', { shortcut, enabled });
    }
    const current = await this.getAppConfig();
    const next: AppConfig = {
      ...current,
      quickCaptureShortcut: shortcut,
      quickCaptureEnabled: enabled,
    };
    return this.saveAppConfig(next);
  },

  async notifyQuickCaptureSaved(kind: 'note' | 'task'): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('notify_quick_capture_saved_cmd', { kind });
    }
  },

  async onQuickCaptureSaved(cb: (kind: string) => void): Promise<UnlistenFn> {
    if (isTauriRuntime()) {
      return listen<string>('workspace://quick-capture-saved', (e) => cb(e.payload));
    }
    return () => {};
  },

  async onQuickCaptureShown(cb: () => void): Promise<UnlistenFn> {
    if (isTauriRuntime()) {
      return listen('quick-capture://shown', () => cb());
    }
    return () => {};
  },

  // ================= ATTACHMENTS =================
  async pickAttachmentFiles(imagesOnly: boolean): Promise<string[]> {
    if (isTauriRuntime()) {
      return invoke<string[]>('pick_attachment_files_cmd', { imagesOnly });
    }
    return [];
  },

  async importAttachmentFile(sourcePath: string): Promise<StoredAttachmentMeta> {
    return invoke<StoredAttachmentMeta>('import_attachment_file_cmd', { sourcePath });
  },

  async tryImportLocalPath(rawPath: string): Promise<StoredAttachmentMeta | null> {
    if (!isTauriRuntime()) return null;
    return invoke<StoredAttachmentMeta | null>('try_import_local_path_cmd', { rawPath });
  },

  async saveAttachmentBytes(
    fileName: string,
    mimeType: string,
    bytes: Uint8Array,
  ): Promise<StoredAttachmentMeta> {
    if (isTauriRuntime()) {
      return invoke<StoredAttachmentMeta>('save_attachment_bytes_cmd', {
        fileName,
        mimeType,
        bytes: Array.from(bytes),
      });
    }
    return {
      id: `att-${Date.now().toString(36)}`,
      name: fileName,
      relPath: '',
      mimeType,
      size: bytes.length,
    };
  },

  async readAttachmentDataUrl(relPath: string): Promise<string> {
    if (isTauriRuntime() && relPath) {
      return invoke<string>('read_attachment_data_url_cmd', { relPath });
    }
    return '';
  },

  async openAttachment(att: Attachment): Promise<void> {
    if (att.kind === 'link' && att.url) {
      if (isTauriRuntime()) {
        await invoke('open_external_url_cmd', { url: att.url });
      } else {
        window.open(att.url, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    if (isTauriRuntime() && att.relPath) {
      await invoke('open_attachment_cmd', { relPath: att.relPath });
    } else if (att.dataUrl) {
      window.open(att.dataUrl, '_blank', 'noopener,noreferrer');
    }
  },

  async revealAttachment(relPath: string): Promise<void> {
    if (isTauriRuntime() && relPath) {
      await invoke('reveal_attachment_cmd', { relPath });
    }
  },

  async deleteAttachmentFile(relPath: string): Promise<void> {
    if (isTauriRuntime() && relPath) {
      await invoke('delete_attachment_file_cmd', { relPath });
    }
  },

  async cleanupOrphanAttachments(): Promise<OrphanCleanupResult> {
    if (isTauriRuntime()) {
      return invoke<OrphanCleanupResult>('cleanup_orphan_attachments_cmd');
    }
    return { removedCount: 0, freedBytes: 0 };
  },

  async openExternalUrl(url: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('open_external_url_cmd', { url });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  },

  // ================= GIT SYNC =================
  async gitStatus(): Promise<GitStatus> {
    if (isTauriRuntime()) {
      return invoke<GitStatus>('git_status_cmd');
    }
    return {
      gitAvailable: false,
      gitVersion: '',
      isRepo: false,
      remoteUrl: '',
      branch: 'main',
      dirtyCount: 0,
      ahead: 0,
      behind: 0,
      recentCommits: [],
    };
  },

  async gitTestConnection(remoteUrl: string, auth: GitAuth): Promise<GitConnectionResult> {
    if (isTauriRuntime()) {
      return invoke<GitConnectionResult>('git_test_connection_cmd', { remoteUrl, auth });
    }
    return { ok: false, defaultBranch: 'main', message: 'Git sync requires the desktop app.' };
  },

  async gitInitBind(remoteUrl: string, branch: string): Promise<GitStatus> {
    return invoke<GitStatus>('git_init_bind_cmd', { remoteUrl, branch });
  },

  async gitCloneIntoDir(
    remoteUrl: string,
    targetDir: string,
    branch: string,
    auth: GitAuth,
  ): Promise<WorkspaceLoadResult> {
    const raw = await invoke<RawWorkspaceBundle>('git_clone_into_dir_cmd', {
      remoteUrl,
      targetDir,
      branch,
      auth,
    });
    return hydrateBundle(raw);
  },

  async gitPullPrepare(): Promise<GitPullResult> {
    const raw = await invoke<{
      outcome: GitPullResult['outcome'];
      hadConflict: boolean;
      localBundle: RawWorkspaceBundle | null;
      remoteBundle: RawWorkspaceBundle | null;
    }>('git_pull_prepare_cmd');
    return {
      outcome: raw.outcome,
      hadConflict: raw.hadConflict,
      localBundle: raw.localBundle ? hydrateBundle(raw.localBundle) : null,
      remoteBundle: raw.remoteBundle ? hydrateBundle(raw.remoteBundle) : null,
    };
  },

  async gitCommitAndPush(message?: string): Promise<GitPushResult> {
    return invoke<GitPushResult>('git_commit_and_push_cmd', { message: message ?? null });
  },

  // ================= AUTOSTART & UPDATES =================
  async getAutostartEnabled(): Promise<boolean> {
    if (!isTauriRuntime()) return false;
    try {
      return await autostartIsEnabledRaw();
    } catch {
      return false;
    }
  },

  async setAutostartEnabled(enabled: boolean): Promise<boolean> {
    if (!isTauriRuntime()) return false;
    if (enabled) {
      await autostartEnable();
    } else {
      await autostartDisable();
    }
    return autostartIsEnabledRaw();
  },

  async checkLatestRelease(repoSlug = '779235394/anchor'): Promise<LatestReleaseInfo> {
    const resp = await fetch(`https://api.github.com/repos/${repoSlug}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!resp.ok) {
      throw new Error(`GitHub API ${resp.status}`);
    }
    const json = (await resp.json()) as {
      tag_name?: string;
      name?: string;
      body?: string;
      html_url?: string;
      published_at?: string;
    };
    return {
      tagName: json.tag_name || '',
      name: json.name || json.tag_name || '',
      body: json.body || '',
      htmlUrl: json.html_url || `https://github.com/${repoSlug}/releases`,
      publishedAt: json.published_at || '',
    };
  },
};

const BROWSER_DOCS_KEY = 'anchor_browser_docs_v1';

interface BrowserDocsStore {
  folders: Record<string, number>;
  files: Record<string, { content: string; updatedAt: number }>;
}

function loadBrowserDocs(): BrowserDocsStore {
  try {
    const raw = localStorage.getItem(BROWSER_DOCS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BrowserDocsStore>;
      return {
        folders: parsed.folders || {},
        files: parsed.files || {},
      };
    }
  } catch {
    // ignore
  }
  return { folders: {}, files: {} };
}

function saveBrowserDocs(store: BrowserDocsStore) {
  try {
    localStorage.setItem(BROWSER_DOCS_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

function browserDocsList(): DocEntry[] {
  const s = loadBrowserDocs();
  const entries: DocEntry[] = [];
  for (const [relPath, updatedAt] of Object.entries(s.folders)) {
    entries.push({
      relPath,
      name: getBaseName(relPath),
      isDir: true,
      updatedAt,
      size: 0,
    });
  }
  for (const [relPath, file] of Object.entries(s.files)) {
    entries.push({
      relPath,
      name: getBaseName(relPath),
      isDir: false,
      updatedAt: file.updatedAt,
      size: file.content.length,
    });
  }
  return entries;
}

function browserDocsRead(relPath: string): DocFileContent {
  const norm = normalizeDocRelPath(relPath);
  const s = loadBrowserDocs();
  const file = s.files[norm];
  if (!file) throw new Error(`Document not found: ${norm}`);
  return { relPath: norm, content: file.content, updatedAt: file.updatedAt };
}

function browserDocsWrite(relPath: string, content: string): DocFileContent {
  const norm = normalizeDocRelPath(relPath);
  const s = loadBrowserDocs();
  const now = Date.now();
  const parts = norm.split('/');
  for (let i = 1; i < parts.length; i += 1) {
    const dir = parts.slice(0, i).join('/');
    if (!s.folders[dir]) s.folders[dir] = now;
  }
  s.files[norm] = { content, updatedAt: now };
  saveBrowserDocs(s);
  return { relPath: norm, content, updatedAt: now };
}

function browserDocsCreateFolder(relPath: string): DocEntry {
  const norm = normalizeDocRelPath(relPath);
  const s = loadBrowserDocs();
  const now = Date.now();
  const parts = norm.split('/');
  for (let i = 1; i <= parts.length; i += 1) {
    const dir = parts.slice(0, i).join('/');
    if (!s.folders[dir]) s.folders[dir] = now;
  }
  saveBrowserDocs(s);
  return { relPath: norm, name: getBaseName(norm), isDir: true, updatedAt: now, size: 0 };
}

function browserDocsRename(oldRelPath: string, newRelPath: string): string {
  const oldNorm = normalizeDocRelPath(oldRelPath);
  const newNorm = normalizeDocRelPath(newRelPath);
  const s = loadBrowserDocs();
  if (s.files[oldNorm]) {
    if (s.files[newNorm] && oldNorm !== newNorm) throw new Error(`Target exists: ${newNorm}`);
    s.files[newNorm] = s.files[oldNorm];
    if (oldNorm !== newNorm) delete s.files[oldNorm];
  } else if (s.folders[oldNorm]) {
    if (newNorm.startsWith(`${oldNorm}/`)) throw new Error('Cannot move folder into itself');
    const prefix = `${oldNorm}/`;
    const nextFolders: Record<string, number> = {};
    for (const [k, v] of Object.entries(s.folders)) {
      if (k === oldNorm) nextFolders[newNorm] = v;
      else if (k.startsWith(prefix)) nextFolders[`${newNorm}/${k.slice(prefix.length)}`] = v;
      else nextFolders[k] = v;
    }
    const nextFiles: Record<string, { content: string; updatedAt: number }> = {};
    for (const [k, v] of Object.entries(s.files)) {
      if (k.startsWith(prefix)) nextFiles[`${newNorm}/${k.slice(prefix.length)}`] = v;
      else nextFiles[k] = v;
    }
    s.folders = nextFolders;
    s.files = nextFiles;
  }
  saveBrowserDocs(s);
  return newNorm;
}

function browserDocsDelete(relPath: string) {
  const norm = normalizeDocRelPath(relPath);
  const s = loadBrowserDocs();
  const prefix = `${norm}/`;
  delete s.files[norm];
  delete s.folders[norm];
  for (const k of Object.keys(s.files)) {
    if (k.startsWith(prefix)) delete s.files[k];
  }
  for (const k of Object.keys(s.folders)) {
    if (k.startsWith(prefix)) delete s.folders[k];
  }
  saveBrowserDocs(s);
}

function browserDocsSearch(query: string): DocSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const s = loadBrowserDocs();
  const hits: DocSearchHit[] = [];
  for (const [relPath, file] of Object.entries(s.files)) {
    const name = getBaseName(relPath);
    if (
      relPath.toLowerCase().includes(q) ||
      name.toLowerCase().includes(q) ||
      file.content.toLowerCase().includes(q)
    ) {
      const matchedLine =
        file.content
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => l.toLowerCase().includes(q)) ||
        file.content.split(/\r?\n/).find((l) => l.trim()) ||
        '';
      hits.push({
        relPath,
        name,
        snippet: matchedLine.slice(0, 100),
        updatedAt: file.updatedAt,
      });
    }
  }
  return hits.slice(0, 20);
}

// ================= NATIVE FILE DRAG-DROP ZONE REGISTRY =================
export interface NativeDropZone {
  getElement: () => HTMLElement | null;
  priority?: number;
  onHoverChange?: (hovering: boolean) => void;
  onDropPaths: (paths: string[]) => void;
}

const nativeDropZones = new Set<NativeDropZone>();
let nativeDropListening = false;

function hitTestZone(x: number, y: number): NativeDropZone | null {
  const dpr = window.devicePixelRatio || 1;
  const candidates: Array<{ zone: NativeDropZone; prio: number; area: number }> = [];
  for (const zone of nativeDropZones) {
    const el = zone.getElement();
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const lx = x / dpr;
    const ly = y / dpr;
    const hitScaled = lx >= rect.left && lx <= rect.right && ly >= rect.top && ly <= rect.bottom;
    const hitRaw = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    if (hitScaled || hitRaw) {
      candidates.push({
        zone,
        prio: zone.priority ?? 0,
        area: rect.width * rect.height,
      });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.prio - a.prio || a.area - b.area);
  return candidates[0].zone;
}

function ensureNativeDropListener() {
  if (nativeDropListening || !isTauriRuntime()) return;
  nativeDropListening = true;
  void getCurrentWebview()
    .onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === 'enter' || payload.type === 'over') {
        const hit = hitTestZone(payload.position.x, payload.position.y);
        for (const z of nativeDropZones) {
          z.onHoverChange?.(z === hit);
        }
      } else if (payload.type === 'leave') {
        for (const z of nativeDropZones) {
          z.onHoverChange?.(false);
        }
      } else if (payload.type === 'drop') {
        for (const z of nativeDropZones) {
          z.onHoverChange?.(false);
        }
        if (!payload.paths || payload.paths.length === 0) return;
        let target = hitTestZone(payload.position.x, payload.position.y);
        if (!target && nativeDropZones.size > 0) {
          const all = [...nativeDropZones].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
          target = all[0] ?? null;
        }
        target?.onDropPaths(payload.paths);
      }
    })
    .catch(() => {
      nativeDropListening = false;
    });
}

export function registerNativeDropZone(zone: NativeDropZone): () => void {
  nativeDropZones.add(zone);
  ensureNativeDropListener();
  return () => {
    zone.onHoverChange?.(false);
    nativeDropZones.delete(zone);
  };
}
