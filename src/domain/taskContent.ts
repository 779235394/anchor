import type { Attachment, Lang, Task } from './types';
import { markdownToPlainText } from './markdown';

const MAX_DERIVED_TITLE_LEN = 140;

function firstNonEmptyPlainLine(markdown: string): string {
  const plain = markdownToPlainText(markdown || '');
  for (const rawLine of plain.split(/\r?\n/)) {
    const clean = rawLine.replace(/\s+/g, ' ').trim();
    if (clean) {
      return clean.slice(0, MAX_DERIVED_TITLE_LEN);
    }
  }
  return '';
}

/**
 * Derives a compact single-line display title from unified Markdown task content,
 * falling back to the first attachment name when a task contains only media/files.
 */
export function deriveTaskTitle(
  content: string,
  attachments?: Attachment[],
  fallback = '',
): string {
  const fromText = firstNonEmptyPlainLine(content);
  if (fromText) return fromText;
  const attName = attachments?.[0]?.name?.trim();
  if (attName) return attName.slice(0, MAX_DERIVED_TITLE_LEN);
  return fallback;
}

/**
 * Returns the unified Markdown body to load into a single-box task editor.
 * Seamlessly preserves legacy tasks that stored separate `title` and `note`:
 * - If `note` already starts with `title` (unified format), returns `note` verbatim (preserves cursor/whitespace).
 * - If `note` is empty, returns `title`.
 * - If legacy `title` and `note` differ on the first line, joins them as `title + "\n\n" + note`.
 */
export function getTaskEditorContent(
  task: Pick<Task, 'title' | 'note'>,
): string {
  const rawNote = task.note ?? '';
  const cleanTitle = (task.title || '').trim();
  if (!rawNote.trim()) {
    return cleanTitle;
  }
  if (!cleanTitle) {
    return rawNote;
  }
  const firstNoteLine = firstNonEmptyPlainLine(rawNote);
  if (
    firstNoteLine === cleanTitle ||
    firstNoteLine.startsWith(cleanTitle) ||
    cleanTitle.startsWith(firstNoteLine)
  ) {
    return rawNote;
  }
  return `${cleanTitle}\n\n${rawNote}`;
}

/**
 * Builds `{ title, note }` from unified editor Markdown without trimming trailing
 * whitespace/newlines in `note` (safe for live controlled TipTap editing).
 */
export function buildTaskFieldsFromContent(
  content: string,
  attachments?: Attachment[],
  trimNote = false,
): { title: string; note: string } {
  const note = trimNote ? content.trim() : content;
  const title = deriveTaskTitle(content, attachments);
  return { title, note };
}

/**
 * Returns compact single-line display title for lists, Kanban cards, calendar pills, and reports.
 */
export function getTaskDisplayTitle(
  task: Pick<Task, 'title' | 'note' | 'attachments'>,
  lang: Lang = 'zh',
): string {
  const explicit = (task.title || '').trim();
  if (explicit) return explicit;
  const derived = deriveTaskTitle(task.note || '', task.attachments);
  if (derived) return derived;
  return lang === 'en' ? 'Untitled task' : '未命名待办';
}

/**
 * Returns secondary preview text *excluding* the first line when it already matches `task.title`,
 * preventing duplicate text under single-line unified tasks in mobile cards & review details.
 */
export function getTaskSecondaryPreview(
  task: Pick<Task, 'title' | 'note'>,
): string {
  const rawNote = (task.note || '').trim();
  if (!rawNote) return '';
  const cleanTitle = (task.title || '').trim();
  const plainLines = markdownToPlainText(rawNote)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (plainLines.length === 0) return '';

  const first = plainLines[0];
  const startsWithTitle =
    !!cleanTitle &&
    (first === cleanTitle || first.startsWith(cleanTitle) || cleanTitle.startsWith(first));

  const rest = startsWithTitle ? plainLines.slice(1) : plainLines;
  return rest.join(' · ').trim();
}
