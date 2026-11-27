import { useRef, useState } from 'react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react';
import {
  Check,
  DownloadSimple,
  GitBranch,
  GithubLogo,
  Lightning,
  PushPin,
} from '@phosphor-icons/react';
import { REPO_URL, type SiteCopy, type ThemeMode } from '@/i18n/copy';

interface HeroStageProps {
  copy: SiteCopy;
  theme: ThemeMode;
  primaryCtaLabel: string;
}

const PRIO_COLOR: Record<'P1' | 'P2' | 'P3', string> = {
  P1: 'var(--status-red)',
  P2: 'var(--status-orange)',
  P3: 'var(--status-sky)',
};

export function HeroStage({ copy, theme, primaryCtaLabel }: HeroStageProps) {
  const reduceMotion = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);

  const [doneMap, setDoneMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(copy.hero.stageTodoItems.map((item) => [item.id, item.done])),
  );

  // Zero-rerender pointer tilt physics via MotionValues
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const rotateX = useSpring(useTransform(pointerY, [-0.5, 0.5], [7, -7]), {
    stiffness: 180,
    damping: 22,
  });
  const rotateY = useSpring(useTransform(pointerX, [-0.5, 0.5], [-8, 8]), {
    stiffness: 180,
    damping: 22,
  });
  const floatOffsetX = useSpring(useTransform(pointerX, [-0.5, 0.5], [-12, 12]), {
    stiffness: 140,
    damping: 20,
  });
  const floatOffsetY = useSpring(useTransform(pointerY, [-0.5, 0.5], [-10, 10]), {
    stiffness: 140,
    damping: 20,
  });

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduceMotion || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    pointerX.set(nx);
    pointerY.set(ny);
  };

  const handlePointerLeave = () => {
    pointerX.set(0);
    pointerY.set(0);
  };

  const toggleTodo = (id: string) => {
    setDoneMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const artSrc =
    theme === 'dark'
      ? `${import.meta.env.BASE_URL}images/obsidian-glass-art.jpg`
      : `${import.meta.env.BASE_URL}images/porcelain-glass-art.jpg`;

  const remaining = copy.hero.stageTodoItems.filter((item) => !doneMap[item.id]).length;

  return (
    <section
      id="top"
      className="relative flex min-h-[100dvh] items-center pt-24 pb-14 md:pt-24 md:pb-16"
    >
      <div className="mx-auto grid w-full max-w-[1320px] grid-cols-1 items-center gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:gap-12 lg:px-8">
        {/* Left: Strictly focused value proposition (Headline + Subtext + 2 CTAs) */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          className="lg:col-span-5"
        >
          <h1
            className="text-[32px] font-bold tracking-[-0.035em] leading-[1.16] sm:text-[40px] xl:text-[44px]"
            style={{ color: 'var(--text-1)', textWrap: 'balance' }}
          >
            <span className="block">{copy.hero.titleLine1}</span>
            <span
              className="mt-2 block text-[22px] font-semibold tracking-[-0.025em] sm:text-[28px] xl:text-[30px]"
              style={{ color: 'var(--text-2)' }}
            >
              {copy.hero.titleLine2}
            </span>
          </h1>

          <p
            className="mt-6 max-w-[44ch] text-[15.5px] leading-[1.68] sm:text-[16.5px]"
            style={{ color: 'var(--text-2)' }}
          >
            {copy.hero.subtext}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3.5">
            <a href="#download" className="site-btn-primary h-12 px-6 text-[14.5px]">
              <DownloadSimple size={18} weight="bold" />
              <span>{primaryCtaLabel}</span>
            </a>

            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="site-btn-secondary h-12 px-5 text-[14.5px]"
            >
              <GithubLogo size={18} weight="duotone" />
              <span>{copy.cta.viewGithub}</span>
            </a>
          </div>
        </motion.div>

        {/* Right: 3D Pointer-Parallax Frosted Glass Architectural Stage + Live Interactive Cards */}
        <motion.div
          ref={stageRef}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          initial={reduceMotion ? false : { opacity: 0, scale: 0.98, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.48, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
          className="relative lg:col-span-7"
          style={{ perspective: 1200 }}
        >
          <motion.div
            style={
              reduceMotion
                ? { borderColor: 'var(--bg-shell-border)' }
                : {
                    rotateX,
                    rotateY,
                    transformStyle: 'preserve-3d',
                    borderColor: 'var(--bg-shell-border)',
                  }
            }
            className="relative overflow-hidden rounded-[24px] border p-4 sm:p-6"
          >
            {/* Studio Frosted Glass Architectural Backdrop */}
            <img
              src={artSrc}
              alt="Anchor Porcelain and Obsidian architectural glass surface"
              className="pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
              style={{ opacity: theme === 'dark' ? 0.62 : 0.78 }}
            />
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  theme === 'dark'
                    ? 'linear-gradient(145deg, rgba(8,10,16,0.42) 0%, rgba(8,10,16,0.72) 100%)'
                    : 'linear-gradient(145deg, rgba(230,236,245,0.28) 0%, rgba(230,236,245,0.68) 100%)',
                boxShadow: 'var(--glass-specular)',
              }}
            />

            {/* Main Live Glass Workbench Card */}
            <div className="relative z-10 grid grid-cols-1 gap-4 sm:grid-cols-12">
              <div className="site-glass-shell rounded-[18px] p-4 sm:col-span-7 sm:p-5">
                <div className="mb-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[14px] font-semibold tracking-tight"
                      style={{ color: 'var(--text-1)' }}
                    >
                      {copy.hero.stageTodoTitle}
                    </span>
                    <span
                      className="tabular-nums rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      {remaining}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                  </div>
                </div>

                <div className="space-y-2">
                  {copy.hero.stageTodoItems.map((item) => {
                    const checked = !!doneMap[item.id];
                    return (
                      <motion.button
                        key={item.id}
                        type="button"
                        whileTap={reduceMotion ? undefined : { scale: 0.98 }}
                        onClick={() => toggleTodo(item.id)}
                        className="site-card flex w-full items-start gap-2.5 rounded-[12px] px-3 py-2.5 text-left"
                      >
                        <span
                          className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-all"
                          style={{
                            borderColor: checked ? 'var(--status-green)' : PRIO_COLOR[item.prio],
                            background: checked ? 'var(--status-green)' : 'transparent',
                          }}
                        >
                          {checked && <Check size={11} weight="bold" color="#ffffff" />}
                        </span>
                        <span
                          className={`text-[13px] leading-[1.45] transition-opacity ${
                            checked ? 'line-through opacity-55' : ''
                          }`}
                          style={{ color: 'var(--text-1)' }}
                        >
                          {item.text}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* Right Column inside Stage: Floating Quick Capture + Pinned Sticky + Git Sync */}
              <div className="flex flex-col gap-3.5 sm:col-span-5">
                <motion.div
                  style={reduceMotion ? undefined : { x: floatOffsetX, y: floatOffsetY }}
                  className="site-float rounded-[16px] p-3.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                      <Lightning size={15} weight="duotone" style={{ color: 'var(--accent)' }} />
                      <span>{copy.hero.stageQuickLabel}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <kbd className="site-kbd">⌥</kbd>
                      <kbd className="site-kbd">Space</kbd>
                    </div>
                  </div>
                  <p className="mt-2 text-[12px]" style={{ color: 'var(--text-2)' }}>
                    {copy.hero.stageQuickHint}
                  </p>
                </motion.div>

                <motion.div
                  style={
                    reduceMotion
                      ? {
                          background: 'var(--sticky-yellow-bg)',
                          borderColor: 'var(--sticky-yellow-border)',
                        }
                      : {
                          x: floatOffsetX,
                          background: 'var(--sticky-yellow-bg)',
                          borderColor: 'var(--sticky-yellow-border)',
                        }
                  }
                  className="rounded-[16px] border p-3.5 shadow-lg"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="text-[12px] font-semibold"
                      style={{ color: 'var(--sticky-yellow-accent)' }}
                    >
                      {copy.hero.stageStickyTitle}
                    </span>
                    <PushPin
                      size={14}
                      weight="fill"
                      style={{ color: 'var(--sticky-yellow-accent)' }}
                    />
                  </div>
                  <p
                    className="mt-1.5 text-[12.5px] leading-[1.5]"
                    style={{ color: 'var(--text-1)' }}
                  >
                    {copy.hero.stageStickyBody}
                  </p>
                </motion.div>

                <div className="site-float flex items-center justify-between rounded-[14px] px-3.5 py-2.5">
                  <div className="flex items-center gap-2 text-[12px] font-medium">
                    <GitBranch size={15} weight="duotone" style={{ color: 'var(--status-green)' }} />
                    <span>{copy.hero.stageSyncLabel}</span>
                  </div>
                  <span
                    className="text-[11.5px] font-medium"
                    style={{ color: 'var(--status-green)' }}
                  >
                    {copy.hero.stageSyncValue}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
