import type { Priority } from '@/domain/types';

export const PRIO_COLORS: Record<Priority, { color: string; soft: string }> = {
  1: { color: 'var(--status-red)', soft: 'var(--status-red-soft)' },
  2: { color: 'var(--status-orange)', soft: 'var(--status-orange-soft)' },
  3: { color: 'var(--status-sky)', soft: 'var(--status-sky-soft)' },
  4: { color: 'var(--status-gray)', soft: 'var(--bg-subtle)' },
};

interface CircularCheckProps {
  checked: boolean;
  onChange: () => void;
  prio?: Priority;
  color?: string;
  size?: number;
  ariaLabel?: string;
}

export function CircularCheck({
  checked,
  onChange,
  prio,
  color,
  size = 18,
  ariaLabel,
}: CircularCheckProps) {
  const ringColor = checked
    ? 'var(--status-green)'
    : color || (prio ? PRIO_COLORS[prio].color : 'var(--text-4)');

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className="inline-flex items-center justify-center rounded-full shrink-0 transition-transform duration-150 hover:scale-108 active:scale-92"
      style={{
        width: size,
        height: size,
        borderWidth: '1.8px',
        borderStyle: 'solid',
        borderColor: ringColor,
        backgroundColor: checked
          ? 'var(--status-green)'
          : `color-mix(in srgb, ${ringColor} 9%, transparent)`,
        boxShadow: checked
          ? '0 1px 4px color-mix(in srgb, var(--status-green) 36%, transparent)'
          : 'none',
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          width: Math.round(size * 0.56),
          height: Math.round(size * 0.56),
          opacity: checked ? 1 : 0,
          transform: checked ? 'scale(1)' : 'scale(0.55)',
          transition: 'all 160ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </button>
  );
}
