import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import type { AccentKey, ThemeMode } from '@/i18n/copy';

interface OpticalCausticsCanvasProps {
  theme: ThemeMode;
  accent: AccentKey;
}

const ACCENT_PALETTE: Record<
  AccentKey,
  { primary: [number, number, number]; secondary: [number, number, number] }
> = {
  blue: { primary: [10, 132, 255], secondary: [56, 189, 248] },
  indigo: { primary: [99, 102, 241], secondary: [56, 189, 248] },
  teal: { primary: [20, 184, 166], secondary: [56, 189, 248] },
  graphite: { primary: [148, 163, 184], secondary: [100, 116, 139] },
};

interface DepthParticle {
  x: number;
  y: number;
  r: number;
  z: number; // 0.3..1.0 parallax depth
  vx: number;
  vy: number;
  phase: number;
}

function createParticles(count: number): DepthParticle[] {
  const list: DepthParticle[] = [];
  for (let i = 0; i < count; i += 1) {
    // Deterministic pseudo-random distribution for crisp visual balance
    const s1 = Math.sin(i * 12.9898) * 43758.5453;
    const s2 = Math.sin(i * 78.233) * 43758.5453;
    const s3 = Math.sin(i * 45.164) * 43758.5453;
    const r1 = s1 - Math.floor(s1);
    const r2 = s2 - Math.floor(s2);
    const r3 = s3 - Math.floor(s3);
    const z = 0.28 + r3 * 0.72;
    list.push({
      x: r1,
      y: r2,
      r: 0.9 + z * 1.6,
      z,
      vx: (r1 - 0.5) * 0.000018,
      vy: -(0.000012 + z * 0.000018),
      phase: r2 * Math.PI * 2,
    });
  }
  return list;
}

/**
 * Scheme A + B Spatial Optical Backdrop:
 * - High-visibility flowing aurora prism silk ribbons (B)
 * - Scroll-choreographed chapter volumetric stage beams (A)
 * - 3-tier parallax optical depth dust particles (A)
 * - Cursor-illuminated architectural coordinate grid + crosshairs (A)
 * - Subtle studio frosted glass prism shimmer + fine optical film grain (A+B)
 */
export function OpticalCausticsCanvas({ theme, accent }: OpticalCausticsCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridOverlayRef = useRef<HTMLDivElement>(null);
  const prismLayerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  // Pointer coordinates stored in refs (zero React re-renders)
  const pointerTargetRef = useRef({ x: 0.5, y: 0.3, active: false });
  const pointerSmoothRef = useRef({ x: 0.5, y: 0.3 });

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      pointerTargetRef.current = {
        x: e.clientX / w,
        y: e.clientY / h,
        active: true,
      };
      const gridEl = gridOverlayRef.current;
      if (gridEl) {
        gridEl.style.setProperty('--bg-mx', `${e.clientX}px`);
        gridEl.style.setProperty('--bg-my', `${e.clientY}px`);
        gridEl.style.setProperty('--bg-spot', '1');
      }
    };

    const onPointerLeave = () => {
      pointerTargetRef.current.active = false;
      const gridEl = gridOverlayRef.current;
      if (gridEl) {
        gridEl.style.setProperty('--bg-spot', '0');
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('mouseleave', onPointerLeave);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('mouseleave', onPointerLeave);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let width = 0;
    let height = 0;
    const particles = createParticles(42);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize, { passive: true });

    const { primary: p, secondary: s } = ACCENT_PALETTE[accent];
    const isDark = theme === 'dark';

    const drawRibbon = (
      t: number,
      scrollP: number,
      yBaseRatio: number,
      amp: number,
      thickness: number,
      rgb: [number, number, number],
      fillAlpha: number,
      crestAlpha: number,
      phaseOffset: number,
    ) => {
      const yCenter = height * yBaseRatio + (scrollP - 0.5) * 90 * (phaseOffset > 1 ? -1 : 1);
      const step = Math.max(36, Math.floor(width / 28));

      ctx.beginPath();
      const topPts: Array<[number, number]> = [];
      for (let x = -step; x <= width + step; x += step) {
        const nx = x / Math.max(width, 1);
        const wave =
          Math.sin(nx * 4.2 + t * 0.9 + phaseOffset) * amp +
          Math.cos(nx * 2.1 - t * 0.65 + scrollP * 3.2) * (amp * 0.55);
        topPts.push([x, yCenter + wave]);
      }

      ctx.moveTo(topPts[0][0], topPts[0][1]);
      for (let i = 1; i < topPts.length; i += 1) {
        ctx.lineTo(topPts[i][0], topPts[i][1]);
      }
      for (let i = topPts.length - 1; i >= 0; i -= 1) {
        const [x, y] = topPts[i];
        const swell = thickness * (0.72 + 0.35 * Math.sin(i * 0.45 + t));
        ctx.lineTo(x, y + swell);
      }
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, yCenter - amp, 0, yCenter + amp + thickness);
      grad.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);
      grad.addColorStop(0.28, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${fillAlpha})`);
      grad.addColorStop(0.72, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${fillAlpha * 0.45})`);
      grad.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);
      ctx.fillStyle = grad;
      ctx.fill();

      // Luminous specular glass crest hairline along the top ridge
      ctx.beginPath();
      ctx.moveTo(topPts[0][0], topPts[0][1]);
      for (let i = 1; i < topPts.length; i += 1) {
        ctx.lineTo(topPts[i][0], topPts[i][1]);
      }
      const lineGrad = ctx.createLinearGradient(0, 0, width, 0);
      lineGrad.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);
      lineGrad.addColorStop(0.25, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${crestAlpha})`);
      lineGrad.addColorStop(0.55, `rgba(255, 255, 255, ${isDark ? crestAlpha * 0.65 : crestAlpha * 0.45})`);
      lineGrad.addColorStop(0.8, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${crestAlpha})`);
      lineGrad.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);
      ctx.strokeStyle = lineGrad;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    };

    const drawFrame = (timeMs: number) => {
      const t = timeMs * 0.00052;
      const scrollY = window.scrollY || 0;
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - height);
      const scrollP = Math.max(0, Math.min(1, scrollY / maxScroll));

      // Smooth pointer damping
      const pt = pointerTargetRef.current;
      const ps = pointerSmoothRef.current;
      ps.x += (pt.x - ps.x) * 0.08;
      ps.y += (pt.y - ps.y) * 0.08;

      // Gently shift the subtle studio glass prism parallax backdrop with scroll
      if (prismLayerRef.current) {
        const shiftY = Math.round(-scrollP * 48);
        const scale = (1.06 + scrollP * 0.06).toFixed(3);
        prismLayerRef.current.style.transform = `translate3d(0, ${shiftY}px, 0) scale(${scale})`;
      }

      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = isDark ? 'screen' : 'source-over';

      // 1. CHAPTER-CHOREOGRAPHED VOLUMETRIC STAGE BEAMS
      // Hero (0..0.28): Keynote top-center cone -> Cinema (0.28..0.58): Dual side ocean caustics ->
      // Exploded Glass (0.58..0.82): Center prism halo -> Download (0.82..1.0): Rising horizon glow
      const heroW = Math.max(0, 1 - scrollP / 0.34);
      const cinemaW = Math.max(0, 1 - Math.abs(scrollP - 0.42) / 0.28);
      const glassW = Math.max(0, 1 - Math.abs(scrollP - 0.68) / 0.24);
      const finaleW = Math.max(0, (scrollP - 0.72) / 0.28);

      // Chapter 0: Overhead Keynote Volumetric Cone
      if (heroW > 0.01) {
        const coneGrad = ctx.createRadialGradient(
          width * 0.5,
          -height * 0.08,
          width * 0.02,
          width * 0.5,
          height * 0.26,
          Math.max(width, height) * 0.62,
        );
        coneGrad.addColorStop(0, `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${(isDark ? 0.34 : 0.22) * heroW})`);
        coneGrad.addColorStop(0.45, `rgba(${s[0]}, ${s[1]}, ${s[2]}, ${(isDark ? 0.14 : 0.11) * heroW})`);
        coneGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = coneGrad;
        ctx.fillRect(0, 0, width, height);
      }

      // Chapter 1: Split Side Cinema Refraction Lobes
      if (cinemaW > 0.01) {
        const leftGrad = ctx.createRadialGradient(
          width * 0.06,
          height * 0.45,
          0,
          width * 0.06,
          height * 0.45,
          width * 0.45,
        );
        leftGrad.addColorStop(0, `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${(isDark ? 0.26 : 0.16) * cinemaW})`);
        leftGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = leftGrad;
        ctx.fillRect(0, 0, width, height);

        const rightGrad = ctx.createRadialGradient(
          width * 0.94,
          height * 0.55,
          0,
          width * 0.94,
          height * 0.55,
          width * 0.48,
        );
        rightGrad.addColorStop(0, `rgba(${s[0]}, ${s[1]}, ${s[2]}, ${(isDark ? 0.24 : 0.15) * cinemaW})`);
        rightGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rightGrad;
        ctx.fillRect(0, 0, width, height);
      }

      // Chapter 2: Centered Optical Prism Ring Halo behind Exploded Glass
      if (glassW > 0.01) {
        const cx = width * 0.38;
        const cy = height * 0.52;
        const ringGrad = ctx.createRadialGradient(cx, cy, width * 0.04, cx, cy, width * 0.42);
        ringGrad.addColorStop(0, `rgba(${s[0]}, ${s[1]}, ${s[2]}, ${(isDark ? 0.28 : 0.18) * glassW})`);
        ringGrad.addColorStop(0.55, `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${(isDark ? 0.16 : 0.10) * glassW})`);
        ringGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = ringGrad;
        ctx.fillRect(0, 0, width, height);
      }

      // Chapter 3: Rising Horizon Finale Glow
      if (finaleW > 0.01) {
        const botGrad = ctx.createRadialGradient(
          width * 0.5,
          height * 1.06,
          width * 0.05,
          width * 0.5,
          height * 0.85,
          width * 0.58,
        );
        botGrad.addColorStop(0, `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${(isDark ? 0.30 : 0.19) * finaleW})`);
        botGrad.addColorStop(0.5, `rgba(${s[0]}, ${s[1]}, ${s[2]}, ${(isDark ? 0.12 : 0.08) * finaleW})`);
        botGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = botGrad;
        ctx.fillRect(0, 0, width, height);
      }

      // 2. HIGH-VISIBILITY FLOWING AURORA PRISM SILK RIBBONS (Scheme B)
      drawRibbon(t, scrollP, 0.24, 54, 150, p, isDark ? 0.19 : 0.13, isDark ? 0.34 : 0.24, 0.2);
      drawRibbon(t * 1.15, scrollP, 0.52, 64, 170, s, isDark ? 0.15 : 0.11, isDark ? 0.26 : 0.18, 2.3);
      drawRibbon(t * 0.85, scrollP, 0.78, 46, 130, p, isDark ? 0.14 : 0.09, isDark ? 0.22 : 0.16, 4.4);

      // 3. INTERACTIVE CURSOR OPTICAL SEARCHLIGHT GLOW
      const mx = ps.x * width;
      const my = ps.y * height;
      const spotGrad = ctx.createRadialGradient(mx, my, 0, mx, my, 280);
      spotGrad.addColorStop(0, `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${isDark ? 0.16 : 0.10})`);
      spotGrad.addColorStop(0.5, `rgba(${s[0]}, ${s[1]}, ${s[2]}, ${isDark ? 0.06 : 0.04})`);
      spotGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = spotGrad;
      ctx.fillRect(mx - 280, my - 280, 560, 560);

      // 4. 3-TIER PARALLAX DEPTH DUST PARTICLES (Scheme A)
      ctx.globalCompositeOperation = 'source-over';
      for (const ptcl of particles) {
        const px = ((ptcl.x + t * ptcl.vx * 850) % 1 + 1) % 1;
        const parallaxShift = (scrollY * ptcl.z * 0.00022) % 1;
        const py = ((ptcl.y + t * ptcl.vy * 850 - parallaxShift) % 1 + 1) % 1;
        const twinkle = 0.45 + 0.55 * Math.sin(t * 2.4 + ptcl.phase);
        const alpha = (isDark ? 0.55 : 0.42) * ptcl.z * twinkle;

        const cx = px * width;
        const cy = py * height;
        ctx.beginPath();
        ctx.arc(cx, cy, ptcl.r, 0, Math.PI * 2);
        ctx.fillStyle = isDark
          ? `rgba(${Math.round((p[0] + 255) / 2)}, ${Math.round((p[1] + 255) / 2)}, 255, ${alpha})`
          : `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${alpha})`;
        ctx.fill();
      }
    };

    if (reduceMotion) {
      drawFrame(1800);
      return () => window.removeEventListener('resize', resize);
    }

    const loop = (now: number) => {
      if (!document.hidden) {
        drawFrame(now);
      }
      rafId = window.requestAnimationFrame(loop);
    };
    rafId = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [theme, accent, reduceMotion]);

  const prismArtSrc =
    theme === 'dark'
      ? `${import.meta.env.BASE_URL}images/obsidian-glass-art.jpg`
      : `${import.meta.env.BASE_URL}images/porcelain-glass-art.jpg`;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Subtle Studio Architectural Frosted Glass Parallax Shimmer Layer (Scheme B) */}
      <div
        ref={prismLayerRef}
        className="absolute inset-0 transition-opacity duration-500 will-change-transform"
        style={{
          opacity: theme === 'dark' ? 0.16 : 0.22,
          maskImage:
            'radial-gradient(82% 72% at 50% 36%, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.35) 60%, transparent 100%)',
          WebkitMaskImage:
            'radial-gradient(82% 72% at 50% 36%, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.35) 60%, transparent 100%)',
        }}
      >
        <img
          src={prismArtSrc}
          alt=""
          className="h-full w-full object-cover"
          style={{
            mixBlendMode: theme === 'dark' ? 'screen' : 'multiply',
            filter: theme === 'dark' ? 'saturate(1.25) contrast(1.08)' : 'saturate(1.1) contrast(1.04)',
          }}
        />
      </div>

      {/* Live 60fps Flowing Aurora Silk + Volumetric Chapter Beams + 3-Tier Depth Particles */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* Base Ambient Precision Architectural Grid (Scheme A) */}
      <div className="site-arch-grid absolute inset-0" />

      {/* Cursor-Illuminated Sapphire Architectural Grid Searchlight (Scheme A) */}
      <div ref={gridOverlayRef} className="site-arch-grid-lit absolute inset-0" />

      {/* Fine Anti-Banding Optical Film Grain Surface Texture */}
      <div className="site-optical-grain absolute inset-0" />
    </div>
  );
}
