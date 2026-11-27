import { useRef } from 'react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';
import {
  DeviceMobile,
  DownloadSimple,
  Lightning,
  Play,
  PushPin,
  ShieldCheck,
} from '@phosphor-icons/react';
import type { Lang, SiteCopy, ThemeMode } from '@/i18n/copy';
import { MagneticButton } from './MagneticButton';

interface HeroCinemaProps {
  copy: SiteCopy;
  lang: Lang;
  theme: ThemeMode;
  primaryCtaLabel: string;
}

/**
 * Panoramic 3D Tilt-to-Flat Real Desktop Showcase Hero.
 * Features scroll-scrubbed perspective unfolding + 3 Z-axis parallax floating glass satellites.
 */
export function HeroCinema({ copy, lang, theme, primaryCtaLabel }: HeroCinemaProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  // Scroll-driven 3D unfolding: pitched 14deg -> flat 0deg as the user scrolls
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });

  const smoothProgress = useSpring(scrollYProgress, { stiffness: 140, damping: 24 });
  const scrollRotateX = useTransform(smoothProgress, [0, 0.42], [13, 0]);
  const scrollScale = useTransform(smoothProgress, [0, 0.42], [0.93, 1.0]);
  const scrollFrameY = useTransform(smoothProgress, [0, 0.55], [0, -28]);

  // Multi-speed Z-axis parallax offsets for the 3 floating glass satellites
  const fastSatelliteY = useTransform(smoothProgress, [0, 1], [0, -110]);
  const medSatelliteY = useTransform(smoothProgress, [0, 1], [0, -72]);
  const slowSatelliteY = useTransform(smoothProgress, [0, 1], [0, -40]);

  // Subtle pointer specular tilt on top of the scroll tilt
  const ptrX = useMotionValue(0);
  const ptrY = useMotionValue(0);
  const pointerRotateY = useSpring(useTransform(ptrX, [-0.5, 0.5], [-3.5, 3.5]), {
    stiffness: 160,
    damping: 22,
  });

  const handleFrameMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduceMotion || !frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    ptrX.set((e.clientX - rect.left) / rect.width - 0.5);
    ptrY.set((e.clientY - rect.top) / rect.height - 0.5);
    frameRef.current.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    frameRef.current.style.setProperty('--my', `${e.clientY - rect.top}px`);
    frameRef.current.style.setProperty('--spot-opacity', '1');
  };

  const handleFrameLeave = () => {
    ptrX.set(0);
    ptrY.set(0);
    if (frameRef.current) {
      frameRef.current.style.setProperty('--spot-opacity', '0');
    }
  };

  const desktopFrameSrc =
    theme === 'dark'
      ? `${import.meta.env.BASE_URL}images/app-tasks-dark.jpg`
      : `${import.meta.env.BASE_URL}images/app-tasks-light.jpg`;

  return (
    <section
      id="top"
      ref={sectionRef}
      className="relative flex min-h-[100dvh] flex-col justify-start overflow-x-clip pt-24 pb-16 sm:pt-28 sm:pb-24"
    >
      <div className="mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:px-8">
        {/* Centered Panoramic Editorial Stack (Strictly <= 3 text/action units) */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto max-w-[780px] text-center"
        >
          <h1
            className="text-[36px] font-bold tracking-[-0.04em] leading-[1.12] sm:text-[52px] lg:text-[62px]"
            style={{ color: 'var(--text-1)', textWrap: 'balance' }}
          >
            {copy.hero.titleLine1}
          </h1>

          <p
            className="mx-auto mt-4 max-w-[54ch] text-[15.5px] leading-[1.68] sm:text-[17.5px]"
            style={{ color: 'var(--text-2)' }}
          >
            {copy.hero.subtext}
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3.5">
            <MagneticButton
              href="#download"
              className="site-btn-primary h-12 px-7 text-[15px]"
            >
              <DownloadSimple size={18} weight="bold" />
              <span>{primaryCtaLabel}</span>
            </MagneticButton>

            <MagneticButton
              href="#showcase"
              className="site-btn-secondary h-12 px-6 text-[15px]"
            >
              <Play size={16} weight="fill" style={{ color: 'var(--accent)' }} />
              <span>{lang === 'zh' ? '进入真机沉浸体验' : 'Try Live Desktop'}</span>
            </MagneticButton>
          </div>
        </motion.div>

        {/* Monumental 3D Perspective Real Desktop Stage + 3 Parallax Floating Satellites */}
        <div
          className="relative mx-auto mt-10 max-w-[1160px] sm:mt-14"
          style={{ perspective: 1500 }}
        >
          {/* Ambient optical back-halo behind real desktop frame */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-x-6 -top-8 bottom-8 rounded-[36px] blur-3xl transition-opacity duration-500"
            style={{
              background:
                'radial-gradient(62% 58% at 50% 24%, var(--accent-glow), transparent 72%)',
              opacity: theme === 'dark' ? 0.55 : 0.34,
            }}
          />

          <motion.div
            ref={frameRef}
            onPointerMove={handleFrameMove}
            onPointerLeave={handleFrameLeave}
            initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.65, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            style={
              reduceMotion
                ? undefined
                : {
                    rotateX: scrollRotateX,
                    rotateY: pointerRotateY,
                    scale: scrollScale,
                    y: scrollFrameY,
                    transformOrigin: '50% 20%',
                  }
            }
            className="specular-card relative overflow-hidden rounded-[22px] border p-1.5 sm:rounded-[26px] sm:p-2"
          >
            <div className="specular-glow pointer-events-none absolute inset-0 z-20" aria-hidden="true" />

            {/* macOS Frosted Glass Window Chrome */}
            <div
              className="relative overflow-hidden rounded-[17px] border sm:rounded-[20px]"
              style={{
                background: 'var(--bg-card-solid)',
                borderColor: 'var(--hairline)',
                boxShadow: 'var(--shadow-shell)',
              }}
            >
              <div
                className="flex h-9 items-center justify-between gap-2 border-b px-3.5"
                style={{
                  background: 'var(--bg-header-glass)',
                  borderColor: 'var(--hairline-soft)',
                }}
              >
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                </div>
                <span className="min-w-0 truncate font-mono text-[11px]" style={{ color: 'var(--text-3)' }}>
                  Anchor · Porcelain &amp; Obsidian Workbench
                </span>
                <a
                  href="#showcase"
                  className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors hover:opacity-90"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  {lang === 'zh' ? '自由试玩' : 'Live'}
                </a>
              </div>

              {/* Authentic 1280x800 Real Anchor Desktop Frame */}
              <div className="relative aspect-[16/10] w-full overflow-hidden">
                <img
                  src={desktopFrameSrc}
                  alt={
                    lang === 'zh'
                      ? 'Anchor 真实桌面端白瓷与曜石玻璃主界面'
                      : 'Anchor real desktop Porcelain and Obsidian Glass workbench'
                  }
                  className="h-full w-full object-cover object-top transition-opacity duration-300"
                />
              </div>
            </div>
          </motion.div>

          {/* Satellite 1 (Top-Left, Fast Parallax): L4 Global Quick Capture Island */}
          <motion.div
            style={reduceMotion ? undefined : { y: fastSatelliteY }}
            initial={reduceMotion ? false : { opacity: 0, x: -22 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.65, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="site-float pointer-events-none absolute -top-5 -left-4 z-30 hidden w-[238px] rounded-[16px] p-3.5 xl:block"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold">
                <Lightning size={15} weight="duotone" style={{ color: 'var(--accent)' }} />
                <span>{copy.hero.stageQuickLabel}</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="site-kbd">⌥</kbd>
                <kbd className="site-kbd">Space</kbd>
              </div>
            </div>
            <p className="mt-2 text-[11.5px] leading-[1.45]" style={{ color: 'var(--text-2)' }}>
              {copy.hero.stageQuickHint}
            </p>
          </motion.div>

          {/* Satellite 2 (Top-Right, Medium Parallax): Pinned Frosted Desktop Sticky */}
          <motion.div
            style={
              reduceMotion
                ? {
                    background: 'var(--sticky-yellow-bg)',
                    borderColor: 'var(--sticky-yellow-border)',
                  }
                : {
                    y: medSatelliteY,
                    rotate: 2.2,
                    background: 'var(--sticky-yellow-bg)',
                    borderColor: 'var(--sticky-yellow-border)',
                  }
            }
            initial={reduceMotion ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.65, delay: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none absolute top-14 -right-5 z-30 hidden w-[224px] rounded-[16px] border p-3.5 shadow-2xl xl:block"
          >
            <div className="flex items-center justify-between">
              <span
                className="text-[11.5px] font-semibold"
                style={{ color: 'var(--sticky-yellow-accent)' }}
              >
                {copy.hero.stageStickyTitle}
              </span>
              <PushPin size={13} weight="fill" style={{ color: 'var(--sticky-yellow-accent)' }} />
            </div>
            <p className="mt-1.5 text-[12px] leading-[1.5]" style={{ color: 'var(--text-1)' }}>
              {copy.hero.stageStickyBody}
            </p>
          </motion.div>

          {/* Satellite 3 (Bottom-Right, Slow Parallax): Mobile QR Companion Sync Card */}
          <motion.div
            style={reduceMotion ? undefined : { y: slowSatelliteY }}
            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.34, ease: [0.22, 1, 0.36, 1] }}
            className="site-float pointer-events-none absolute -right-3 -bottom-6 z-30 hidden w-[246px] rounded-[18px] p-3.5 xl:block"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold">
                <DeviceMobile size={15} weight="duotone" style={{ color: 'var(--accent)' }} />
                <span>Anchor Mobile</span>
              </div>
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                style={{ background: 'var(--status-green-soft)', color: 'var(--status-green)' }}
              >
                <ShieldCheck size={11} weight="fill" />
                <span>HTTPS</span>
              </span>
            </div>
            <p className="mt-2 text-[11.5px] leading-[1.45]" style={{ color: 'var(--text-2)' }}>
              {lang === 'zh'
                ? '手机 4G/5G 扫码直连电脑本地主机，毫秒双向同步'
                : 'Scan QR over any network to sync live with your desktop'}
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
