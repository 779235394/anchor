import type { ClipboardEventHandler, ReactNode } from 'react';
import { X } from 'lucide-react';

interface InspectorDrawerProps {
  title: string;
  badge?: ReactNode;
  onClose: () => void;
  onPaste?: ClipboardEventHandler<HTMLElement>;
  children: ReactNode;
  footer?: ReactNode;
  /** When true, floats over the right edge without shrinking sibling layout. */
  overlay?: boolean;
}

export function InspectorDrawer({
  title,
  badge,
  onClose,
  onPaste,
  children,
  footer,
  overlay = false,
}: InspectorDrawerProps) {
  return (
    <aside
      onPaste={onPaste}
      className={
        overlay
          ? 'absolute top-2.5 right-2.5 bottom-2.5 z-30 w-[356px] max-w-[calc(100%-20px)] rounded-[14px] flex flex-col overflow-hidden ap-inspector-enter ap-glass-float select-none'
          : 'w-[300px] shrink-0 h-full flex flex-col ap-inspector-enter ap-glass-l1 select-none'
      }
      style={
        overlay
          ? undefined
          : {
              borderLeft: '1px solid var(--hairline)',
            }
      }
    >
      <div
        data-tauri-drag-region="deep"
        className="flex items-center justify-between gap-2 px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--hairline-soft)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-[11px] font-semibold uppercase tracking-[0.06em] truncate"
            style={{ color: 'var(--text-3)' }}
          >
            {title}
          </span>
          {badge}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded-[8px] inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle-hover)]"
          style={{ color: 'var(--text-3)' }}
          aria-label="Close Inspector"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 select-text">
        {children}
      </div>

      {footer && (
        <div
          className="px-4 py-3 shrink-0 flex items-center gap-2"
          style={{ borderTop: '1px solid var(--hairline-soft)' }}
        >
          {footer}
        </div>
      )}
    </aside>
  );
}
