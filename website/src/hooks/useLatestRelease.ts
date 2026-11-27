import { useEffect, useState } from 'react';
import { FALLBACK_VERSION, RELEASES_URL, REPO_SLUG } from '@/i18n/copy';

export type VisitorOS = 'mac' | 'windows' | 'other';

export interface ReleaseInfo {
  version: string;
  tagName: string;
  publishedAt: string;
  body: string;
  htmlUrl: string;
  macDmgUrl: string;
  winExeUrl: string;
  winMsiUrl: string;
  isLive: boolean;
  loading: boolean;
}

const CACHE_KEY = 'anchor_site_latest_release_v1';
const CACHE_TTL_MS = 15 * 60 * 1000;

interface CachedPayload {
  fetchedAt: number;
  data: Omit<ReleaseInfo, 'loading'>;
}

export function detectVisitorOS(): VisitorOS {
  if (typeof navigator === 'undefined') return 'mac';
  const ua = `${navigator.userAgent} ${navigator.platform || ''}`.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac') || ua.includes('darwin')) return 'mac';
  return 'other';
}

const FALLBACK_DATA: Omit<ReleaseInfo, 'loading'> = {
  version: FALLBACK_VERSION,
  tagName: `v${FALLBACK_VERSION}`,
  publishedAt: '2026-11-27',
  body: '',
  htmlUrl: `${RELEASES_URL}/latest`,
  macDmgUrl: `${RELEASES_URL}/latest`,
  winExeUrl: `${RELEASES_URL}/latest`,
  winMsiUrl: `${RELEASES_URL}/latest`,
  isLive: false,
};

function readCache(): Omit<ReleaseInfo, 'loading'> | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPayload;
    if (!parsed || Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(data: Omit<ReleaseInfo, 'loading'>): void {
  try {
    const payload: CachedPayload = { fetchedAt: Date.now(), data };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore private-mode storage restrictions
  }
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubReleaseResponse {
  tag_name?: string;
  published_at?: string;
  body?: string;
  html_url?: string;
  assets?: GitHubAsset[];
}

export function useLatestRelease(): { release: ReleaseInfo; visitorOS: VisitorOS } {
  const [visitorOS] = useState<VisitorOS>(() => detectVisitorOS());
  const [release, setRelease] = useState<ReleaseInfo>(() => {
    const cached = readCache();
    if (cached) return { ...cached, loading: false };
    return { ...FALLBACK_DATA, loading: true };
  });

  useEffect(() => {
    const cached = readCache();
    if (cached) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);

    fetch(`https://api.github.com/repos/${REPO_SLUG}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<GitHubReleaseResponse>;
      })
      .then((json) => {
        const tag = (json.tag_name || '').trim();
        if (!tag) throw new Error('Empty release tag');
        const assets = json.assets || [];
        const htmlUrl = json.html_url || `${RELEASES_URL}/tag/${tag}`;
        const macDmg =
          assets.find((a) => a.name.toLowerCase().endsWith('.dmg'))?.browser_download_url || htmlUrl;
        const winExe =
          assets.find((a) => a.name.toLowerCase().endsWith('.exe'))?.browser_download_url || htmlUrl;
        const winMsi =
          assets.find((a) => a.name.toLowerCase().endsWith('.msi'))?.browser_download_url || htmlUrl;

        const data: Omit<ReleaseInfo, 'loading'> = {
          version: tag.replace(/^v/i, ''),
          tagName: tag,
          publishedAt: (json.published_at || '').slice(0, 10),
          body: json.body || '',
          htmlUrl,
          macDmgUrl: macDmg,
          winExeUrl: winExe,
          winMsiUrl: winMsi,
          isLive: true,
        };
        writeCache(data);
        setRelease({ ...data, loading: false });
      })
      .catch(() => {
        setRelease({ ...FALLBACK_DATA, loading: false });
      })
      .finally(() => {
        window.clearTimeout(timer);
      });

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  return { release, visitorOS };
}
