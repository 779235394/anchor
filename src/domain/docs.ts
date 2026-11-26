import type { Note } from './types';
import { markdownToPlainText } from './markdown';

export interface DocEntry {
  relPath: string;
  name: string;
  isDir: boolean;
  updatedAt: number;
  size: number;
}

export interface ExternalDocAssetRef {
  rawPath: string;
  kind: 'absolute' | 'relative';
  isImage: boolean;
}

export interface DocFileContent {
  relPath: string;
  content: string;
  updatedAt: number;
}

export interface DocSearchHit {
  relPath: string;
  name: string;
  snippet: string;
  updatedAt: number;
}

export interface DocTreeNode {
  entry: DocEntry;
  children: DocTreeNode[];
}

export interface DocTocItem {
  id: string;
  level: 1 | 2 | 3;
  text: string;
}

export interface DocStats {
  words: number;
  chars: number;
  readMinutes: number;
}

export type DocSortBy = 'manual' | 'name' | 'updated';
export type DocOrderMap = Record<string, string[]>;
export type DocTemplateKind = 'blank' | 'daily' | 'meeting';

export const DEFAULT_DOCS_SIDEBAR_WIDTH = 252;
export const MIN_DOCS_SIDEBAR_WIDTH = 200;
export const MAX_DOCS_SIDEBAR_WIDTH = 480;
const MIN_DOCS_EDITOR_RESERVE = 420;

export function clampDocsSidebarWidth(
  rawWidth: number | undefined | null,
  viewportWidth?: number,
): number {
  const base =
    typeof rawWidth === 'number' && Number.isFinite(rawWidth)
      ? Math.round(rawWidth)
      : DEFAULT_DOCS_SIDEBAR_WIDTH;
  const dynamicMax =
    typeof viewportWidth === 'number' && Number.isFinite(viewportWidth) && viewportWidth > 0
      ? Math.max(MIN_DOCS_SIDEBAR_WIDTH, Math.min(MAX_DOCS_SIDEBAR_WIDTH, Math.floor(viewportWidth - MIN_DOCS_EDITOR_RESERVE)))
      : MAX_DOCS_SIDEBAR_WIDTH;
  return Math.max(MIN_DOCS_SIDEBAR_WIDTH, Math.min(dynamicMax, base));
}

/**
 * Only flush/write back to disk when the user actually edited the document and the content
 * differs from what is already stored on disk. Prevents untouched reads from rewriting files
 * when TipTap round-trip serialization normalizes trailing newlines or Markdown syntax.
 */
export function shouldFlushDocEditor(
  hasUserEdit: boolean,
  nextContent: string,
  diskContent: string,
): boolean {
  if (!hasUserEdit) return false;
  return nextContent !== diskContent;
}

export function normalizeDocRelPath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
}

export function getParentRelPath(relPath: string): string {
  const norm = normalizeDocRelPath(relPath);
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? '' : norm.slice(0, idx);
}

export function getBaseName(relPath: string): string {
  const norm = normalizeDocRelPath(relPath);
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? norm : norm.slice(idx + 1);
}

export function stripMdExtension(name: string): string {
  return name.replace(/\.md$/i, '');
}

export function sanitizeEntryName(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/g, '')
    .trim();
}

export function ensureMdFileName(raw: string): string {
  const clean = sanitizeEntryName(stripMdExtension(raw));
  return `${clean || '未命名文档'}.md`;
}

export function joinDocRelPath(parentDir: string, name: string): string {
  const p = normalizeDocRelPath(parentDir);
  const n = normalizeDocRelPath(name);
  if (!p) return n;
  if (!n) return p;
  return `${p}/${n}`;
}

function compareNamesNatural(a: string, b: string): number {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function buildDocTree(
  entries: DocEntry[],
  sortBy: DocSortBy = 'manual',
  docOrder?: DocOrderMap,
): DocTreeNode[] {
  const nodeMap = new Map<string, DocTreeNode>();
  const roots: DocTreeNode[] = [];

  for (const entry of entries) {
    nodeMap.set(entry.relPath, { entry, children: [] });
  }

  for (const entry of entries) {
    const node = nodeMap.get(entry.relPath)!;
    const parentPath = getParentRelPath(entry.relPath);
    if (parentPath && nodeMap.has(parentPath)) {
      nodeMap.get(parentPath)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortList = (list: DocTreeNode[], parentPath: string) => {
    const savedNames = sortBy === 'manual' && docOrder ? docOrder[parentPath] : undefined;
    const rankMap = new Map<string, number>();
    if (Array.isArray(savedNames)) {
      savedNames.forEach((name, idx) => {
        if (!rankMap.has(name)) rankMap.set(name, idx);
      });
    }

    list.sort((a, b) => {
      if (a.entry.isDir !== b.entry.isDir) return a.entry.isDir ? -1 : 1;
      if (sortBy === 'manual' && rankMap.size > 0) {
        const ra = rankMap.get(a.entry.name);
        const rb = rankMap.get(b.entry.name);
        if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb;
        if (ra !== undefined && rb === undefined) return -1;
        if (ra === undefined && rb !== undefined) return 1;
      }
      if (sortBy === 'updated' && !a.entry.isDir) {
        if (b.entry.updatedAt !== a.entry.updatedAt) {
          return b.entry.updatedAt - a.entry.updatedAt;
        }
      }
      return compareNamesNatural(a.entry.name, b.entry.name);
    });

    for (const n of list) {
      if (n.children.length > 0) {
        sortList(n.children, n.entry.relPath);
      }
    }
  };
  sortList(roots, '');

  return roots;
}

function getOrderedSameKindNames(
  entries: DocEntry[],
  docOrder: DocOrderMap,
  parentDir: string,
  isDir: boolean,
): string[] {
  const normParent = normalizeDocRelPath(parentDir);
  const siblings = entries.filter(
    (e) => e.isDir === isDir && getParentRelPath(e.relPath) === normParent,
  );
  const saved = docOrder[normParent] ?? [];
  const rankMap = new Map<string, number>();
  saved.forEach((name, idx) => {
    if (!rankMap.has(name)) rankMap.set(name, idx);
  });
  siblings.sort((a, b) => {
    const ra = rankMap.get(a.name);
    const rb = rankMap.get(b.name);
    if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb;
    if (ra !== undefined && rb === undefined) return -1;
    if (ra === undefined && rb !== undefined) return 1;
    return compareNamesNatural(a.name, b.name);
  });
  return siblings.map((s) => s.name);
}

/**
 * Reorders `movedRelPath` before or after `targetRelPath` within `parentDir`, preserving
 * the custom order of the opposite entry kind (folders vs files) inside `docOrder[parentDir]`.
 */
export function reorderDocSiblings(
  entries: DocEntry[],
  docOrder: DocOrderMap,
  parentDir: string,
  movedRelPath: string,
  targetRelPath: string,
  position: 'before' | 'after',
): DocOrderMap {
  const normParent = normalizeDocRelPath(parentDir);
  const movedEntry = entries.find((e) => e.relPath === movedRelPath);
  const targetEntry = entries.find((e) => e.relPath === targetRelPath);
  if (!movedEntry || !targetEntry) return docOrder;
  if (movedEntry.isDir !== targetEntry.isDir) return docOrder;
  if (movedEntry.relPath === targetEntry.relPath) return docOrder;

  const sameKind = getOrderedSameKindNames(entries, docOrder, normParent, movedEntry.isDir);
  const otherKind = getOrderedSameKindNames(entries, docOrder, normParent, !movedEntry.isDir);

  const withoutMoved = sameKind.filter((n) => n !== movedEntry.name);
  const targetIdx = withoutMoved.indexOf(targetEntry.name);
  if (targetIdx === -1) return docOrder;
  const insertAt = position === 'before' ? targetIdx : targetIdx + 1;
  withoutMoved.splice(insertAt, 0, movedEntry.name);

  const combined = movedEntry.isDir
    ? [...withoutMoved, ...otherKind]
    : [...otherKind, ...withoutMoved];

  return {
    ...docOrder,
    [normParent]: combined,
  };
}

/**
 * Keeps custom `docOrder` in sync whenever a doc or folder is renamed or moved across folders.
 */
export function remapDocOrderOnRename(
  docOrder: DocOrderMap,
  oldRelPath: string,
  newRelPath: string,
  isDir: boolean,
  insertHint?: { targetName: string; position: 'before' | 'after' },
): DocOrderMap {
  const oldNorm = normalizeDocRelPath(oldRelPath);
  const newNorm = normalizeDocRelPath(newRelPath);
  if (!oldNorm || !newNorm || oldNorm === newNorm) return docOrder;

  const oldParent = getParentRelPath(oldNorm);
  const newParent = getParentRelPath(newNorm);
  const oldName = getBaseName(oldNorm);
  const newName = getBaseName(newNorm);

  const next: DocOrderMap = {};
  const oldPrefix = `${oldNorm}/`;

  for (const [dirKey, names] of Object.entries(docOrder)) {
    const normKey = normalizeDocRelPath(dirKey);
    let mappedKey = normKey;
    if (isDir) {
      if (normKey === oldNorm) {
        mappedKey = newNorm;
      } else if (normKey.startsWith(oldPrefix)) {
        mappedKey = `${newNorm}/${normKey.slice(oldPrefix.length)}`;
      }
    }
    next[mappedKey] = [...names];
  }

  if (oldParent === newParent) {
    if (next[oldParent]) {
      next[oldParent] = next[oldParent].map((n) => (n === oldName ? newName : n));
    }
  } else {
    if (next[oldParent]) {
      const filtered = next[oldParent].filter((n) => n !== oldName);
      if (filtered.length > 0) {
        next[oldParent] = filtered;
      } else {
        delete next[oldParent];
      }
    }

    if (insertHint || next[newParent]) {
      const baseList = (next[newParent] ?? []).filter((n) => n !== newName);
      if (insertHint) {
        const idx = baseList.indexOf(insertHint.targetName);
        if (idx !== -1) {
          const at = insertHint.position === 'before' ? idx : idx + 1;
          baseList.splice(at, 0, newName);
        } else {
          baseList.push(newName);
        }
      } else {
        baseList.push(newName);
      }
      next[newParent] = baseList;
    }
  }

  return next;
}

/**
 * Removes deleted files/folders (and any nested folder keys) from `docOrder`.
 */
export function pruneDocOrderOnDelete(
  docOrder: DocOrderMap,
  deletedRelPath: string,
  isDir: boolean,
): DocOrderMap {
  const norm = normalizeDocRelPath(deletedRelPath);
  if (!norm) return docOrder;
  const parent = getParentRelPath(norm);
  const name = getBaseName(norm);
  const prefix = `${norm}/`;

  const next: DocOrderMap = {};
  for (const [dirKey, names] of Object.entries(docOrder)) {
    const normKey = normalizeDocRelPath(dirKey);
    if (isDir && (normKey === norm || normKey.startsWith(prefix))) {
      continue;
    }
    if (normKey === parent) {
      const filtered = names.filter((n) => n !== name);
      if (filtered.length > 0) next[normKey] = filtered;
    } else {
      next[normKey] = [...names];
    }
  }
  return next;
}

export function extractToc(markdown: string): DocTocItem[] {
  const lines = (markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const toc: DocTocItem[] = [];
  let inFence = false;
  let headingIdx = 0;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (m) {
      const level = m[1].length as 1 | 2 | 3;
      const text = m[2]
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim();
      if (text) {
        toc.push({
          id: `doc-heading-${headingIdx}`,
          level,
          text,
        });
        headingIdx += 1;
      }
    }
  }

  return toc;
}

export function countDocStats(markdown: string): DocStats {
  const plain = (markdown || '')
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```[^\n]*/g, ''))
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*`~_|=-]/g, ' ')
    .trim();

  if (!plain) return { words: 0, chars: 0, readMinutes: 0 };

  const cjkMatches = plain.match(/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/g) || [];
  const latinWords = plain
    .replace(/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const words = cjkMatches.length + latinWords.length;
  const chars = plain.replace(/\s+/g, '').length;
  const readMinutes = Math.max(1, Math.ceil(words / 300));
  return { words, chars, readMinutes };
}

/**
 * Computes a portable relative Markdown image path from `<dataDir>/docs/<docRelPath>`
 * to `<dataDir>/<attachmentRelPath>` (e.g. `attachments/abc.png` -> `../attachments/abc.png`).
 */
export function computeAttachmentRelPath(docRelPath: string, attachmentRelPath: string): string {
  const normDoc = normalizeDocRelPath(docRelPath);
  const normAtt = normalizeDocRelPath(attachmentRelPath);
  const depth = normDoc ? normDoc.split('/').length : 1; // docs/ itself adds 1 level
  return `${'../'.repeat(depth)}${normAtt}`;
}

/**
 * Extracts a workspace-relative `attachments/...` path from a Markdown image src
 * (e.g. `../../attachments/img.png` -> `attachments/img.png`), or returns null for external URLs.
 */
export function extractWorkspaceAttachmentRelPath(src: string): string | null {
  const clean = (src || '').trim().replace(/\\/g, '/');
  if (!clean || /^(https?:|data:|blob:)/i.test(clean)) return null;
  const stripped = clean.replace(/^(\.\.\/|\.\/)+/, '');
  if (stripped.startsWith('attachments/') && !stripped.includes('..')) {
    return stripped;
  }
  return null;
}

function isAbsoluteLocalRef(raw: string): boolean {
  const s = raw.trim();
  if (/^file:\/\//i.test(s)) return true;
  if (/^~\//.test(s)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(s)) return true;
  if (s.startsWith('/') && !s.startsWith('//')) return true;
  return false;
}

/**
 * Finds local image/file asset references in a Markdown document that are NOT already
 * stored in Anchor's `<dataDir>/attachments/` directory (ignoring fenced code blocks & URLs).
 */
export function extractExternalMarkdownAssets(markdown: string): ExternalDocAssetRef[] {
  const lines = (markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const seen = new Set<string>();
  const results: ExternalDocAssetRef[] = [];
  let inFence = false;

  const inspect = (rawTarget: string, isImage: boolean) => {
    let cleaned = rawTarget.trim();
    if (cleaned.startsWith('<') && cleaned.endsWith('>')) {
      cleaned = cleaned.slice(1, -1).trim();
    } else {
      // Strip optional Markdown title: `path/to/img.png "title"`
      const spaceIdx = cleaned.search(/\s+["']/);
      if (spaceIdx > 0) cleaned = cleaned.slice(0, spaceIdx).trim();
    }
    if (!cleaned) return;
    if (/^(https?:|mailto:|data:|blob:|#)/i.test(cleaned)) return;
    if (extractWorkspaceAttachmentRelPath(cleaned)) return;
    // Skip links to other .md docs or non-file paths without an extension
    if (!isImage) {
      if (/\.md(#.*)?$/i.test(cleaned)) return;
      if (!/\.[a-zA-Z0-9]{1,8}$/.test(cleaned)) return;
    }
    if (seen.has(cleaned)) return;
    seen.add(cleaned);
    results.push({
      rawPath: cleaned,
      kind: isAbsoluteLocalRef(cleaned) ? 'absolute' : 'relative',
      isImage,
    });
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // Markdown images & links: ![alt](target) or [label](target)
    const re = /(!?)\[[^\]]*\]\(([^)\n]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      inspect(m[2], m[1] === '!');
    }
  }

  return results;
}

export function buildDocTemplate(
  kind: DocTemplateKind,
  today: string,
  lang: 'zh' | 'en',
): { fileName: string; content: string } {
  const zh = lang !== 'en';
  if (kind === 'daily') {
    return {
      fileName: zh ? `${today} 日常记录.md` : `${today} Daily Note.md`,
      content: zh
        ? `# ${today} 日常记录\n\n## 今日重点\n- [ ] \n\n## 记录与思考\n\n`
        : `# ${today} Daily Note\n\n## Focus\n- [ ] \n\n## Notes & Thoughts\n\n`,
    };
  }
  if (kind === 'meeting') {
    return {
      fileName: zh ? `${today} 会议纪要.md` : `${today} Meeting Notes.md`,
      content: zh
        ? `# 会议纪要（${today}）\n\n- **主题**：\n- **参与人**：\n\n## 核心结论\n1. \n\n## 行动项\n- [ ] \n`
        : `# Meeting Notes (${today})\n\n- **Topic**: \n- **Attendees**: \n\n## Key Decisions\n1. \n\n## Action Items\n- [ ] \n`,
    };
  }
  return {
    fileName: zh ? '未命名文档.md' : 'Untitled.md',
    content: zh ? '# 未命名文档\n\n' : '# Untitled\n\n',
  };
}

export type ConsolidateNotesOrder = 'asc' | 'desc';
export type ConsolidateNotesStyle = 'dated_sections' | 'compact_divider';

export interface ConsolidateNotesOptions {
  title: string;
  targetDocRelPath: string;
  today: string;
  lang: 'zh' | 'en';
  order?: ConsolidateNotesOrder;
  style?: ConsolidateNotesStyle;
}

function formatLocalDateTime(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeMdBracketText(raw: string): string {
  return (raw || '').replace(/[\[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Derives a sensible default document title from 1 or more selected Notes.
 */
export function suggestConsolidatedDocTitle(
  notes: Note[],
  today: string,
  lang: 'zh' | 'en',
): string {
  const zh = lang !== 'en';
  if (notes.length === 1) {
    const first = notes[0];
    const firstLine = (first.text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => markdownToPlainText(line).trim())
      .find(Boolean);
    if (firstLine) {
      const clipped = firstLine.length > 32 ? firstLine.slice(0, 32).trim() : firstLine;
      const clean = sanitizeEntryName(clipped);
      if (clean) return clean;
    }
    const attName = first.attachments[0]?.name
      ? sanitizeEntryName(first.attachments[0].name.replace(/\.[^.]+$/, ''))
      : '';
    if (attName) return attName;
    return zh ? `${today} 灵感记录` : `${today} Note`;
  }

  if (notes.length > 1) {
    const firstTags = notes[0].tags || [];
    const commonTags = firstTags.filter((tg) =>
      notes.every((n) => (n.tags || []).includes(tg)),
    );
    if (commonTags.length === 1) {
      const cleanTag = sanitizeEntryName(commonTags[0]);
      if (cleanTag) {
        return zh ? `${today} ${cleanTag} 灵感整理` : `${today} ${cleanTag} Notes`;
      }
    }
  }

  return zh ? `${today} 灵感整理` : `${today} Notes Consolidation`;
}

/**
 * Resolves a collision-free `.md` relative path inside `dirRelPath`, appending ` (2)`, ` (3)`, ...
 * when an existing entry matches case-insensitively (safe on macOS APFS & Windows NTFS).
 */
export function resolveUniqueDocRelPath(
  existingRelPaths: string[],
  dirRelPath: string,
  rawTitle: string,
): { relPath: string; renamedFromConflict: boolean } {
  const existingLower = new Set(
    existingRelPaths.map((p) => normalizeDocRelPath(p).toLowerCase()),
  );
  const base = sanitizeEntryName(stripMdExtension(rawTitle)) || '未命名文档';
  const dir = normalizeDocRelPath(dirRelPath);

  const firstCandidate = joinDocRelPath(dir, `${base}.md`);
  if (!existingLower.has(firstCandidate.toLowerCase())) {
    return { relPath: firstCandidate, renamedFromConflict: false };
  }

  let idx = 2;
  while (idx < 1000) {
    const candidate = joinDocRelPath(dir, `${base} (${idx}).md`);
    if (!existingLower.has(candidate.toLowerCase())) {
      return { relPath: candidate, renamedFromConflict: true };
    }
    idx += 1;
  }
  return {
    relPath: joinDocRelPath(dir, `${base} (${Date.now()}).md`),
    renamedFromConflict: true,
  };
}

/**
 * Merges 1 or more Notes into a clean standard Markdown document with deduplicated tags
 * and portable relative paths for workspace attachments.
 */
export function buildConsolidatedNotesMarkdown(
  notes: Note[],
  options: ConsolidateNotesOptions,
): string {
  const {
    title,
    targetDocRelPath,
    today,
    lang,
    order = 'asc',
    style = 'dated_sections',
  } = options;
  const zh = lang !== 'en';
  const cleanTitle = sanitizeEntryName(stripMdExtension(title)) || (zh ? '灵感整理' : 'Notes');

  const sorted = [...notes].sort((a, b) =>
    order === 'desc' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt,
  );

  const uniqueTags: string[] = [];
  const seenTags = new Set<string>();
  for (const n of sorted) {
    for (const tg of n.tags || []) {
      const clean = tg.trim();
      if (clean && !seenTags.has(clean)) {
        seenTags.add(clean);
        uniqueTags.push(clean);
      }
    }
  }

  const metaParts: string[] = [];
  if (sorted.length === 1) {
    const dt = formatLocalDateTime(sorted[0].createdAt) || today;
    metaParts.push(zh ? `沉淀自灵感速记 · ${dt}` : `Consolidated from Quick Notes · ${dt}`);
  } else {
    metaParts.push(
      zh
        ? `沉淀自 ${sorted.length} 条灵感 · ${today}`
        : `Consolidated from ${sorted.length} notes · ${today}`,
    );
  }
  if (uniqueTags.length > 0) {
    const tagStr = uniqueTags.map((tg) => `#${tg}`).join(' ');
    metaParts.push(zh ? `标签：${tagStr}` : `Tags: ${tagStr}`);
  }

  const sections = sorted.map((note) => {
    const chunks: string[] = [];
    if (sorted.length > 1 && style === 'dated_sections') {
      const dt = formatLocalDateTime(note.createdAt);
      if (dt) chunks.push(`## ${dt}`);
    }

    const body = (note.text || '').replace(/\r\n?/g, '\n').trim();
    if (body) chunks.push(body);

    const imageLines: string[] = [];
    const extraLinkLines: string[] = [];

    for (const att of note.attachments || []) {
      if (att.kind === 'image') {
        const target = att.relPath
          ? computeAttachmentRelPath(targetDocRelPath, att.relPath)
          : att.dataUrl || '';
        if (!target) continue;
        if (body.includes(target) || (att.relPath && body.includes(att.relPath))) continue;
        const alt = escapeMdBracketText(att.name || 'image');
        imageLines.push(`![${alt}](${target})`);
      } else if (att.kind === 'link' && att.url) {
        if (body.includes(att.url)) continue;
        const label = escapeMdBracketText(att.name || att.url);
        extraLinkLines.push(`- 🔗 [${label}](${att.url})`);
      } else if (att.kind === 'file' && att.relPath) {
        const target = computeAttachmentRelPath(targetDocRelPath, att.relPath);
        if (body.includes(target) || body.includes(att.relPath)) continue;
        const label = escapeMdBracketText(att.name || 'file');
        extraLinkLines.push(`- 📎 [${label}](${target})`);
      }
    }

    if (imageLines.length > 0) chunks.push(imageLines.join('\n\n'));
    if (extraLinkLines.length > 0) chunks.push(extraLinkLines.join('\n'));

    return chunks.join('\n\n');
  });

  const nonEmptySections = sections.filter(Boolean);
  const header = `# ${cleanTitle}\n\n> ${metaParts.join(' · ')}`;
  if (nonEmptySections.length === 0) {
    return `${header}\n`;
  }
  return `${header}\n\n${nonEmptySections.join('\n\n---\n\n')}\n`;
}
