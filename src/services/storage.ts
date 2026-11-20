import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  createEmptyWorkspace,
  normalizeWorkspace,
} from '@/domain/merge';
import { todayStr } from '@/domain/date';
import type {
  AppConfig,
  SnapshotInfo,
  WorkspaceData,
  WorkspaceLoadResult,
} from '@/domain/types';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const WEB_CONFIG_KEY = 'clarity_workbench_web_config_v1';
const WEB_DATA_KEY = 'clarity_workbench_web_data_v1';

const DEFAULT_WEB_CONFIG: AppConfig = {
  dataDir: '~/Documents/ClarityWorkbench (Browser Preview)',
  theme: 'system',
  accent: 'blue',
  lang: 'zh',
  closeToTray: true,
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

  async updateTrayBadge(openToday: number, overdue: number): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('update_tray_badge_cmd', { openToday, overdue });
    }
  },

  async onExternalChange(cb: () => void): Promise<UnlistenFn> {
    if (isTauriRuntime()) {
      return listen('workspace://external-change', () => cb());
    }
    return () => {};
  },
};
