import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, action }: EmptyStateProps) {
  return (
    <div className="py-12 px-6 flex flex-col items-center justify-center text-center gap-2.5">
      <div style={{ color: 'var(--text-4)' }}>{icon}</div>
      <div className="text-[13.5px]" style={{ color: 'var(--text-3)' }}>
        {title}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
