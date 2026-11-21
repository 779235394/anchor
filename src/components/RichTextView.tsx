import { useMemo } from 'react';
import { markdownToHtml, sanitizeHref } from '@/domain/markdown';
import { storageApi } from '@/services/storage';

interface RichTextViewProps {
  markdown: string;
  className?: string;
  onToggleTaskItem?: (index: number) => void;
}

/**
 * Lightweight read-only rich-text renderer for Markdown notes & descriptions.
 * Supports safe system-browser external link opens and direct 1-click checklist toggling.
 */
export function RichTextView({
  markdown,
  className = '',
  onToggleTaskItem,
}: RichTextViewProps) {
  const html = useMemo(() => markdownToHtml(markdown), [markdown]);

  if (!html) return null;

  return (
    <div
      className={`ap-prose ${className}`}
      onClick={(e) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;

        // 1. Direct interactive task checklist checkbox toggle
        if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox') {
          if (!onToggleTaskItem) return;
          e.stopPropagation();
          const container = e.currentTarget;
          const allCheckboxes = Array.from(
            container.querySelectorAll('ul[data-type="taskList"] input[type="checkbox"]'),
          );
          const idx = allCheckboxes.indexOf(target as HTMLInputElement);
          if (idx >= 0) {
            onToggleTaskItem(idx);
          }
          return;
        }

        // Prevent clicking inside a task checkbox label from opening edit mode
        if (target.closest('ul[data-type="taskList"] label') && onToggleTaskItem) {
          e.stopPropagation();
          return;
        }

        // 2. External link click -> open safely in system browser
        const anchor = target.closest('a') as HTMLAnchorElement | null;
        if (anchor) {
          e.preventDefault();
          e.stopPropagation();
          const safe = sanitizeHref(anchor.getAttribute('href') || '');
          if (safe) {
            void storageApi.openExternalUrl(safe);
          }
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
