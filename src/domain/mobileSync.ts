import type { BaseEntity } from './types';

/**
 * Record-level LWW merge used when the Rust mobile HTTP server pushes updated/deleted
 * items into the desktop Zustand store without triggering a full-shard overwrite.
 */
export function mergeMobileShardItems<T extends BaseEntity>(
  existing: T[],
  incoming: T[],
  normalize?: (item: T) => T,
): T[] {
  if (!incoming.length) return existing;
  const next = [...existing];
  const indexById = new Map<string, number>();
  next.forEach((item, idx) => indexById.set(item.id, idx));

  const prepends: T[] = [];
  for (const raw of incoming) {
    const item = normalize ? normalize(raw) : raw;
    if (!item || !item.id) continue;
    const idx = indexById.get(item.id);
    if (idx === undefined) {
      prepends.push(item);
      indexById.set(item.id, -1);
    } else if (idx >= 0) {
      const prev = next[idx];
      if ((item.updatedAt || 0) >= (prev.updatedAt || 0)) {
        next[idx] = item;
      }
    }
  }

  return prepends.length > 0 ? [...prepends, ...next] : next;
}

/** Extracts the one-time pairing token from `window.location.search`. */
export function extractPairTokenFromSearch(search: string): string | null {
  if (!search) return null;
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const token = params.get('pair')?.trim() || '';
    return token.length >= 16 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Computes portable relative attachment path from a `<dataDir>/docs/.../*.md` file
 * to `<dataDir>/attachments/<file>`, preserving ADR-014 compatibility with VS Code / Typora.
 */
export function buildRelativeAttachmentMarkdown(
  docRelPath: string,
  attRelPath: string,
  altName = 'image',
): string {
  const cleanDoc = docRelPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const cleanAtt = attRelPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = cleanDoc ? cleanDoc.split('/').filter(Boolean) : [];
  // Document lives inside `<dataDir>/docs/<segments...>`, so depth from `<dataDir>` is `segments.length`
  // (e.g. `hello.md` -> 1 level `../attachments/...`; `a/hello.md` -> 2 levels `../../attachments/...`).
  const depth = Math.max(1, segments.length);
  const prefix = '../'.repeat(depth);
  const safeAlt = altName.replace(/[\[\]\r\n]/g, '').trim() || 'image';
  return `![${safeAlt}](${prefix}${cleanAtt})`;
}

/**
 * Converts portable relative attachment image URLs inside rendered Markdown HTML or source
 * (`../attachments/foo.png`, `../../attachments/foo.png`, `attachments/foo.png`) into
 * mobile HTTP API URLs (`/api/attachments/foo.png`).
 */
export function attachmentRelPathToMobileUrl(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  const match = /^(?:\.\.\/)*attachments\/([^/?#\\\r\n]+)$/.exec(trimmed);
  if (!match) return null;
  let filename = match[1];
  try {
    filename = decodeURIComponent(filename);
  } catch {
    // keep raw filename if malformed percent encoding
  }
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..') || filename.startsWith('.')) {
    return null;
  }
  return `/api/attachments/${encodeURIComponent(filename)}`;
}

/**
 * Rewrites `src` attributes on `<img>` tags in rendered HTML so local workspace attachments
 * load smoothly on mobile browsers via `/api/attachments/<filename>`.
 */
export function rewriteRenderedHtmlImagesForMobile(html: string): string {
  return html.replace(
    /(<img\b[^>]*?\bsrc=")([^"]+)("[^>]*>)/gi,
    (full, prefix: string, src: string, suffix: string) => {
      const mobileUrl = attachmentRelPathToMobileUrl(src);
      if (!mobileUrl) return full;
      return `${prefix}${mobileUrl}${suffix}`;
    },
  );
}

/**
 * Toggles the N-th (0-based) Markdown task list checkbox (`- [ ]` <-> `- [x]`)
 * while skipping lines inside fenced code blocks.
 */
export function toggleCheckboxInMarkdown(markdown: string, targetIndex: number): string | null {
  if (targetIndex < 0) return null;
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let inFence = false;
  let count = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const m = /^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\]\s*.*)$/.exec(line);
    if (m) {
      if (count === targetIndex) {
        const nextMark = m[2] === ' ' ? 'x' : ' ';
        lines[i] = `${m[1]}${nextMark}${m[3]}`;
        return lines.join('\n');
      }
      count += 1;
    }
  }
  return null;
}

/** Formats remaining pairing code TTL as `M:SS`, returning `0:00` once expired. */
export function formatPairingCountdown(expiresAtMs: number | null, nowMs: number): string {
  if (!expiresAtMs) return '0:00';
  const remainingSec = Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000));
  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
