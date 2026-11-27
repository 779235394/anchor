import { useRef, type ReactNode } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring } from 'motion/react';

interface MagneticButtonProps {
  href?: string;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
  target?: string;
  rel?: string;
}

/**
 * Tactile magnetic pull button using MotionValues (zero useState re-renders).
 */
export function MagneticButton({
  href,
  onClick,
  className = '',
  children,
  target,
  rel,
}: MagneticButtonProps) {
  const ref = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 260, damping: 20 });
  const springY = useSpring(y, { stiffness: 260, damping: 20 });

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (reduceMotion || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const dx = (e.clientX - (rect.left + rect.width / 2)) * 0.16;
    const dy = (e.clientY - (rect.top + rect.height / 2)) * 0.22;
    x.set(dx);
    y.set(dy);
  };

  const handlePointerLeave = () => {
    x.set(0);
    y.set(0);
  };

  if (href) {
    return (
      <motion.a
        ref={ref as React.RefObject<HTMLAnchorElement>}
        href={href}
        target={target}
        rel={rel}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        style={reduceMotion ? undefined : { x: springX, y: springY }}
        whileTap={reduceMotion ? undefined : { scale: 0.97 }}
        className={className}
      >
        {children}
      </motion.a>
    );
  }

  return (
    <motion.button
      ref={ref as React.RefObject<HTMLButtonElement>}
      type="button"
      onClick={onClick}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={reduceMotion ? undefined : { x: springX, y: springY }}
      whileTap={reduceMotion ? undefined : { scale: 0.97 }}
      className={className}
    >
      {children}
    </motion.button>
  );
}
