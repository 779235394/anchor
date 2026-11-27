import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, action }: EmptyStateProps) {
  return (
    <div className="py-12 px-6 flex flex-col items-center justify-center text-center gap-3">
      <div
        className="w-14 h-14 rounded-2xl inline-flex items-center justify-center"
        style={{
          background: 'var(--bg-subtle)',
          border: '1px solid var(--hairline-soft)',
          boxShadow: 'var(--glass-specular)',
          color: 'var(--text-4)',
        }}
      >
        {icon}
      </div>
      <div className="text-[13.5px] font-medium" style={{ color: 'var(--text-3)' }}>
        {title}
      </div>
      {action && <div className="mt-0.5">{action}</div>}
    </div>
  );
}
