export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  danger?: boolean;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <div
      className="inline-flex items-center p-0.5 rounded-[10px] gap-0.5 flex-wrap"
      style={{ background: 'var(--bg-subtle)' }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="px-2.5 py-1 rounded-[8px] text-[12.5px] font-medium ap-ease inline-flex items-center gap-1.5"
            style={{
              background: active ? 'var(--seg-active-bg)' : 'transparent',
              color: active
                ? 'var(--text-1)'
                : opt.danger && opt.count
                  ? 'var(--status-red)'
                  : 'var(--text-2)',
              boxShadow: active ? 'var(--seg-active-shadow)' : 'none',
            }}
          >
            <span>{opt.label}</span>
            {opt.count !== undefined && opt.count > 0 && (
              <span
                className="text-[11px] font-semibold px-1.5 rounded-full"
                style={{
                  background: opt.danger
                    ? 'var(--status-red-soft)'
                    : active
                      ? 'var(--bg-subtle)'
                      : 'transparent',
                  color: opt.danger ? 'var(--status-red)' : 'var(--text-3)',
                }}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
