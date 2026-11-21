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
import type {
  AppConfig,
  Attachment,
  GitAuth,
  GitConnectionResult,
  GitStatus,
  Lang,
  OrphanCleanupResult,
  SnapshotInfo,
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

const WEB_CONFIG_KEY = 'anchor_web_config_v1';
const WEB_DATA_KEY = 'anchor_web_data_v1';

const DEFAULT_WEB_CONFIG: AppConfig = {
  dataDir: '~/Documents/Anchor (Browser Preview)',
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
};

interface RawWorkspaceBundle {
  meta: WorkspaceData['meta'];
  tasks: WorkspaceData['tasks'];
  projects: WorkspaceData['projects'];
  notes: WorkspaceData['notes'];
  members: WorkspaceData['members'];
  assignments: WorkspaceData['assignments'];
  daily: WorkspaceData['daily'];
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
    members: Array.isArray(raw.members) ? raw.members : [],
    assignments: Array.isArray(raw.assignments) ? raw.assignments : [],
    daily: Array.isArray(raw.daily) ? raw.daily : [],
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
      return invoke<AppConfig>('get_app_config');
    }
    try {
      const raw = localStorage.getItem(WEB_CONFIG_KEY);
      if (raw) return { ...DEFAULT_WEB_CONFIG, ...JSON.parse(raw) };
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
        data: normalizeWorkspace(parsed),
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
    // Browser fallback: trigger download
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
