import type { ClipboardEventHandler, ReactNode } from 'react';
import { X } from 'lucide-react';

interface InspectorDrawerProps {
  title: string;
  badge?: ReactNode;
  onClose: () => void;
  onPaste?: ClipboardEventHandler<HTMLElement>;
  children: ReactNode;
  footer?: ReactNode;
}

export function InspectorDrawer({
  title,
  badge,
  onClose,
  onPaste,
  children,
  footer,
}: InspectorDrawerProps) {
  return (
    <aside
      onPaste={onPaste}
      className="w-[300px] shrink-0 h-full flex flex-col ap-inspector-enter select-none"
      style={{
        background: 'var(--bg-sidebar)',
        borderLeft: '1px solid var(--hairline)',
      }}
    >
      <div
        className="flex items-center justify-between gap-2 px-5 py-4 shrink-0"
        style={{ borderBottom: '1px solid var(--hairline-soft)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-[11px] font-semibold uppercase tracking-wider truncate"
            style={{ color: 'var(--text-3)' }}
          >
            {title}
          </span>
          {badge}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle-hover)]"
          style={{ color: 'var(--text-3)' }}
          aria-label="Close Inspector"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 select-text">
        {children}
      </div>

      {footer && (
        <div
          className="px-5 py-3.5 shrink-0 flex items-center gap-2"
          style={{ borderTop: '1px solid var(--hairline-soft)' }}
        >
          {footer}
        </div>
      )}
    </aside>
  );
}
