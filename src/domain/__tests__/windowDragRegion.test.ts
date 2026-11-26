import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

/**
 * Exact mirror of Tauri 2.12.7 `src/window/scripts/drag.js` `isDragRegion(composedPath)`.
 * Bare `data-tauri-drag-region` (`""` or `"true"`) ONLY matches `el === composedPath[0]`,
 * whereas `"deep"` walks ancestors and ignores non-interactive descendants while still
 * blocking native clickable elements (`BUTTON`, `INPUT`, etc.) and `"false"` subtrees.
 */
interface MockElement {
  tagName: string;
  attrs: Record<string, string>;
}

const CLICKABLE_TAGS = new Set([
  'A',
  'BUTTON',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'LABEL',
  'SUMMARY',
]);
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'tab',
  'checkbox',
  'radio',
  'switch',
  'option',
]);

function isClickableElement(el: MockElement): boolean {
  const ce = el.attrs.contenteditable;
  const ti = el.attrs.tabindex;
  const role = el.attrs.role;
  return (
    CLICKABLE_TAGS.has(el.tagName) ||
    (ce !== undefined && ce !== 'false') ||
    (ti !== undefined && ti !== '-1') ||
    (role !== undefined && INTERACTIVE_ROLES.has(role))
  );
}

function isTauriDragRegion(composedPath: MockElement[]): boolean {
  for (const el of composedPath) {
    const attr = el.attrs['data-tauri-drag-region'];
    if (isClickableElement(el) && attr === undefined) return false;
    if (attr === undefined) continue;
    if (attr === 'false') return false;
    if (attr === 'deep') return true;
    if (attr === '' || attr === 'true') return el === composedPath[0];
  }
  return false;
}

describe('Tauri window top-bar drag regions', () => {
  it('matches Tauri 2 drag.js semantics: bare attr fails on child nodes, "deep" succeeds while skipping interactive controls', () => {
    const bareHeader: MockElement = { tagName: 'DIV', attrs: { 'data-tauri-drag-region': '' } };
    const deepHeader: MockElement = { tagName: 'DIV', attrs: { 'data-tauri-drag-region': 'deep' } };
    const titleNode: MockElement = { tagName: 'H1', attrs: {} };
    const buttonNode: MockElement = { tagName: 'BUTTON', attrs: {} };
    const inputNode: MockElement = { tagName: 'INPUT', attrs: {} };
    const optOutBox: MockElement = { tagName: 'DIV', attrs: { 'data-tauri-drag-region': 'false' } };
    const innerSpan: MockElement = { tagName: 'SPAN', attrs: {} };

    // Root cause demonstration: clicking child text/logo inside bare data-tauri-drag-region fails
    expect(isTauriDragRegion([titleNode, bareHeader])).toBe(false);
    // "deep" enables dragging on non-interactive children (icon, title, subtitle, empty flex gaps)
    expect(isTauriDragRegion([titleNode, deepHeader])).toBe(true);
    // Interactive controls inside a "deep" container remain clickable/editable
    expect(isTauriDragRegion([innerSpan, buttonNode, deepHeader])).toBe(false);
    expect(isTauriDragRegion([inputNode, deepHeader])).toBe(false);
    expect(isTauriDragRegion([innerSpan, optOutBox, deepHeader])).toBe(false);
  });

  it('uses data-tauri-drag-region="deep" (never bare attr on parent containers) in desktop window headers', () => {
    const sidebar = readSrc('components/Sidebar.tsx');
    expect(sidebar).toContain('data-tauri-drag-region="deep"');
    expect(sidebar).not.toMatch(/data-tauri-drag-region(?!=)/);

    const quickCapture = readSrc('components/QuickCaptureWindow.tsx');
    expect(quickCapture).toContain("standalone ? 'deep' : undefined");
    expect(quickCapture).not.toContain('standalone ? true : undefined');

    const sticky = readSrc('components/StickyNoteWindow.tsx');
    expect(sticky).toContain('data-tauri-drag-region="deep"');

    const inspector = readSrc('components/InspectorDrawer.tsx');
    expect(inspector).toContain('data-tauri-drag-region="deep"');
  });

  it('provides a top-bar data-tauri-drag-region="deep" across every main view so the full top edge drags when focused', () => {
    const views = [
      'views/TasksView.tsx',
      'views/KanbanView.tsx',
      'views/ScheduleView.tsx',
      'views/KnowledgeView.tsx',
      'views/NotesView.tsx',
      'views/StickiesView.tsx',
      'views/ProjectsView.tsx',
      'views/ReviewView.tsx',
      'views/SettingsView.tsx',
    ];

    for (const viewPath of views) {
      const src = readSrc(viewPath);
      expect(src, `${viewPath} must expose data-tauri-drag-region="deep" at its top bar`).toContain(
        'data-tauri-drag-region="deep"',
      );
    }
  });

  it('keeps a non-scrolling top drag strip on full-page scrollable views so dragging still works after scrolling', () => {
    for (const viewPath of ['views/NotesView.tsx', 'views/ReviewView.tsx', 'views/SettingsView.tsx']) {
      const src = readSrc(viewPath);
      expect(
        src,
        `${viewPath} must keep a shrink-0 top drag strip above its scroll container`,
      ).toMatch(/<div[^>]*data-tauri-drag-region="deep"[^>]*shrink-0[^>]*\/>/);
    }
  });
});
