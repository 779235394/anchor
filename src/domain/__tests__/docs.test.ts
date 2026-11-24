import { describe, expect, it } from 'vitest';
import {
  buildDocTemplate,
  buildDocTree,
  computeAttachmentRelPath,
  countDocStats,
  ensureMdFileName,
  extractExternalMarkdownAssets,
  extractToc,
  extractWorkspaceAttachmentRelPath,
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
});
