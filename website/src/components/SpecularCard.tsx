import { useRef, type CSSProperties, type ReactNode } from 'react';

interface SpecularCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Liquid specular rim-light card.
 * Tracks cursor coordinates via CSS custom properties directly on the DOM node (zero React re-renders).
 */
export function SpecularCard({ children, className = '', style }: SpecularCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    el.style.setProperty('--my', `${e.clientY - rect.top}px`);
    el.style.setProperty('--spot-opacity', '1');
  };

  const handlePointerLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--spot-opacity', '0');
  };

  return (
    <div
      ref={ref}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={`specular-card relative overflow-hidden ${className}`}
      style={style}
    >
      <div className="specular-glow pointer-events-none absolute inset-0 z-0" aria-hidden="true" />
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}
