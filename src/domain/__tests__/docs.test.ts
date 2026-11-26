import { describe, expect, it } from 'vitest';
import type { Note } from '../types';
import {
  buildConsolidatedNotesMarkdown,
  buildDocTemplate,
  buildDocTree,
  clampDocsSidebarWidth,
  computeAttachmentRelPath,
  countDocStats,
  ensureMdFileName,
  extractExternalMarkdownAssets,
  extractToc,
  extractWorkspaceAttachmentRelPath,
  pruneDocOrderOnDelete,
  remapDocOrderOnRename,
  reorderDocSiblings,
  resolveUniqueDocRelPath,
  shouldFlushDocEditor,
  suggestConsolidatedDocTitle,
  type DocEntry,
} from '../docs';

describe('docs domain helpers', () => {
  it('builds sorted nested doc tree with folders before files', () => {
    const entries: DocEntry[] = [
      { relPath: '随笔.md', name: '随笔.md', isDir: false, updatedAt: 100, size: 10 },
      { relPath: '工作', name: '工作', isDir: true, updatedAt: 50, size: 0 },
      { relPath: '工作/方案.md', name: '方案.md', isDir: false, updatedAt: 200, size: 20 },
      { relPath: '工作/复盘.md', name: '复盘.md', isDir: false, updatedAt: 300, size: 20 },
    ];

    const byName = buildDocTree(entries, 'name');
    expect(byName[0].entry.relPath).toBe('工作');
    expect(byName[1].entry.relPath).toBe('随笔.md');

    const byUpdated = buildDocTree(entries, 'updated');
    expect(byUpdated[0].children[0].entry.relPath).toBe('工作/复盘.md');
    expect(byUpdated[0].children[1].entry.relPath).toBe('工作/方案.md');
  });

  it('extracts H1-H3 TOC while ignoring headings inside fenced code blocks', () => {
    const md = [
      '# 总览',
      '正文',
      '```bash',
      '# 这是代码注释，不是标题',
      '```',
      '## 背景与目标',
      '### 数据安全',
    ].join('\n');

    const toc = extractToc(md);
    expect(toc).toEqual([
      { id: 'doc-heading-0', level: 1, text: '总览' },
      { id: 'doc-heading-1', level: 2, text: '背景与目标' },
      { id: 'doc-heading-2', level: 3, text: '数据安全' },
    ]);
  });

  it('computes portable relative attachment paths and extracts them back', () => {
    const rootDocRel = computeAttachmentRelPath('规划.md', 'attachments/abc.png');
    expect(rootDocRel).toBe('../attachments/abc.png');
    expect(extractWorkspaceAttachmentRelPath(rootDocRel)).toBe('attachments/abc.png');

    const nestedDocRel = computeAttachmentRelPath('工作/2026/架构.md', 'attachments/xyz.webp');
    expect(nestedDocRel).toBe('../../../attachments/xyz.webp');
    expect(extractWorkspaceAttachmentRelPath(nestedDocRel)).toBe('attachments/xyz.webp');
    expect(extractWorkspaceAttachmentRelPath('https://example.com/a.png')).toBeNull();
  });

  it('sanitizes filenames, counts mixed CJK/English words, and builds templates', () => {
    expect(ensureMdFileName('Q4/规划:v1*')).toBe('Q4-规划-v1-.md');
    const stats = countDocStats('# 标题\n\n你好 Anchor world');
    expect(stats.words).toBe(6); // 标题(2) + 你好(2) + Anchor(1) + world(1)
    expect(stats.readMinutes).toBe(1);

    const tpl = buildDocTemplate('daily', '2026-11-24', 'zh');
    expect(tpl.fileName).toBe('2026-11-24 日常记录.md');
    expect(tpl.content).toContain('# 2026-11-24 日常记录');
  });

  it('extracts external local assets and rewrites paths without touching code blocks or workspace attachments', () => {
    const md = [
      '# 方案',
      '![本地图](./assets/diagram.png)',
      '![绝对图](/Users/demo/Desktop/shot.png)',
      '![已归档](../attachments/existing.png)',
      '![网络图](https://example.com/a.png)',
      '[附件PDF](./spec.pdf)',
      '```md',
      '![代码内忽略](./ignored.png)',
      '```',
    ].join('\n');

    const refs = extractExternalMarkdownAssets(md);
    expect(refs).toEqual([
      { rawPath: './assets/diagram.png', kind: 'relative', isImage: true },
      { rawPath: '/Users/demo/Desktop/shot.png', kind: 'absolute', isImage: true },
      { rawPath: './spec.pdf', kind: 'relative', isImage: false },
    ]);
  });

  it('resolves unique doc paths case-insensitively without overwriting existing docs', () => {
    const existing = ['工作/灵感整理.md', '工作/灵感整理 (2).md', 'Docs/Plan.md'];
    const r1 = resolveUniqueDocRelPath(existing, '工作', '灵感整理');
    expect(r1).toEqual({ relPath: '工作/灵感整理 (3).md', renamedFromConflict: true });

    const r2 = resolveUniqueDocRelPath(existing, 'docs', 'plan');
    expect(r2).toEqual({ relPath: 'docs/plan (2).md', renamedFromConflict: true });

    const r3 = resolveUniqueDocRelPath(existing, '工作', '新主题');
    expect(r3).toEqual({ relPath: '工作/新主题.md', renamedFromConflict: false });
  });

  it('suggests titles and consolidates multiple notes with portable attachment paths and deduped tags', () => {
    const n1: Note = {
      id: 'n1',
      createdAt: new Date(2026, 10, 22, 10, 15).getTime(),
      updatedAt: new Date(2026, 10, 22, 10, 15).getTime(),
      text: '第一条**架构**想法\n补充细节',
      tags: ['架构', '产品'],
      attachments: [
        {
          id: 'a1',
          kind: 'image',
          name: '流程图.png',
          relPath: 'attachments/a1.png',
          createdAt: 1,
        },
        {
          id: 'a2',
          kind: 'link',
          name: '规范文档',
          url: 'https://example.com/spec',
          createdAt: 2,
        },
      ],
    };
    const n2: Note = {
      id: 'n2',
      createdAt: new Date(2026, 10, 24, 14, 30).getTime(),
      updatedAt: new Date(2026, 10, 24, 14, 30).getTime(),
      text: '第二条验证记录，已包含 https://example.com/dup',
      tags: ['架构'],
      attachments: [
        {
          id: 'a3',
          kind: 'link',
          name: '重复链接',
          url: 'https://example.com/dup',
          createdAt: 3,
        },
        {
          id: 'a4',
          kind: 'file',
          name: '设计稿.pdf',
          relPath: 'attachments/a4.pdf',
          createdAt: 4,
        },
      ],
    };

    expect(suggestConsolidatedDocTitle([n1], '2026-11-24', 'zh')).toBe('第一条架构想法');
    expect(suggestConsolidatedDocTitle([n1, n2], '2026-11-24', 'zh')).toBe(
      '2026-11-24 架构 灵感整理',
    );

    const mdAsc = buildConsolidatedNotesMarkdown([n2, n1], {
      title: '架构灵感汇总',
      targetDocRelPath: '工作/调研/架构灵感汇总.md',
      today: '2026-11-24',
      lang: 'zh',
      order: 'asc',
      style: 'dated_sections',
    });

    expect(mdAsc).toContain('# 架构灵感汇总');
    expect(mdAsc).toContain('> 沉淀自 2 条灵感 · 2026-11-24 · 标签：#架构 #产品');
    expect(mdAsc.indexOf('2026-11-22 10:15')).toBeLessThan(mdAsc.indexOf('2026-11-24 14:30'));
    expect(mdAsc).toContain('![流程图.png](../../../attachments/a1.png)');
    expect(mdAsc).toContain('- 🔗 [规范文档](https://example.com/spec)');
    expect(mdAsc).toContain('- 📎 [设计稿.pdf](../../../attachments/a4.pdf)');
    expect(mdAsc).not.toContain('重复链接');

    const mdDesc = buildConsolidatedNotesMarkdown([n1, n2], {
      title: '倒序汇总',
      targetDocRelPath: '倒序汇总.md',
      today: '2026-11-24',
      lang: 'zh',
      order: 'desc',
      style: 'compact_divider',
    });
    expect(mdDesc.indexOf('第二条验证记录')).toBeLessThan(mdDesc.indexOf('第一条**架构**想法'));
    expect(mdDesc).not.toContain('## 2026-11-22');
    expect(mdDesc).toContain('![流程图.png](../attachments/a1.png)');
  });

  it('never flushes untouched documents even when editor serialization normalizes whitespace', () => {
    const templateDisk = buildDocTemplate('blank', '2026-11-26', 'zh').content; // ends with \n\n
    const normalizedFromEditor = templateDisk.trimEnd();
    expect(normalizedFromEditor).not.toBe(templateDisk);
    // Untouched doc MUST NOT write back to disk (otherwise mtime bumps and tree jumps order)
    expect(shouldFlushDocEditor(false, normalizedFromEditor, templateDisk)).toBe(false);
    // Real user edit DOES flush when content changed
    expect(shouldFlushDocEditor(true, '# 已修改内容', templateDisk)).toBe(true);
    // Real user edit reverted back to exact disk content does NOT need a write
    expect(shouldFlushDocEditor(true, templateDisk, templateDisk)).toBe(false);
  });

  it('supports manual folder and file ordering, sibling reorder, rename/move remap, and delete pruning', () => {
    const entries: DocEntry[] = [
      { relPath: '项目', name: '项目', isDir: true, updatedAt: 10, size: 0 },
      { relPath: '归档', name: '归档', isDir: true, updatedAt: 20, size: 0 },
      { relPath: 'A.md', name: 'A.md', isDir: false, updatedAt: 100, size: 10 },
      { relPath: 'B.md', name: 'B.md', isDir: false, updatedAt: 300, size: 10 },
      { relPath: 'C.md', name: 'C.md', isDir: false, updatedAt: 200, size: 10 },
      { relPath: '项目/一.md', name: '一.md', isDir: false, updatedAt: 50, size: 10 },
      { relPath: '项目/二.md', name: '二.md', isDir: false, updatedAt: 60, size: 10 },
    ];

    // Default manual tree without saved order falls back to natural name order (stable, never jumps on updatedAt)
    const initial = buildDocTree(entries, 'manual', {});
    expect(initial.map((n) => n.entry.relPath)).toEqual(['归档', '项目', 'A.md', 'B.md', 'C.md']);

    // Reorder C.md before A.md in root
    let order = reorderDocSiblings(entries, {}, '', 'C.md', 'A.md', 'before');
    let tree = buildDocTree(entries, 'manual', order);
    expect(tree.filter((n) => !n.entry.isDir).map((n) => n.entry.name)).toEqual([
      'C.md',
      'A.md',
      'B.md',
    ]);

    // Reorder folder 项目 before 归档
    order = reorderDocSiblings(entries, order, '', '项目', '归档', 'before');
    tree = buildDocTree(entries, 'manual', order);
    expect(tree.filter((n) => n.entry.isDir).map((n) => n.entry.name)).toEqual(['项目', '归档']);

    // Reorder inside subfolder 项目: 二.md before 一.md
    order = reorderDocSiblings(entries, order, '项目', '项目/二.md', '项目/一.md', 'before');
    expect(order['项目']).toEqual(['二.md', '一.md']);

    // Rename folder 项目 -> 核心项目 remaps both root entry and child key
    order = remapDocOrderOnRename(order, '项目', '核心项目', true);
    expect(order['项目']).toBeUndefined();
    expect(order['核心项目']).toEqual(['二.md', '一.md']);
    expect(order['']).toContain('核心项目');
    expect(order['']).not.toContain('项目');

    // Move B.md into 核心项目 before 一.md
    order = remapDocOrderOnRename(order, 'B.md', '核心项目/B.md', false, {
      targetName: '一.md',
      position: 'before',
    });
    expect(order['']).not.toContain('B.md');
    expect(order['核心项目']).toEqual(['二.md', 'B.md', '一.md']);

    // Delete 核心项目 prunes both parent reference and subfolder order map
    order = pruneDocOrderOnDelete(order, '核心项目', true);
    expect(order['核心项目']).toBeUndefined();
    expect(order['']).not.toContain('核心项目');
  });

  it('clamps knowledge sidebar width safely across viewport sizes', () => {
    expect(clampDocsSidebarWidth(undefined, 1280)).toBe(252);
    expect(clampDocsSidebarWidth(120, 1280)).toBe(200);
    expect(clampDocsSidebarWidth(600, 1280)).toBe(480);
    expect(clampDocsSidebarWidth(440, 760)).toBe(340);
  });
});
