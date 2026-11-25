import { createId, isActive, type StickyColor, type StickyNote } from './types';
import { markdownToPlainText } from './markdown';

export const STICKY_COLORS: readonly StickyColor[] = [
  'yellow',
  'blue',
  'green',
  'pink',
  'purple',
  'graphite',
] as const;

export const STICKY_OPACITY_PRESETS: readonly number[] = [1, 0.92, 0.82, 0.72] as const;

export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && (STICKY_COLORS as readonly string[]).includes(value);
}

export function normalizeSticky(raw: Partial<StickyNote>): StickyNote {
  const now = Date.now();
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now;
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;
  const normalized: StickyNote = {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `stk-${createId()}`,
    title: typeof raw.title === 'string' ? raw.title : '',
    content: typeof raw.content === 'string' ? raw.content : '',
    color: isStickyColor(raw.color) ? raw.color : 'yellow',
    pinned: typeof raw.pinned === 'boolean' ? raw.pinned : true,
    autoOpen: typeof raw.autoOpen === 'boolean' ? raw.autoOpen : false,
    createdAt,
    updatedAt,
  };
  if (raw.deletedAt !== undefined) {
    normalized.deletedAt = raw.deletedAt;
  }
  return normalized;
}

export function createStickyNote(
  input?: Partial<Pick<StickyNote, 'title' | 'content' | 'color' | 'pinned' | 'autoOpen'>>,
  nowTs: number = Date.now(),
): StickyNote {
  return {
    id: `stk-${createId()}`,
    title: (input?.title ?? '').trim(),
    content: input?.content ?? '',
    color: input?.color && isStickyColor(input.color) ? input.color : 'yellow',
    pinned: input?.pinned ?? true,
    autoOpen: input?.autoOpen ?? false,
    createdAt: nowTs,
    updatedAt: nowTs,
  };
}

export function isStickyEmpty(sticky: Pick<StickyNote, 'title' | 'content'>): boolean {
  const titleEmpty = !(sticky.title || '').trim();
  const rawContentEmpty = !(sticky.content || '').trim();
  if (titleEmpty && rawContentEmpty) return true;
  if (!titleEmpty) return false;
  const plain = markdownToPlainText(sticky.content || '').trim();
  return plain.length === 0;
}

export function getStickyDisplayTitle(sticky: StickyNote, fallbackUntitled: string): string {
  const trimmedTitle = sticky.title.trim();
  if (trimmedTitle) return trimmedTitle;
  const plain = markdownToPlainText(sticky.content || '');
  const firstLine = plain
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (firstLine) return firstLine.slice(0, 60);
  return fallbackUntitled;
}

export function getStickyPreviewText(sticky: StickyNote): string {
  const plain = markdownToPlainText(sticky.content || '');
  const parts: string[] = [];
  const legacyTitle = (sticky.title || '').trim();
  if (legacyTitle) parts.push(legacyTitle);
  const bodyLines = plain
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (bodyLines.length > 0) parts.push(bodyLines.join('\n'));
  return parts.join('\n');
}

export function getStickyChecklistStats(content: string): { done: number; total: number } {
  const lines = (content || '').split(/\r?\n/);
  let total = 0;
  let done = 0;
  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+/);
    if (match) {
      total += 1;
      if (match[1].toLowerCase() === 'x') {
        done += 1;
      }
    }
  }
  return { done, total };
}

export type StickyStatusFilter = 'all' | 'open' | 'autoOpen';

export function filterAndSortStickies(
  stickies: StickyNote[],
  opts: {
    query: string;
    status: StickyStatusFilter;
    color: StickyColor | '';
    openIds: Set<string>;
  },
): StickyNote[] {
  const q = opts.query.trim().toLowerCase();
  return stickies
    .filter((s) => isActive(s) && !isStickyEmpty(s))
    .filter((s) => {
      if (opts.status === 'open' && !opts.openIds.has(s.id)) return false;
      if (opts.status === 'autoOpen' && !s.autoOpen) return false;
      if (opts.color && s.color !== opts.color) return false;
      if (!q) return true;
      const plain = markdownToPlainText(s.content || '').toLowerCase();
      return (
        s.title.toLowerCase().includes(q) ||
        s.content.toLowerCase().includes(q) ||
        plain.includes(q)
      );
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
