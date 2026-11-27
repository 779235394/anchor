import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowsOut,
  BookOpen,
  CalendarBlank,
  ChartBar,
  CheckSquare,
  CursorClick,
  Kanban,
  Lightning,
  LockOpen,
  X,
} from '@phosphor-icons/react';
import type { AccentKey, Lang, ThemeMode } from '@/i18n/copy';

interface StickyDesktopCinemaProps {
  lang: Lang;
  theme: ThemeMode;
  accent: AccentKey;
  onFullscreenChange?: (open: boolean) => void;
}

type DemoViewKey = 'tasks' | 'kanban' | 'schedule' | 'knowledge' | 'stickies' | 'review';
type DemoOverlay = 'none' | 'quick-capture' | 'spotlight' | 'mobile';

interface CinemaAct {
  id: string;
  view: DemoViewKey;
  overlay: DemoOverlay;
  icon: typeof Kanban;
  zhTitle: string;
  enTitle: string;
  zhDesc: string;
  enDesc: string;
  zhHint: string;
  enHint: string;
  mobileImage: string;
}

const ACTS: CinemaAct[] = [
  {
    id: 'act-tasks',
    view: 'tasks',
    overlay: 'none',
    icon: CheckSquare,
    zhTitle: '单框直写待办，详情与附件一屏同框',
    enTitle: 'Single-box tasks with unified detail & attachments',
    zhDesc:
      '告别割裂的标题与备注双框。想到即写，首行自动派生紧凑摘要；右侧常驻瓷质/曜石详情卡将富文本正文、图片与链接融为一体。',
    enDesc:
      'No separate title and note friction. Write directly while the first line derives the list summary alongside an integrated right-hand detail card.',
    zhHint: '左栏按项目分组，支持跨天自动结转',
    enHint: 'Grouped by project with automatic rollover',
    mobileImage: 'images/app-tasks-dark.jpg',
  },
  {
    id: 'act-kanban',
    view: 'kanban',
    overlay: 'none',
    icon: Kanban,
    zhTitle: '四列任务流转看板，拖拽零延迟推进',
    enTitle: 'Four-column Kanban with zero-latency flow',
    zhDesc:
      '围绕「待办、进行中、待确认、已完成」四态清晰推进。支持跨列与同列自由拖拽，点击任务滑出不挤压列宽的 L3 悬浮毛玻璃抽屉。',
    enDesc:
      'Glide tasks across To Do, In Progress, Review, and Done with drag sorting and a floating L3 frosted inspector drawer.',
    zhHint: '多维筛选与子清单进度实时同步',
    enHint: 'Multi-axis filters & live checklist counts',
    mobileImage: 'images/app-kanban-dark.jpg',
  },
  {
    id: 'act-schedule',
    view: 'schedule',
    overlay: 'none',
    icon: CalendarBlank,
    zhTitle: '零依赖精准农历与跨天彩色玻璃排期',
    enTitle: 'Zero-dependency lunar calendar & multi-day spans',
    zhDesc:
      '完整支持单日、跨天连续排期与小时时间轴。左侧「未排期池」拖入日历格即排期，今日微发光蓝圈与原生农历一目了然。',
    enDesc:
      'Schedule single days, multi-day glass spans, or hourly blocks. Drag tasks straight from the unscheduled pool onto the grid.',
    zhHint: '月视图、周时间轴与日视图即时切换',
    enHint: 'Month grid, week timeline & daily journal',
    mobileImage: 'images/app-tasks-dark.jpg',
  },
  {
    id: 'act-knowledge',
    view: 'knowledge',
    overlay: 'none',
    icon: BookOpen,
    zhTitle: '真实多级目录 Markdown 知识库',
    enTitle: 'Native multi-folder Markdown knowledge base',
    zhDesc:
      '所有文档以真实操作系统目录与标准 .md 文件落盘。支持阅读态直接勾选清单回写、多条灵感一键合并沉淀与导出 A4 矢量 PDF。',
    enDesc:
      'Real folders and standard .md files on disk. Check off tasks in read view, merge loose notes into docs, and export crisp A4 vector PDFs.',
    zhHint: '兼容 VS Code / Typora 热重载零锁定',
    enHint: 'Open anytime in VS Code or Typora',
    mobileImage: 'images/app-knowledge-dark.jpg',
  },
  {
    id: 'act-capture',
    view: 'stickies',
    overlay: 'quick-capture',
    icon: Lightning,
    zhTitle: '跨全屏悬浮速记岛与六色置顶便签',
    enTitle: 'Fullscreen Quick Capture & six-tone stickies',
    zhDesc:
      '无论身处哪个全屏应用，按下 ⌥ Space 瞬间浮现 L4 速记浮岛；按下 ⌥⇧N 随时多开透明圆角桌面便签并逐张独立置顶。',
    enDesc:
      'Summon an L4 capture island over fullscreen apps with ⌥ Space, or spawn borderless multi-color desktop stickies with ⌥⇧N.',
    zhHint: 'macOS 原生 NSPanel 跨空间稳定置顶',
    enHint: 'Native macOS NSPanel stays above fullscreen',
    mobileImage: 'images/app-tasks-dark.jpg',
  },
  {
    id: 'act-review',
    view: 'review',
    overlay: 'none',
    icon: ChartBar,
    zhTitle: '多维复盘仪表与手机扫码跨网协作',
    enTitle: 'Multi-range reviews & QR mobile companion',
    zhDesc:
      '按日、周、月、年与自定义范围聚合完成明细与项目精力分布，一键复制纯净 Markdown；离开电脑时手机 4G/5G 扫码即可实时续写。',
    enDesc:
      'Slice progress by day, week, month, or year with one-click Markdown reports, and scan a one-time QR code to sync live from your phone.',
    zhHint: '内置加密通道，数据 100% 留在本机',
    enHint: 'Encrypted tunnel, 100% local host data',
    mobileImage: 'images/app-tasks-light.jpg',
  },
];

export function StickyDesktopCinema({
  lang,
  theme,
  accent,
  onFullscreenChange,
}: StickyDesktopCinemaProps) {
  const reduceMotion = useReducedMotion();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fullIframeRef = useRef<HTMLIFrameElement>(null);
  const viewportBoxRef = useRef<HTMLDivElement>(null);
  const actRefs = useRef<Array<HTMLDivElement | null>>([]);

  const [activeIdx, setActiveIdx] = useState(0);
  const [iframeReady, setIframeReady] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [frameScale, setFrameScale] = useState(0.66);
  const [mobileOverlayDemo, setMobileOverlayDemo] = useState<'none' | 'quick-capture' | 'mobile'>('none');

  // Keep the real 1280x800 Anchor desktop app proportionally scaled inside the sticky stage
  useEffect(() => {
    const el = viewportBoxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setFrameScale(w / 1280);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const initialIframeSrcRef = useRef(
    `${import.meta.env.BASE_URL}app/?demo=1&theme=${theme}&accent=${accent}&lang=${lang}&view=tasks`,
  );

  const postToFrame = useCallback((frame: HTMLIFrameElement | null, payload: Record<string, unknown>) => {
    try {
      frame?.contentWindow?.postMessage(payload, window.location.origin);
    } catch {
      // ignore cross-frame race during mount
    }
  }, []);

  // Listen for real Anchor app ready handshake
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin || !ev.data || typeof ev.data !== 'object') return;
      if ((ev.data as { type?: string }).type === 'ANCHOR_DEMO_READY') {
        setIframeReady(true);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Sync theme, accent, and language changes live into the real Anchor desktop iframe
  useEffect(() => {
    if (!iframeReady) return;
    postToFrame(iframeRef.current, { type: 'ANCHOR_DEMO_SET_THEME', theme, accent });
    postToFrame(fullIframeRef.current, { type: 'ANCHOR_DEMO_SET_THEME', theme, accent });
  }, [iframeReady, theme, accent, postToFrame]);

  useEffect(() => {
    if (!iframeReady) return;
    postToFrame(iframeRef.current, { type: 'ANCHOR_DEMO_SET_LANG', lang });
    postToFrame(fullIframeRef.current, { type: 'ANCHOR_DEMO_SET_LANG', lang });
  }, [iframeReady, lang, postToFrame]);

  // Direct the real desktop app whenever active chapter changes (unless user took over in free play)
  useEffect(() => {
    if (!iframeReady || interactive) return;
    const act = ACTS[activeIdx];
    if (!act) return;
    postToFrame(iframeRef.current, { type: 'ANCHOR_DEMO_SET_VIEW', view: act.view });
    if (act.overlay !== 'none') {
      const t = window.setTimeout(() => {
        postToFrame(iframeRef.current, { type: 'ANCHOR_DEMO_OPEN_OVERLAY', overlay: act.overlay });
      }, 280);
      return () => window.clearTimeout(t);
    }
    postToFrame(iframeRef.current, { type: 'ANCHOR_DEMO_OPEN_OVERLAY', overlay: 'none' });
  }, [activeIdx, iframeReady, interactive, postToFrame]);

  // Scroll-driven act director via IntersectionObserver (zero scroll-listener jank)
  useEffect(() => {
    if (interactive) return;
    const nodes = actRefs.current.filter((n): n is HTMLDivElement => !!n);
    if (nodes.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number(entry.target.getAttribute('data-act-idx'));
            if (!Number.isNaN(idx)) {
              setActiveIdx(idx);
            }
          }
        }
      },
      { rootMargin: '-38% 0px -38% 0px', threshold: 0.05 },
    );

    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [interactive]);

  // Fullscreen modal Escape & Lenis pause sync
  useEffect(() => {
    onFullscreenChange?.(fullscreen);
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, onFullscreenChange]);

  const currentAct = ACTS[activeIdx] || ACTS[0];
  const posterSrc =
    theme === 'light' && activeIdx === 0
      ? `${import.meta.env.BASE_URL}images/app-tasks-light.jpg`
      : `${import.meta.env.BASE_URL}${currentAct.mobileImage}`;

  const triggerOverlayPreview = (overlay: 'quick-capture' | 'mobile' | 'spotlight' | 'none') => {
    setMobileOverlayDemo(overlay === 'quick-capture' || overlay === 'mobile' ? overlay : 'none');
    postToFrame(iframeRef.current, { type: 'ANCHOR_DEMO_OPEN_OVERLAY', overlay });
  };

  return (
    <section id="showcase" className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-[700px]"
        >
          <h2
            className="text-[30px] font-bold tracking-[-0.035em] leading-[1.15] sm:text-[44px]"
            style={{ color: 'var(--text-1)' }}
          >
            {lang === 'zh'
              ? '所见即真机，滚屏沉浸演完六大核心工作流'
              : 'The real desktop app, choreographed live as you scroll'}
          </h2>
          <p className="mt-3.5 text-[15.5px] leading-[1.68]" style={{ color: 'var(--text-2)' }}>
            {lang === 'zh'
              ? '右侧运行的是真正的 Anchor 桌面端内核。随页面向下滚动自动切换六幕真实工作区，随时点击即可解锁自由试玩。'
              : 'That is the real Anchor desktop frontend running live on the right. Scroll to tour six authentic workflows, or unlock to try it yourself.'}
          </p>
        </motion.div>

        {/* DESKTOP (>= 1024px): Sticky Split Cinema */}
        <div className="mt-12 hidden grid-cols-12 items-start gap-8 lg:grid">
          {/* Left 4 cols: Scroll-driven Narrative Chapters */}
          <div className="col-span-4 space-y-6 pb-20">
            {ACTS.map((act, idx) => {
              const Icon = act.icon;
              const active = idx === activeIdx;
              return (
                <div
                  key={act.id}
                  ref={(el) => {
                    actRefs.current[idx] = el;
                  }}
                  data-act-idx={idx}
                  onClick={() => {
                    setInteractive(false);
                    setActiveIdx(idx);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setInteractive(false);
                      setActiveIdx(idx);
                    }
                  }}
                  className="cursor-pointer rounded-[20px] border p-5 transition-all duration-300"
                  style={{
                    minHeight: '215px',
                    background: active ? 'var(--bg-card)' : 'transparent',
                    borderColor: active
                      ? 'color-mix(in srgb, var(--accent) 44%, var(--hairline))'
                      : 'var(--hairline-soft)',
                    boxShadow: active ? 'var(--shadow-card)' : 'none',
                    opacity: active ? 1 : 0.56,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-[10px]"
                      style={{
                        background: active ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                        color: active ? 'var(--accent)' : 'var(--text-3)',
                      }}
                    >
                      <Icon size={19} weight={active ? 'fill' : 'duotone'} />
                    </span>
                    <span
                      className="tabular-nums font-mono text-[11.5px] font-semibold"
                      style={{ color: active ? 'var(--accent)' : 'var(--text-3)' }}
                    >
                      0{idx + 1} / 0{ACTS.length}
                    </span>
                  </div>

                  <h3
                    className="mt-3.5 text-[18px] font-bold tracking-tight leading-[1.3]"
                    style={{ color: 'var(--text-1)' }}
                  >
                    {lang === 'zh' ? act.zhTitle : act.enTitle}
                  </h3>
                  <p
                    className="mt-2 text-[13.5px] leading-[1.65]"
                    style={{ color: 'var(--text-2)' }}
                  >
                    {lang === 'zh' ? act.zhDesc : act.enDesc}
                  </p>
                  <p
                    className="mt-3 text-[12px] font-medium"
                    style={{ color: active ? 'var(--accent)' : 'var(--text-3)' }}
                  >
                    {lang === 'zh' ? act.zhHint : act.enHint}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Right 8 cols: Sticky Real Anchor Desktop Stage */}
          <div className="sticky top-24 col-span-8">
            <div
              className="site-glass-shell relative overflow-hidden rounded-[22px] p-2"
              style={{
                borderColor: interactive
                  ? 'color-mix(in srgb, var(--accent) 60%, var(--bg-shell-border))'
                  : 'var(--bg-shell-border)',
              }}
            >
              {/* Window Chrome + Interactive Takeover Controls */}
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-t-[16px] border-b px-4 py-2.5"
                style={{
                  background: 'var(--bg-header-glass)',
                  borderColor: 'var(--hairline-soft)',
                }}
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                  </div>
                  <span className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
                    {interactive
                      ? lang === 'zh'
                        ? '真机自由试玩中（可拖拽看板、敲字、按 ⌘K）'
                        : 'Live Playground active (drag cards, type, press ⌘K)'
                      : lang === 'zh'
                        ? `第 ${activeIdx + 1} 幕 · ${currentAct.zhTitle}`
                        : `Act ${activeIdx + 1} · ${currentAct.enTitle}`}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {activeIdx === 5 && (
                    <button
                      type="button"
                      onClick={() =>
                        triggerOverlayPreview(mobileOverlayDemo === 'mobile' ? 'none' : 'mobile')
                      }
                      className="rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors"
                      style={{
                        background:
                          mobileOverlayDemo === 'mobile' ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                        borderColor: 'var(--hairline)',
                        color: mobileOverlayDemo === 'mobile' ? 'var(--accent)' : 'var(--text-2)',
                      }}
                    >
                      {lang === 'zh' ? '弹出扫码面板' : 'Toggle QR Modal'}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setInteractive((v) => !v)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold transition-all ${
                      interactive ? 'site-btn-primary' : 'site-btn-secondary'
                    }`}
                  >
                    {interactive ? <LockOpen size={14} weight="bold" /> : <CursorClick size={14} weight="duotone" />}
                    <span>
                      {interactive
                        ? lang === 'zh'
                          ? '退出试玩 · 恢复导览'
                          : 'Exit Playground'
                        : lang === 'zh'
                          ? '解锁真机自由试玩'
                          : 'Unlock Live Playground'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFullscreen(true)}
                    title={lang === 'zh' ? '全屏真机体验' : 'Fullscreen playground'}
                    aria-label={lang === 'zh' ? '全屏真机体验' : 'Fullscreen playground'}
                    className="flex h-8 w-8 items-center justify-center rounded-full border transition-colors hover:bg-[var(--bg-subtle-hover)]"
                    style={{
                      background: 'var(--bg-subtle)',
                      borderColor: 'var(--hairline)',
                      color: 'var(--text-1)',
                    }}
                  >
                    <ArrowsOut size={15} weight="bold" />
                  </button>
                </div>
              </div>

              {/* 16:10 Real Desktop Viewport Container (exact 1280x800 native proportions scaled cleanly) */}
              <div
                ref={viewportBoxRef}
                className="relative w-full overflow-hidden rounded-b-[16px]"
                style={{ aspectRatio: '16 / 10', background: 'var(--bg-canvas)' }}
              >
                {/* Instant 0ms Retina Poster while iframe boots */}
                <img
                  src={posterSrc}
                  alt="Anchor live desktop preview poster"
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-500"
                  style={{ opacity: iframeReady ? 0 : 1 }}
                />

                {/* Authentic Real Anchor Desktop Application Sandbox at Native 1280x800 */}
                <iframe
                  ref={iframeRef}
                  src={initialIframeSrcRef.current}
                  title="Anchor Real Desktop Interactive Sandbox"
                  loading="lazy"
                  className="absolute top-0 left-0 border-0 transition-opacity duration-500"
                  style={{
                    width: '1280px',
                    height: '800px',
                    transform: `scale(${frameScale})`,
                    transformOrigin: 'top left',
                    opacity: iframeReady ? 1 : 0,
                    pointerEvents: interactive ? 'auto' : 'none',
                  }}
                />

                {/* Non-blocking scroll-pass click overlay when in guided scroll cinema mode */}
                {!interactive && (
                  <button
                    type="button"
                    onClick={() => setInteractive(true)}
                    aria-label={lang === 'zh' ? '点击解锁真机自由试玩' : 'Click to unlock interactive desktop'}
                    className="group absolute inset-0 z-10 flex items-end justify-end bg-transparent p-4"
                  >
                    <span
                      className="site-float inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-semibold opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                      style={{ color: 'var(--text-1)' }}
                    >
                      <CursorClick size={15} weight="duotone" style={{ color: 'var(--accent)' }} />
                      <span>
                        {lang === 'zh' ? '点击解锁，直接操作真实桌面端' : 'Click to take control of the real app'}
                      </span>
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* MOBILE / TABLET (< 1024px): Crisp Real-Screenshot Touch Theater */}
        <div className="mt-8 space-y-4 lg:hidden">
          <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1">
            {ACTS.map((act, idx) => {
              const Icon = act.icon;
              const active = idx === activeIdx;
              return (
                <button
                  key={act.id}
                  type="button"
                  onClick={() => setActiveIdx(idx)}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[12.5px] font-medium whitespace-nowrap"
                  style={{
                    background: active ? 'var(--accent-soft)' : 'var(--bg-card)',
                    borderColor: active ? 'var(--accent)' : 'var(--hairline)',
                    color: active ? 'var(--accent)' : 'var(--text-2)',
                  }}
                >
                  <Icon size={15} weight={active ? 'fill' : 'duotone'} />
                  <span>0{idx + 1}</span>
                </button>
              );
            })}
          </div>

          <div className="site-glass-shell overflow-hidden rounded-[20px] p-3">
            <div className="aspect-[16/10] w-full overflow-hidden rounded-[13px] border" style={{ borderColor: 'var(--hairline)' }}>
              <img
                src={posterSrc}
                alt={lang === 'zh' ? currentAct.zhTitle : currentAct.enTitle}
                className="h-full w-full object-cover object-top"
              />
            </div>
            <div className="mt-4 px-1 pb-1">
              <h3 className="text-[18px] font-bold" style={{ color: 'var(--text-1)' }}>
                {lang === 'zh' ? currentAct.zhTitle : currentAct.enTitle}
              </h3>
              <p className="mt-1.5 text-[14px] leading-[1.65]" style={{ color: 'var(--text-2)' }}>
                {lang === 'zh' ? currentAct.zhDesc : currentAct.enDesc}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Fullscreen Live Real-Desktop Playground Modal */}
      <AnimatePresence>
        {fullscreen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
            style={{ background: 'rgba(4, 6, 12, 0.78)', backdropFilter: 'blur(14px)' }}
          >
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 340, damping: 30 }}
              className="site-glass-shell flex h-[88vh] w-full max-w-[1440px] flex-col overflow-hidden rounded-[22px] p-2"
            >
              <div
                className="flex items-center justify-between rounded-t-[15px] border-b px-4 py-2.5"
                style={{ background: 'var(--bg-header-glass)', borderColor: 'var(--hairline-soft)' }}
              >
                <div className="flex items-center gap-2.5 text-[13px] font-semibold">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#30d158]" />
                  <span>
                    {lang === 'zh'
                      ? 'Anchor 真实桌面端全屏沙盒（纯内存运行，刷新即重置）'
                      : 'Anchor Fullscreen Live Desktop Sandbox (In-memory, resets on reload)'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setFullscreen(false)}
                  className="site-btn-secondary h-8 px-3 text-[12px]"
                >
                  <X size={14} weight="bold" />
                  <span>{lang === 'zh' ? '关闭全屏' : 'Close'}</span>
                </button>
              </div>
              <iframe
                ref={fullIframeRef}
                src={`${import.meta.env.BASE_URL}app/?demo=1&theme=${theme}&accent=${accent}&lang=${lang}&view=${currentAct.view}`}
                title="Anchor Fullscreen Live Sandbox"
                className="flex-1 w-full rounded-b-[15px] border-0"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
