import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Image,
  Lightning,
  LinkSimple,
  PaperPlaneRight,
  PushPin,
  Tag,
} from '@phosphor-icons/react';
import type { Lang } from '@/i18n/copy';

type StickyColor = 'yellow' | 'blue' | 'green' | 'pink' | 'purple' | 'graphite';

const STICKY_COLORS: Array<{ id: StickyColor; dot: string }> = [
  { id: 'yellow', dot: '#F5B800' },
  { id: 'blue', dot: '#2E90FA' },
  { id: 'green', dot: '#2AC769' },
  { id: 'pink', dot: '#F25C9B' },
  { id: 'purple', dot: '#8B6CF6' },
  { id: 'graphite', dot: '#8E8E93' },
];

export function QuickCaptureStickyDemo({
  lang,
  autoPlay,
  onInteract,
}: {
  lang: Lang;
  autoPlay: boolean;
  onInteract: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [panelOpen, setPanelOpen] = useState(true);
  const [captureMode, setCaptureMode] = useState<'note' | 'task'>('note');
  const [savedCount, setSavedCount] = useState(3);
  const [justSaved, setJustSaved] = useState(false);

  const [stickyColor, setStickyColor] = useState<StickyColor>('yellow');
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (!autoPlay || reduceMotion) return;
    let tick = 0;
    const timer = window.setInterval(() => {
      tick = (tick + 1) % 4;
      if (tick === 1) {
        setPanelOpen(true);
        setCaptureMode('task');
        setStickyColor('blue');
      } else if (tick === 2) {
        setJustSaved(true);
        setSavedCount((c) => (c > 8 ? 3 : c + 1));
        setStickyColor('green');
        window.setTimeout(() => setJustSaved(false), 900);
      } else if (tick === 3) {
        setCaptureMode('note');
        setStickyColor('pink');
      } else {
        setStickyColor('yellow');
      }
    }, 2300);
    return () => window.clearInterval(timer);
  }, [autoPlay, reduceMotion]);

  const handleSave = () => {
    onInteract();
    setSavedCount((c) => c + 1);
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 1100);
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Left: Fullscreen Backdrop + NSPanel Quick Capture Island */}
      <div
        className="relative flex min-h-[260px] flex-col justify-between overflow-hidden rounded-[16px] border p-4 lg:col-span-7"
        style={{
          background:
            'radial-gradient(circle at 20% 10%, var(--accent-soft), transparent 55%), var(--bg-canvas-elevated)',
          borderColor: 'var(--hairline)',
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              onInteract();
              setPanelOpen((o) => !o);
            }}
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--bg-subtle-hover)]"
            style={{
              background: 'var(--bg-card)',
              borderColor: 'var(--hairline)',
              color: 'var(--text-1)',
            }}
          >
            <Lightning size={14} weight="duotone" style={{ color: 'var(--accent)' }} />
            <span>{lang === 'zh' ? '模拟呼出快捷键' : 'Press Hotkey'}</span>
            <kbd className="site-kbd">⌥</kbd>
            <kbd className="site-kbd">Space</kbd>
          </button>

          <span
            className="tabular-nums rounded-full px-2.5 py-1 text-[11.5px] font-medium"
            style={{
              background: justSaved ? 'var(--status-green-soft)' : 'var(--bg-subtle)',
              color: justSaved ? 'var(--status-green)' : 'var(--text-2)',
            }}
          >
            {lang === 'zh' ? `已实时落盘 ${savedCount} 条` : `${savedCount} saved instantly`}
          </span>
        </div>

        {/* Floating L4 Quick Capture Island */}
        <div className="my-4 flex flex-1 items-center justify-center">
          <AnimatePresence mode="wait">
            {panelOpen ? (
              <motion.div
                key="island"
                initial={reduceMotion ? false : { opacity: 0, scale: 0.92, y: -14 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, scale: 0.94, y: -10 }}
                transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                className="site-float w-full max-w-[440px] rounded-[16px] p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="site-segmented relative flex items-center gap-1 text-[12px] font-medium">
                    {(['note', 'task'] as const).map((m) => {
                      const active = captureMode === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            onInteract();
                            setCaptureMode(m);
                          }}
                          className="relative rounded-[8px] px-3 py-1"
                          style={{ color: active ? 'var(--text-1)' : 'var(--text-2)' }}
                        >
                          {active && (
                            <motion.span
                              layoutId="qc-mode-pill"
                              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                              className="absolute inset-0 rounded-[8px]"
                              style={{
                                background: 'var(--seg-active-bg)',
                                boxShadow: 'var(--seg-active-shadow)',
                              }}
                            />
                          )}
                          <span className="relative z-10">
                            {m === 'note'
                              ? lang === 'zh'
                                ? '灵感速记'
                                : 'Quick Note'
                              : lang === 'zh'
                                ? '快捷待办'
                                : 'Quick Task'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10.5px] font-medium"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    {lang === 'zh' ? '跨全屏置顶' : 'Over Fullscreen'}
                  </span>
                </div>

                <p
                  className="mt-3 min-h-[44px] text-[13.5px] leading-[1.55]"
                  style={{ color: 'var(--text-1)' }}
                >
                  {captureMode === 'note'
                    ? lang === 'zh'
                      ? '#产品灵感 官网可以把六大模块做成真实可点的微缩工作台，比静态截图更有说服力。'
                      : '#idea Turn all six core modules into live mini interactive playgrounds instead of static shots.'
                    : lang === 'zh'
                      ? '补充 Windows NSIS 与 MSI 双安装包下载入口并校验最新签名'
                      : 'Verify signed Windows NSIS & MSI assets in latest GitHub Release'}
                </p>

                <div
                  className="mt-3 flex items-center justify-between border-t pt-2.5"
                  style={{ borderColor: 'var(--hairline-soft)' }}
                >
                  <div className="flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                    <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[var(--bg-subtle)]">
                      <Tag size={14} />
                    </span>
                    <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[var(--bg-subtle)]">
                      <LinkSimple size={14} />
                    </span>
                    <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[var(--bg-subtle)]">
                      <Image size={14} />
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleSave}
                    className="site-btn-primary h-8 px-3.5 text-[12px]"
                  >
                    <PaperPlaneRight size={13} weight="bold" />
                    <span>{lang === 'zh' ? '瞬间存盘' : 'Capture'}</span>
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.p
                key="hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-[13px]"
                style={{ color: 'var(--text-3)' }}
              >
                {lang === 'zh'
                  ? '已隐入后台。点击左上角快捷键再次呼出悬浮岛。'
                  : 'Dismissed cleanly. Click the hotkey pill above to summon again.'}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Right: Multi-color Frosted Sticky Note */}
      <div className="flex flex-col justify-between gap-3 lg:col-span-5">
        <motion.div
          layout={!reduceMotion}
          className="flex flex-1 flex-col justify-between rounded-[16px] border p-4 transition-colors duration-300"
          style={{
            background: `var(--sticky-${stickyColor}-bg)`,
            borderColor: `var(--sticky-${stickyColor}-border)`,
            boxShadow: 'var(--shadow-float)',
          }}
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {STICKY_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-label={`Sticky color ${c.id}`}
                    onClick={() => {
                      onInteract();
                      setStickyColor(c.id);
                    }}
                    className="h-4 w-4 rounded-full transition-transform hover:scale-115"
                    style={{
                      background: c.dot,
                      boxShadow:
                        stickyColor === c.id
                          ? '0 0 0 2px var(--bg-card-solid), 0 0 0 3.5px currentColor'
                          : 'none',
                      color: c.dot,
                    }}
                  />
                ))}
              </div>

              <motion.button
                type="button"
                whileTap={reduceMotion ? undefined : { scale: 0.9 }}
                onClick={() => {
                  onInteract();
                  setPinned((p) => !p);
                }}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{
                  background: pinned ? 'var(--bg-subtle-hover)' : 'var(--bg-subtle)',
                  color: `var(--sticky-${stickyColor}-accent)`,
                }}
              >
                <motion.span
                  animate={{ rotate: pinned ? 0 : -35 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 24 }}
                >
                  <PushPin size={13} weight={pinned ? 'fill' : 'regular'} />
                </motion.span>
                <span>
                  {pinned
                    ? lang === 'zh'
                      ? '置顶中'
                      : 'Pinned'
                    : lang === 'zh'
                      ? '未置顶'
                      : 'Unpinned'}
                </span>
              </motion.button>
            </div>

            <div
              className="mt-4 space-y-2 text-[13.5px] leading-[1.6]"
              style={{ color: 'var(--text-1)' }}
            >
              <p className="font-medium">
                {lang === 'zh'
                  ? '独立无边框多开桌面便签'
                  : 'Borderless multi-window desktop stickies'}
              </p>
              <p style={{ color: 'var(--text-2)' }}>
                {lang === 'zh'
                  ? '支持 6 色磨砂纸张、4 档窗口透明度调节，关闭小窗仅收起不丢内容，并可逐张设置启动自启。'
                  : 'Six frosted paper tones, 4 opacity levels, zero data loss on close, and per-sticky auto-open on launch.'}
              </p>
            </div>
          </div>

          <div
            className="mt-4 flex items-center justify-between border-t pt-2.5 text-[11.5px]"
            style={{
              borderColor: `var(--sticky-${stickyColor}-border)`,
              color: `var(--sticky-${stickyColor}-accent)`,
            }}
          >
            <span className="font-mono">stickies.json</span>
            <span>{lang === 'zh' ? '快捷键 ⌥⇧N 新建' : '⌥⇧N New Sticky'}</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
