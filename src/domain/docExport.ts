import { markdownToHtml } from './markdown';

function escapeHtml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Replaces interactive task-list checkboxes with static crisp PDF/print symbols so
 * every native PDF engine (WKWebView / WebView2 / Browser Print) renders identically.
 */
function renderStaticCheckboxes(html: string): string {
  return html
    .replace(
      /<input\b[^>]*type="checkbox"[^>]*checked="checked"[^>]*>/gi,
      '<span class="pdf-cb pdf-cb-checked" aria-hidden="true">✓</span>',
    )
    .replace(
      /<input\b[^>]*type="checkbox"[^>]*>/gi,
      '<span class="pdf-cb" aria-hidden="true"></span>',
    );
}

/**
 * Builds a self-contained, fixed Apple Clarity light-paper A4 HTML document ready for
 * native vector PDF export (macOS NSPrintOperation / Windows WebView2 PrintToPdf / browser print).
 */
export function buildPrintableDocHtml(
  title: string,
  markdown: string,
  imageDataMap: Record<string, string> = {},
): string {
  const safeTitle = escapeHtml(title || 'Document');
  const rawBody = markdownToHtml(markdown || '', {
    resolveImageSrc: (src) => imageDataMap[src] || src,
  });
  const bodyHtml = renderStaticCheckboxes(rawBody);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${safeTitle}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 16mm 15mm;
  }
  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #1d1d1f;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
      "SF Pro Text", "Microsoft YaHei", "Segoe UI", sans-serif;
    font-size: 13.5px;
    line-height: 1.75;
    -webkit-font-smoothing: antialiased;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  .doc-root {
    width: 100%;
    max-width: 100%;
    margin: 0 auto;
    padding: 0;
  }
  h1, h2, h3, h4 {
    color: #111113;
    line-height: 1.35;
    break-after: avoid;
    page-break-after: avoid;
  }
  h1 {
    font-size: 22px;
    font-weight: 700;
    margin: 0 0 12px;
    padding-bottom: 7px;
    border-bottom: 1px solid #e5e5ea;
  }
  h2 {
    font-size: 17px;
    font-weight: 650;
    margin: 20px 0 8px;
  }
  h3 {
    font-size: 14.5px;
    font-weight: 600;
    margin: 16px 0 6px;
  }
  p {
    margin: 0 0 10px;
  }
  p:empty::before {
    content: "\\200B";
  }
  a {
    color: #0066cc;
    text-decoration: underline;
    word-break: break-all;
  }
  strong {
    font-weight: 650;
    color: #111113;
  }
  mark {
    background: #fff3b0;
    color: #1d1d1f;
    padding: 0 3px;
    border-radius: 3px;
  }
  code {
    font-family: "SF Mono", Menlo, Monaco, Consolas, "Courier New", monospace;
    font-size: 12px;
    background: #f2f2f7;
    color: #1d1d1f;
    padding: 1px 5px;
    border-radius: 4px;
  }
  pre {
    background: #f5f5f7;
    border: 1px solid #e5e5ea;
    border-radius: 8px;
    padding: 11px 13px;
    margin: 12px 0;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  pre code {
    background: transparent;
    padding: 0;
    font-size: 11.5px;
    line-height: 1.6;
  }
  blockquote {
    margin: 12px 0;
    padding: 6px 12px;
    border-left: 3px solid #007aff;
    background: #f8f9fb;
    color: #515154;
    border-radius: 0 6px 6px 0;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  blockquote p:last-child {
    margin-bottom: 0;
  }
  hr {
    border: 0;
    border-top: 1px solid #e5e5ea;
    margin: 18px 0;
  }
  ul, ol {
    margin: 6px 0 12px;
    padding-left: 22px;
  }
  li {
    margin: 4px 0;
  }
  li p {
    margin: 0;
  }
  ul[data-type="taskList"] {
    list-style: none;
    padding-left: 0;
  }
  ul[data-type="taskList"] li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 5px 0;
  }
  ul[data-type="taskList"] li > label {
    display: inline-flex;
    align-items: center;
    margin-top: 3px;
    flex-shrink: 0;
  }
  ul[data-type="taskList"] li > div {
    flex: 1;
    min-width: 0;
  }
  ul[data-type="taskList"] li[data-checked="true"] > div {
    color: #86868b;
    text-decoration: line-through;
  }
  .pdf-cb {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 3.5px;
    border: 1.5px solid #86868b;
    background: #ffffff;
    color: #ffffff;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }
  .pdf-cb-checked {
    background: #007aff;
    border-color: #007aff;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 14px 0;
    font-size: 12.5px;
    border: 1px solid #d2d2d7;
    table-layout: auto;
  }
  thead {
    display: table-header-group;
  }
  tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid #d2d2d7;
    padding: 6px 10px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #f2f2f7;
    font-weight: 600;
    color: #1d1d1f;
  }
  tbody tr:nth-child(even) td {
    background: #fafafa;
  }
  img {
    display: block;
    max-width: 100%;
    max-height: 220mm;
    height: auto;
    object-fit: contain;
    margin: 10px 0;
    border-radius: 6px;
    border: 1px solid #e5e5ea;
    break-inside: avoid;
    page-break-inside: avoid;
  }
</style>
</head>
<body>
  <main class="doc-root">${bodyHtml}</main>
</body>
</html>`;
}
