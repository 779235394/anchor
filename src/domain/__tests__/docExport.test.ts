import { describe, expect, it } from 'vitest';
import { buildPrintableDocHtml } from '../docExport';

describe('buildPrintableDocHtml', () => {
  it('renders self-contained light A4 HTML with resolved images, tables, code blocks, and static checkboxes', () => {
    const md = [
      '# 方案评审',
      '',
      '- [x] 已完成调研',
      '- [ ] 待确认细节',
      '',
      '| 模块 | 状态 |',
      '| --- | --- |',
      '| 知识库 | 完成 |',
      '',
      '![架构图](../attachments/arch.png)',
      '',
      '```ts',
      'const ok = true;',
      '```',
    ].join('\n');

    const html = buildPrintableDocHtml('方案 <评审> & "v1"', md, {
      '../attachments/arch.png': 'data:image/png;base64,AAAA',
    });

    expect(html).toContain('<title>方案 &lt;评审&gt; &amp; &quot;v1&quot;</title>');
    expect(html).toContain('size: A4 portrait');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('<table>');
    expect(html).toContain('pdf-cb-checked');
    expect(html).toContain('<span class="pdf-cb" aria-hidden="true"></span>');
    expect(html).not.toContain('<input type="checkbox"');
    expect(html).toContain('const ok = true;');
  });
});
