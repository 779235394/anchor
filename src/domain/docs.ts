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

export type DocSortBy = 'updated' | 'name';
export type DocTemplateKind = 'blank' | 'daily' | 'meeting';

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

export function buildDocTree(entries: DocEntry[], sortBy: DocSortBy = 'name'): DocTreeNode[] {
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

  const compareNodes = (a: DocTreeNode, b: DocTreeNode): number => {
    if (a.entry.isDir !== b.entry.isDir) return a.entry.isDir ? -1 : 1;
    if (sortBy === 'updated' && !a.entry.isDir) {
      if (b.entry.updatedAt !== a.entry.updatedAt) {
        return b.entry.updatedAt - a.entry.updatedAt;
      }
    }
    return a.entry.name.localeCompare(b.entry.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  };

  const sortRecursive = (list: DocTreeNode[]) => {
    list.sort(compareNodes);
    for (const n of list) {
      if (n.children.length > 0) sortRecursive(n.children);
    }
  };
  sortRecursive(roots);

  return roots;
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
