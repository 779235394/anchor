import { describe, expect, it } from 'vitest';
import {
  buildTaskFieldsFromContent,
  deriveTaskTitle,
  getTaskDisplayTitle,
  getTaskEditorContent,
  getTaskSecondaryPreview,
} from '../taskContent';
import type { Attachment } from '../types';

const sampleImage: Attachment = {
  id: 'a1',
  kind: 'image',
  name: 'design-mockup.png',
  relPath: 'attachments/att-1.png',
  createdAt: 1000,
};

describe('taskContent unified single-body helpers', () => {
  it('derives clean plain-text title from first non-empty markdown line or attachment', () => {
    expect(deriveTaskTitle('\n\n- [ ] **修复登录接口**\n补充日志')).toBe('修复登录接口');
    expect(deriveTaskTitle('## 季度评审\n准备 PPT')).toBe('季度评审');
    expect(deriveTaskTitle('   ', [sampleImage])).toBe('design-mockup.png');
    expect(deriveTaskTitle('')).toBe('');
  });

  it('hydrates unified editor content losslessly for both legacy and unified tasks', () => {
    // Legacy title-only task
    expect(getTaskEditorContent({ title: '买牛奶', note: '' })).toBe('买牛奶');

    // Legacy task with separate title + note -> merged cleanly
    expect(
      getTaskEditorContent({
        title: '发布 v0.9.4',
        note: '- [ ] 跑单测\n- [ ] 打标签',
      }),
    ).toBe('发布 v0.9.4\n\n- [ ] 跑单测\n- [ ] 打标签');

    // Unified task where note already starts with title -> returned verbatim (no duplication)
    expect(
      getTaskEditorContent({
        title: '发布 v0.9.4',
        note: '发布 v0.9.4\n\n- [ ] 跑单测\n',
      }),
    ).toBe('发布 v0.9.4\n\n- [ ] 跑单测\n');
  });

  it('avoids duplicate secondary preview for unified single-line tasks', () => {
    expect(getTaskSecondaryPreview({ title: '买牛奶', note: '买牛奶' })).toBe('');
    expect(
      getTaskSecondaryPreview({
        title: '买牛奶',
        note: '买牛奶\n全脂 2 盒\n顺便买面包',
      }),
    ).toBe('全脂 2 盒 · 顺便买面包');
    // Legacy separate note still previews fully
    expect(
      getTaskSecondaryPreview({
        title: '买牛奶',
        note: '去盒马买全脂',
      }),
    ).toBe('去盒马买全脂');
  });

  it('builds fields preserving trailing whitespace during live editing and trimming on submit', () => {
    const live = buildTaskFieldsFromContent('跟进接口 ', undefined, false);
    expect(live.title).toBe('跟进接口');
    expect(live.note).toBe('跟进接口 ');

    const submitted = buildTaskFieldsFromContent('  跟进接口\n细节  ', undefined, true);
    expect(submitted.title).toBe('跟进接口');
    expect(submitted.note).toBe('跟进接口\n细节');

    expect(getTaskDisplayTitle({ title: '', note: '', attachments: [] }, 'zh')).toBe('未命名待办');
  });
});
