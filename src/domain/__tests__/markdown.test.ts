import { describe, expect, it } from 'vitest';
import {
  extractLocalFilePaths,
  markdownToHtml,
  markdownToPlainText,
  tiptapJsonToMarkdown,
  toggleMarkdownTaskItem,
} from '../markdown';

describe('domain/markdown', () => {
  it('renders Markdown emphasis, links, lists, and task lists safely', () => {
    const md = [
      '检查 **核心接口** 与 ==重点指标==，参考 `v0.4.0` 与 [GitHub](https://github.com/779235394/anchor)',
      '',
      '- [ ] 第一项任务',
      '- [x] 第二项已完成',
      '',
      '- 普通要点 <script>alert(1)</script>',
    ].join('\n');

    const html = markdownToHtml(md);
    expect(html).toContain('<strong>核心接口</strong>');
    expect(html).toContain('<mark>重点指标</mark>');
    expect(html).toContain('<code>v0.4.0</code>');
    expect(html).toContain('href="https://github.com/779235394/anchor"');
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-checked="false"');
    expect(html).toContain('data-checked="true"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('blocks unsafe javascript: links', () => {
    const html = markdownToHtml('[click](javascript:alert(1))');
    expect(html).not.toContain('href="javascript:');
  });

  it('serializes TipTap JSON AST cleanly back into readable Markdown', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '处理 ' },
            { type: 'text', text: 'P1 阻塞', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' 并查看 ' },
            {
              type: 'text',
              text: '文档',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/doc' } }],
            },
          ],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '核对埋点' }] }],
            },
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '发版验收' }] }],
            },
          ],
        },
      ],
    };

    expect(tiptapJsonToMarkdown(doc)).toBe(
      '处理 **P1 阻塞** 并查看 [文档](https://example.com/doc)\n\n- [ ] 核对埋点\n- [x] 发版验收',
    );
  });

  it('round-trips headings, ordered lists, strikethrough, and blockquotes', () => {
    const md = [
      '## 迭代要点',
      '',
      '1. 修复 ~~旧样式~~ 问题',
      '2. 补充常驻工具栏',
      '',
      '> 保持明文 Markdown 可读',
    ].join('\n');

    const html = markdownToHtml(md);
    expect(html).toContain('<h2>迭代要点</h2>');
    expect(html).toContain('<ol><li><p>修复 <s>旧样式</s> 问题</p></li><li><p>补充常驻工具栏</p></li></ol>');
    expect(html).toContain('<blockquote><p>保持明文 Markdown 可读</p></blockquote>');

    const serialized = tiptapJsonToMarkdown({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '迭代要点' }] },
        {
          type: 'orderedList',
          attrs: { start: 1 },
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: '修复 ' },
                    { type: 'text', text: '旧样式', marks: [{ type: 'strike' }] },
                    { type: 'text', text: ' 问题' },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '补充常驻工具栏' }] }],
            },
          ],
        },
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '保持明文 Markdown 可读' }] }],
        },
      ],
    });
    expect(serialized).toBe(md);
  });

  it('toggles individual task checkboxes in place', () => {
    const md = '背景说明\n\n- [ ] 第一步\n- [x] 第二步\n- [ ] 第三步';
    const toggled0 = toggleMarkdownTaskItem(md, 0);
    expect(toggled0).toBe('背景说明\n\n- [x] 第一步\n- [x] 第二步\n- [ ] 第三步');

    const toggled1 = toggleMarkdownTaskItem(toggled0, 1);
    expect(toggled1).toBe('背景说明\n\n- [x] 第一步\n- [ ] 第二步\n- [ ] 第三步');
  });

  it('extracts clean plain text from rich Markdown', () => {
    const plain = markdownToPlainText(
      '## 周会结论\n- [x] 跟进 **首页改版** [原型](https://figma.com/1)\n> 关注 `P99` 延迟',
    );
    expect(plain).toBe('周会结论\n跟进 首页改版 原型\n关注 P99 延迟');
  });

  it('detects pasted local file paths without false positives on prose or URLs', () => {
    expect(
      extractLocalFilePaths('/Users/heheyouming/Library/Containers/com.wiheads.paste/Data/a.png'),
    ).toEqual(['/Users/heheyouming/Library/Containers/com.wiheads.paste/Data/a.png']);

    expect(
      extractLocalFilePaths('file:///Users/test/Desktop/spec%20v1.pdf\n"C:\\Users\\a\\doc.docx"'),
    ).toEqual(['file:///Users/test/Desktop/spec%20v1.pdf', '"C:\\Users\\a\\doc.docx"']);

    expect(extractLocalFilePaths('https://github.com/779235394/anchor')).toEqual([]);
    expect(extractLocalFilePaths('修改所有业务模块的阅读时间上报')).toEqual([]);
    expect(extractLocalFilePaths('/api/v1/orders 接口超时')).toEqual([]);
  });
});
