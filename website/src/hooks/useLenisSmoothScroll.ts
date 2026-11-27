import { useEffect, useRef } from 'react';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useReducedMotion } from 'motion/react';

gsap.registerPlugin(ScrollTrigger);

/**
 * Desktop-only silky smooth scrolling synchronized with GSAP ScrollTrigger.
 * Disabled automatically on touch/narrow viewports and prefers-reduced-motion.
 */
export function useLenisSmoothScroll(paused = false) {
  const reduceMotion = useReducedMotion();
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    if (reduceMotion) return;
    if (typeof window === 'undefined' || window.innerWidth < 1024) return;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (coarse) return;

    const lenis = new Lenis({
      duration: 1.05,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.5,
    });
    lenisRef.current = lenis;

    lenis.on('scroll', ScrollTrigger.update);

    const tick = (time: number) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [reduceMotion]);

  useEffect(() => {
    const lenis = lenisRef.current;
    if (!lenis) return;
    if (paused) {
      lenis.stop();
    } else {
      lenis.start();
    }
  }, [paused]);
}
