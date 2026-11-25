import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { isNewerVersion } from '@/domain/semver';
import { isTauriRuntime, storageApi } from '@/services/storage';

export const APP_VERSION = '0.9.3';
export const REPO_SLUG = '779235394/anchor';
export const RELEASES_FALLBACK_URL = `https://github.com/${REPO_SLUG}/releases/latest`;
export const AUTO_UPDATE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function shouldShowUpdatePrompt(params: {
  available: boolean;
  version: string;
  ignoredVersion?: string;
  snoozedVersion?: string | null;
}): boolean {
  if (!params.available) return false;
  const clean = params.version.trim().replace(/^v/i, '');
  if (!clean) return false;
  const ignored = (params.ignoredVersion || '').trim().replace(/^v/i, '');
  const snoozed = (params.snoozedVersion || '').trim().replace(/^v/i, '');
  if (ignored && ignored === clean) return false;
  if (snoozed && snoozed === clean) return false;
  return true;
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

export interface UpdateState {
  status: UpdateStatus;
  version: string;
  body: string;
  date: string;
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number;
  error: string | null;
  fallbackUrl: string;
}

export const INITIAL_UPDATE_STATE: UpdateState = {
  status: 'idle',
  version: '',
  body: '',
  date: '',
  downloadedBytes: 0,
  totalBytes: null,
  percent: 0,
  error: null,
  fallbackUrl: RELEASES_FALLBACK_URL,
};

let pendingNativeUpdate: Update | null = null;

export interface CheckUpdateOutcome {
  available: boolean;
  version: string;
  body: string;
  date: string;
  fallbackUrl: string;
  canInstallInApp: boolean;
}

export async function checkForAppUpdate(): Promise<CheckUpdateOutcome> {
  if (isTauriRuntime()) {
    const update = await check();
    if (!update) {
      pendingNativeUpdate = null;
      return {
        available: false,
        version: APP_VERSION,
        body: '',
        date: '',
        fallbackUrl: RELEASES_FALLBACK_URL,
        canInstallInApp: true,
      };
    }
    pendingNativeUpdate = update;
    const cleanVer = update.version.replace(/^v/i, '');
    return {
      available: true,
      version: cleanVer,
      body: update.body || '',
      date: update.date || '',
      fallbackUrl: `https://github.com/${REPO_SLUG}/releases/tag/v${cleanVer}`,
      canInstallInApp: true,
    };
  }

  // Browser preview fallback using GitHub Releases API
  const rel = await storageApi.checkLatestRelease(REPO_SLUG);
  const available = !!rel.tagName && isNewerVersion(rel.tagName, APP_VERSION);
  return {
    available,
    version: rel.tagName.replace(/^v/i, '') || APP_VERSION,
    body: rel.body || '',
    date: rel.publishedAt || '',
    fallbackUrl: rel.htmlUrl || RELEASES_FALLBACK_URL,
    canInstallInApp: false,
  };
}

export async function downloadAndInstallPendingUpdate(
  onProgress: (downloadedBytes: number, totalBytes: number | null, percent: number) => void,
): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error('In-app update requires the desktop app.');
  }
  if (!pendingNativeUpdate) {
    const fresh = await check();
    if (!fresh) {
      throw new Error('No update package available.');
    }
    pendingNativeUpdate = fresh;
  }

  let downloaded = 0;
  let total: number | null = null;

  await pendingNativeUpdate.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? null;
      downloaded = 0;
      onProgress(0, total, 0);
    } else if (event.event === 'Progress') {
      downloaded += event.data.chunkLength;
      const pct = total && total > 0 ? Math.min(99, Math.round((downloaded / total) * 100)) : 0;
      onProgress(downloaded, total, pct);
    } else if (event.event === 'Finished') {
      onProgress(downloaded, total ?? downloaded, 100);
    }
  });
}

export async function relaunchApplication(): Promise<void> {
  if (isTauriRuntime()) {
    await relaunch();
  }
}

export function formatBytesMb(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
