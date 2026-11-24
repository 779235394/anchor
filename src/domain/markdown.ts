export interface RichTextNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: RichTextNode[];
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeHref(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') {
      return u.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function sanitizeImageSrc(raw: string): string | null {
  const s = (raw || '').trim();
  if (!s) return null;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml|bmp);base64,/i.test(s)) {
    return s;
  }
  if (/^https?:\/\//i.test(s)) {
    try {
      return new URL(s).toString();
    } catch {
      return null;
    }
  }
  // Safe relative workspace image path (e.g. ../attachments/img.png or ./pic.png)
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) && !s.startsWith('//')) {
    return s;
  }
  return null;
}

export interface MarkdownRenderOptions {
  resolveImageSrc?: (src: string) => string;
  addHeadingIds?: boolean;
}

function renderInlineMarkdown(raw: string, opts?: MarkdownRenderOptions): string {
  // 1. Extract inline code spans first so inner syntax is never transformed
  const codePlaceholders: string[] = [];
  let work = raw.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    const idx = codePlaceholders.length;
    codePlaceholders.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000CODE${idx}\u0000`;
  });

  // 1.5 Extract Markdown images ![alt](src) before links
  const imgPlaceholders: string[] = [];
  work = work.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, rawSrc: string) => {
    const safe = sanitizeImageSrc(rawSrc);
    if (!safe) return escapeHtml(alt || rawSrc);
    const resolved = opts?.resolveImageSrc ? opts.resolveImageSrc(safe) : safe;
    const idx = imgPlaceholders.length;
    imgPlaceholders.push(
      `<img src="${escapeHtml(resolved)}" alt="${escapeHtml(alt)}" data-md-src="${escapeHtml(safe)}">`,
    );
    return `\u0000IMG${idx}\u0000`;
  });

  // 2. Extract Markdown links [label](url)
  const linkPlaceholders: string[] = [];
  work = work.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    const safe = sanitizeHref(url);
    if (!safe) return escapeHtml(`${label} (${url})`);
    const idx = linkPlaceholders.length;
    const inner = renderTextEmphasis(escapeHtml(label));
    linkPlaceholders.push(
      `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${inner}</a>`,
    );
    return `\u0000LINK${idx}\u0000`;
  });

  // 3. Escape remaining HTML
  work = escapeHtml(work);

  // 4. Autolink bare http(s) URLs (trimming trailing punctuation cleanly)
  work = work.replace(/(https?:\/\/[^\s<>"'\u0000]+)/g, (match) => {
    let url = match;
    let suffix = '';
    while (/[.,;:!?)]$/.test(url)) {
      suffix = url.slice(-1) + suffix;
      url = url.slice(0, -1);
    }
    const safe = sanitizeHref(url.replace(/&amp;/g, '&'));
    if (!safe) return match;
    const idx = linkPlaceholders.length;
    linkPlaceholders.push(
      `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(safe)}</a>`,
    );
    return `\u0000LINK${idx}\u0000${suffix}`;
  });

  // 5. Inline emphasis marks
  work = renderTextEmphasis(work);

  // 6. Restore links, images & inline code
  work = work.replace(/\u0000LINK(\d+)\u0000/g, (_m, idx) => linkPlaceholders[Number(idx)] ?? '');
  work = work.replace(/\u0000IMG(\d+)\u0000/g, (_m, idx) => imgPlaceholders[Number(idx)] ?? '');
  work = work.replace(/\u0000CODE(\d+)\u0000/g, (_m, idx) => codePlaceholders[Number(idx)] ?? '');

  return work;
}

function renderTextEmphasis(escaped: string): string {
  let s = escaped;
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/==([^=\n]+?)==/g, '<mark>$1</mark>');
  s = s.replace(/~~([^~\n]+?)~~/g, '<s>$1</s>');
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  return s;
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  const cells: string[] = [];
  let cur = '';
  for (let idx = 0; idx < trimmed.length; idx += 1) {
    if (trimmed[idx] === '\\' && trimmed[idx + 1] === '|') {
      cur += '|';
      idx += 1;
    } else if (trimmed[idx] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += trimmed[idx];
    }
  }
  cells.push(cur.trim());
  return cells;
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') || !trimmed.includes('-')) return false;
  const cells = parseTableRow(trimmed);
  return cells.length > 0 && cells.every((c) => /^:?\s*-+\s*:?$/.test(c));
}

/**
 * Heuristic to detect whether pasted plain text contains Markdown block/table/inline
 * structure worth converting into rich TipTap nodes on WYSIWYG paste.
 */
export function looksLikeMarkdown(raw: string): boolean {
  const s = (raw || '').replace(/\r\n?/g, '\n');
  if (!s.trim()) return false;
  const lines = s.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^#{1,3}\s+\S/.test(line)) return true;
    if (/^```/.test(line.trim())) return true;
    if (/^\s*[-*]\s+\[[ xX]\]\s+/.test(line)) return true;
    if (/^\s*[-*]\s+\S/.test(line) && lines.length > 1) return true;
    if (/^\s*\d+\.\s+\S/.test(line) && lines.length > 1) return true;
    if (/^>\s+\S/.test(line)) return true;
    if (/^\s*(?:---|___|\*\*\*)\s*$/.test(line)) return true;
    if (line.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
      return true;
    }
  }
  if (/!\[[^\]]*\]\([^)\s]+\)/.test(s)) return true;
  if (/\[[^\]]+\]\(https?:\/\/[^)\s]+\)/.test(s)) return true;
  if (/\*\*[^*\n]+?\*\*/.test(s)) return true;
  return false;
}

/**
 * Converts a plain-text or Markdown string into TipTap-compatible, XSS-safe HTML.
 */
export function markdownToHtml(md: string, opts?: MarkdownRenderOptions): string {
  const normalized = (md || '').replace(/\r\n?/g, '\n');
  if (!normalized.trim()) return '';

  const lines = normalized.split('\n');
  const out: string[] = [];
  let i = 0;
  let headingIdx = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line separator
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code block ```[lang]
    if (/^```/.test(line.trim())) {
      const lang = line.trim().slice(3).trim().replace(/[^a-zA-Z0-9_+#.-]/g, '');
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // skip closing ```
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    // Horizontal rule
    if (/^\s*(?:---|___|\*\*\*)\s*$/.test(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    // GFM Table (header row + separator row)
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparatorLine(lines[i + 1])
    ) {
      const headers = parseTableRow(line);
      i += 2; // skip header + separator
      const bodyRows: string[][] = [];
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        bodyRows.push(parseTableRow(lines[i]));
        i += 1;
      }
      const thHtml = headers
        .map((cell) => `<th><p>${renderInlineMarkdown(cell, opts)}</p></th>`)
        .join('');
      const trsHtml = bodyRows
        .map((row) => {
          const cells = headers.map((_, colIdx) => {
            const val = row[colIdx] ?? '';
            return `<td><p>${renderInlineMarkdown(val, opts)}</p></td>`;
          });
          return `<tr>${cells.join('')}</tr>`;
        })
        .join('');
      out.push(
        `<div class="tableWrapper"><table><thead><tr>${thHtml}</tr></thead><tbody>${trsHtml}</tbody></table></div>`,
      );
      continue;
    }

    // Standalone image line ![alt](src)
    const imgOnlyMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (imgOnlyMatch) {
      const safe = sanitizeImageSrc(imgOnlyMatch[2]);
      if (safe) {
        const resolved = opts?.resolveImageSrc ? opts.resolveImageSrc(safe) : safe;
        out.push(
          `<img src="${escapeHtml(resolved)}" alt="${escapeHtml(imgOnlyMatch[1])}" data-md-src="${escapeHtml(safe)}">`,
        );
        i += 1;
        continue;
      }
    }

    // Heading (#, ##, ###)
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const idAttr = opts?.addHeadingIds ? ` id="doc-heading-${headingIdx}"` : '';
      headingIdx += 1;
      out.push(`<h${level}${idAttr}>${renderInlineMarkdown(headingMatch[2], opts)}</h${level}>`);
      i += 1;
      continue;
    }

    // Blockquote (> ...)
    if (/^>\s?/.test(line)) {
      const qLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        qLines.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      out.push(
        `<blockquote><p>${qLines.map((l) => renderInlineMarkdown(l, opts)).join('<br>')}</p></blockquote>`,
      );
      continue;
    }

    // Task list (- [ ] / - [x])
    if (/^\s*[-*]\s+\[[ xX]\]\s*/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+\[[ xX]\]\s*/.test(lines[i])) {
        const m = lines[i].match(/^\s*[-*]\s+\[([ xX])\]\s*(.*)$/);
        const checked = m ? m[1].toLowerCase() === 'x' : false;
        const body = m ? m[2] : '';
        items.push(
          `<li data-type="taskItem" data-checked="${checked ? 'true' : 'false'}"><label><input type="checkbox"${checked ? ' checked="checked"' : ''}><span></span></label><div><p>${renderInlineMarkdown(body, opts)}</p></div></li>`,
        );
        i += 1;
      }
      out.push(`<ul data-type="taskList">${items.join('')}</ul>`);
      continue;
    }

    // Bullet list (- / *)
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (
        i < lines.length &&
        /^\s*[-*]\s+/.test(lines[i]) &&
        !/^\s*[-*]\s+\[[ xX]\]\s*/.test(lines[i])
      ) {
        const body = lines[i].replace(/^\s*[-*]\s+/, '');
        items.push(`<li><p>${renderInlineMarkdown(body, opts)}</p></li>`);
        i += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // Ordered list (1. )
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const body = lines[i].replace(/^\s*\d+\.\s+/, '');
        items.push(`<li><p>${renderInlineMarkdown(body, opts)}</p></li>`);
        i += 1;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // Paragraph (group consecutive plain text lines until blank line or block syntax)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i].trim()) &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*(?:---|___|\*\*\*)\s*$/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1]))
    ) {
      paraLines.push(renderInlineMarkdown(lines[i], opts));
      i += 1;
    }
    out.push(`<p>${paraLines.join('<br>')}</p>`);
  }

  return out.join('');
}

function serializeImageNode(node: RichTextNode): string {
  const mdSrc = typeof node.attrs?.mdSrc === 'string' ? node.attrs.mdSrc.trim() : '';
  const src = mdSrc || (typeof node.attrs?.src === 'string' ? node.attrs.src.trim() : '');
  const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
  if (!src) return '';
  return `![${alt}](${src})`;
}

function serializeInlineNodes(nodes: RichTextNode[] | undefined): string {
  if (!nodes || nodes.length === 0) return '';
  return nodes
    .map((node) => {
      if (node.type === 'hardBreak') return '\n';
      if (node.type === 'image') return serializeImageNode(node);
      if (node.type !== 'text') return serializeInlineNodes(node.content);
      let text = node.text ?? '';
      const marks = node.marks ?? [];
      const hasCode = marks.some((m) => m.type === 'code');

      if (hasCode) {
        text = `\`${text.replace(/`/g, '')}\``;
      } else {
        for (const m of marks) {
          if (m.type === 'bold') text = `**${text}**`;
          else if (m.type === 'italic') text = `*${text}*`;
          else if (m.type === 'strike') text = `~~${text}~~`;
          else if (m.type === 'highlight') text = `==${text}==`;
        }
      }

      const linkMark = marks.find((m) => m.type === 'link');
      const href = typeof linkMark?.attrs?.href === 'string' ? linkMark.attrs.href.trim() : '';
      if (href) {
        if (text === href) return href;
        return `[${text}](${href})`;
      }
      return text;
    })
    .join('');
}

function serializeBlocks(nodes: RichTextNode[] | undefined, indent = ''): string[] {
  if (!nodes || nodes.length === 0) return [];
  const blocks: string[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph': {
        const line = serializeInlineNodes(node.content);
        blocks.push(`${indent}${line}`);
        break;
      }
      case 'heading': {
        const level = Math.min(3, Math.max(1, Number(node.attrs?.level) || 2));
        const hashes = '#'.repeat(level);
        blocks.push(`${indent}${hashes} ${serializeInlineNodes(node.content)}`);
        break;
      }
      case 'blockquote': {
        const inner = serializeBlocks(node.content).join('\n');
        const quoted = inner
          .split('\n')
          .map((l) => `${indent}> ${l}`)
          .join('\n');
        blocks.push(quoted);
        break;
      }
      case 'codeBlock': {
        const lang =
          typeof node.attrs?.language === 'string' ? node.attrs.language.trim() : '';
        const code = (node.content ?? []).map((c) => c.text ?? '').join('');
        blocks.push(`${indent}\`\`\`${lang}\n${code}\n${indent}\`\`\``);
        break;
      }
      case 'image': {
        const imgMd = serializeImageNode(node);
        if (imgMd) blocks.push(`${indent}${imgMd}`);
        break;
      }
      case 'table': {
        const rows = (node.content ?? []).filter((r) => r.type === 'tableRow');
        if (rows.length > 0) {
          const mdRows = rows.map((row) =>
            (row.content ?? []).map((cell) =>
              serializeBlocks(cell.content).join(' ').replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim(),
            ),
          );
          const colCount = Math.max(1, ...mdRows.map((r) => r.length));
          const pad = (r: string[]) =>
            Array.from({ length: colCount }, (_, idx) => r[idx] ?? '');
          const header = `| ${pad(mdRows[0]).join(' | ')} |`;
          const sep = `| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`;
          const body = mdRows.slice(1).map((r) => `| ${pad(r).join(' | ')} |`);
          blocks.push([header, sep, ...body].map((l) => `${indent}${l}`).join('\n'));
        }
        break;
      }
      case 'horizontalRule': {
        blocks.push(`${indent}---`);
        break;
      }
      case 'bulletList': {
        const lines: string[] = [];
        for (const item of node.content ?? []) {
          const parts = serializeListItem(item, '- ', indent);
          lines.push(...parts);
        }
        blocks.push(lines.join('\n'));
        break;
      }
      case 'orderedList': {
        const lines: string[] = [];
        const start = Number(node.attrs?.start) || 1;
        (node.content ?? []).forEach((item, idx) => {
          const parts = serializeListItem(item, `${start + idx}. `, indent);
          lines.push(...parts);
        });
        blocks.push(lines.join('\n'));
        break;
      }
      case 'taskList': {
        const lines: string[] = [];
        for (const item of node.content ?? []) {
          const checked = !!item.attrs?.checked;
          const prefix = checked ? '- [x] ' : '- [ ] ';
          const parts = serializeListItem(item, prefix, indent);
          lines.push(...parts);
        }
        blocks.push(lines.join('\n'));
        break;
      }
      default: {
        if (node.content) {
          blocks.push(...serializeBlocks(node.content, indent));
        }
      }
    }
  }

  return blocks;
}

function serializeListItem(item: RichTextNode, prefix: string, indent: string): string[] {
  const children = item.content ?? [];
  if (children.length === 0) return [`${indent}${prefix}`];

  const lines: string[] = [];
  children.forEach((child, idx) => {
    if (child.type === 'paragraph') {
      const text = serializeInlineNodes(child.content)
        .replace(/^\n+/, '')
        .replace(/\n+/g, ' ');
      if (idx === 0) {
        lines.push(`${indent}${prefix}${text}`);
      } else {
        lines.push(`${indent}  ${text}`);
      }
    } else if (
      child.type === 'bulletList' ||
      child.type === 'orderedList' ||
      child.type === 'taskList'
    ) {
      lines.push(...serializeBlocks([child], `${indent}  `));
    } else {
      const nested = serializeBlocks([child], idx === 0 ? '' : `${indent}  `);
      if (idx === 0 && nested.length > 0) {
        lines.push(`${indent}${prefix}${nested[0]}`);
        lines.push(...nested.slice(1));
      } else {
        lines.push(...nested);
      }
    }
  });
  return lines;
}

/**
 * Deterministic serializer from TipTap JSONContent AST to clean readable Markdown.
 */
export function tiptapJsonToMarkdown(doc: RichTextNode | null | undefined): string {
  if (!doc || !doc.content) return '';
  const blocks = serializeBlocks(doc.content);
  const joined = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n');
  return joined.trim() ? joined.trimEnd() : '';
}

/**
 * Strips Markdown formatting to produce clean plain text for search summaries & task titles.
 */
export function markdownToPlainText(md: string): string {
  if (!md) return '';
  return md
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, '').trim())
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1')
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/==([^=\n]+?)==/g, '$1')
    .replace(/~~([^~\n]+?)~~/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1$2')
    .replace(/^\s*#{1,3}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*]\s+\[[ xX]\]\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Toggles the N-th (0-based) Markdown task list checkbox (`- [ ]` <-> `- [x]`) in place.
 */
export function toggleMarkdownTaskItem(md: string, targetIndex: number): string {
  if (targetIndex < 0 || !md) return md;
  let seen = 0;
  return md
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const m = line.match(/^(\s*[-*]\s+\[)([ xX])(\].*)$/);
      if (!m) return line;
      if (seen === targetIndex) {
        seen += 1;
        const nextMark = m[2].toLowerCase() === 'x' ? ' ' : 'x';
        return `${m[1]}${nextMark}${m[3]}`;
      }
      seen += 1;
      return line;
    })
    .join('\n');
}

function stripWrappingQuotes(s: string): string {
  const t = s.trim();
  if (
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function looksLikeSingleLocalPath(line: string): boolean {
  const s = stripWrappingQuotes(line);
  if (!s || /^https?:\/\//i.test(s)) return false;
  if (/^file:\/\//i.test(s)) return true;
  if (/^~\/.+/.test(s)) return true;
  // Windows absolute path: C:\... or D:/...
  if (/^[a-zA-Z]:[\\/].+/.test(s)) return true;
  // macOS / Linux common absolute roots (avoid false positives on `/foo` slash commands)
  if (
    /^\/(Users|Volumes|Library|Applications|System|private|var|tmp|home|mnt|opt|srv|data|root)\/.+/.test(
      s,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Detects whether pasted plain text consists entirely of one or more local file paths
 * (such as macOS Finder / Paste.app / WeChat file copies or file:// URIs).
 */
export function extractLocalFilePaths(raw: string): string[] {
  const lines = (raw || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0 || lines.length > 20) return [];
  if (lines.every(looksLikeSingleLocalPath)) {
    return lines;
  }
  return [];
}
