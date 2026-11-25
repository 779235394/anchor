import { describe, expect, it } from 'vitest';
import {
  attachmentRelPathToMobileUrl,
  buildRelativeAttachmentMarkdown,
  extractPairTokenFromSearch,
  formatPairingCountdown,
  mergeMobileShardItems,
  rewriteRenderedHtmlImagesForMobile,
  toggleCheckboxInMarkdown,
} from '../mobileSync';
import type { Task } from '../types';

function makeTask(id: string, title: string, updatedAt: number, deletedAt?: number | null): Task {
  return {
    id,
    title,
    note: '',
    prio: 2,
    status: 'todo',
    due: '',
    done: false,
    doneAt: null,
    projectId: '',
    rolls: 0,
    carriedDate: null,
    attachments: [],
    createdAt: 100,
    updatedAt,
    deletedAt: deletedAt ?? null,
  };
}

describe('mobileSync domain helpers', () => {
  it('merges incoming mobile shard items with LWW semantics', () => {
    const existing = [makeTask('t1', 'Old', 1000), makeTask('t2', 'LocalNewer', 3000)];
    const incoming = [
      makeTask('t1', 'UpdatedFromPhone', 2000),
      makeTask('t2', 'StaleFromPhone', 2500),
      makeTask('t3', 'BrandNewFromPhone', 2200),
    ];
    const merged = mergeMobileShardItems(existing, incoming);
    expect(merged.map((t) => t.id)).toEqual(['t3', 't1', 't2']);
    expect(merged.find((t) => t.id === 't1')?.title).toBe('UpdatedFromPhone');
    expect(merged.find((t) => t.id === 't2')?.title).toBe('LocalNewer');
  });

  it('extracts pairing token safely from query string', () => {
    expect(extractPairTokenFromSearch('?pair=0123456789abcdef0123456789abcdef')).toBe(
      '0123456789abcdef0123456789abcdef',
    );
    expect(extractPairTokenFromSearch('?pair=short')).toBeNull();
    expect(extractPairTokenFromSearch('?other=1')).toBeNull();
  });

  it('builds portable relative markdown image links matching doc nesting depth', () => {
    expect(buildRelativeAttachmentMarkdown('daily.md', 'attachments/att-1.png', 'shot')).toBe(
      '![shot](../attachments/att-1.png)',
    );
    expect(buildRelativeAttachmentMarkdown('work/sub/spec.md', 'attachments/att-2.jpg', 'img')).toBe(
      '![img](../../../attachments/att-2.jpg)',
    );
  });

  it('rewrites local attachment image paths in rendered HTML to mobile API URLs', () => {
    expect(attachmentRelPathToMobileUrl('../../attachments/att-1.png')).toBe(
      '/api/attachments/att-1.png',
    );
    expect(attachmentRelPathToMobileUrl('https://example.com/a.png')).toBeNull();
    expect(attachmentRelPathToMobileUrl('../attachments/../secret.json')).toBeNull();

    const html = '<p><img src="../attachments/pic 1.png" alt="a" /><img src="https://x.io/b.png" /></p>';
    const rewritten = rewriteRenderedHtmlImagesForMobile(html);
    expect(rewritten).toContain('src="/api/attachments/pic%201.png"');
    expect(rewritten).toContain('src="https://x.io/b.png"');
  });

  it('toggles task checkboxes while skipping fenced code blocks', () => {
    const md = [
      '# Checklist',
      '```md',
      '- [ ] inside code',
      '```',
      '- [ ] First real item',
      '- [x] Second real item',
    ].join('\n');

    const next0 = toggleCheckboxInMarkdown(md, 0);
    expect(next0).toContain('- [ ] inside code');
    expect(next0).toContain('- [x] First real item');
    expect(next0).toContain('- [x] Second real item');

    const next1 = toggleCheckboxInMarkdown(md, 1);
    expect(next1).toContain('- [ ] Second real item');
    expect(toggleCheckboxInMarkdown(md, 5)).toBeNull();
  });

  it('formats pairing countdown cleanly', () => {
    expect(formatPairingCountdown(125_000, 0)).toBe('2:05');
    expect(formatPairingCountdown(500, 1000)).toBe('0:00');
    expect(formatPairingCountdown(null, 1000)).toBe('0:00');
  });
});
