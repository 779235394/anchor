import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowsLeftRight,
  CheckCircle,
  Cpu,
  FileCode,
  FolderOpen,
  GitBranch,
  GitMerge,
  ShieldCheck,
  Sparkle,
} from '@phosphor-icons/react';
import type { Lang, SiteCopy } from '@/i18n/copy';

gsap.registerPlugin(ScrollTrigger);

const WORKSPACE_FILES = [
  {
    path: 'tasks.json',
    preview: `{
  "id": "tsk_9f2a",
  "status": "doing",
  "prio": 1,
  "due": "2026-11-27",
  "note": "Ship signed installers"
}`,
  },
  {
    path: 'docs/architecture.md',
    preview: `# Local-First Storage
- [x] Atomic tmp -> sync_all -> rename
- [x] Portable ../attachments/ paths
- [ ] Review v1.0.1 release notes`,
  },
  {
    path: 'stickies.json',
    preview: `{
  "color": "blue",
  "pinned": true,
  "autoOpen": false,
  "content": "Check PDF print margins"
}`,
  },
];

export function StickyPrinciples({ copy, lang }: { copy: SiteCopy; lang: Lang }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  const [selectedFile, setSelectedFile] = useState(0);
  const [gitMerged, setGitMerged] = useState(false);
  const [comparePos, setComparePos] = useState(50);
  const compareBoxRef = useRef<HTMLDivElement>(null);
  const draggingCompareRef = useRef(false);

  const updateCompareFromClientX = (clientX: number) => {
    if (!compareBoxRef.current) return;
    const rect = compareBoxRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setComparePos(Math.round(Math.max(8, Math.min(92, pct))));
  };

  useEffect(() => {
    if (reduceMotion || !containerRef.current) return;

    const mm = gsap.matchMedia();
    mm.add('(min-width: 1024px)', () => {
      const ctx = gsap.context(() => {
        const cards = gsap.utils.toArray<HTMLElement>('.principle-stack-card');
        cards.forEach((card, i) => {
          if (i === cards.length - 1) return;
          const surface = card.querySelector<HTMLElement>('.principle-surface');
          ScrollTrigger.create({
            trigger: card,
            start: 'top top',
            endTrigger: cards[cards.length - 1],
            end: 'top top',
            pin: true,
            pinSpacing: false,
            anticipatePin: 1,
          });

          gsap.to(surface || card, {
            scale: 0.92,
            y: -24,
            opacity: 0,
            ease: 'power1.inOut',
            scrollTrigger: {
              trigger: cards[i + 1],
              start: 'top 92%',
              end: 'top 18%',
              scrub: true,
            },
          });
        });
      }, containerRef);

      return () => ctx.revert();
    });

    return () => mm.revert();
  }, [reduceMotion]);

  const obsidianSrc = `${import.meta.env.BASE_URL}images/obsidian-glass-art.jpg`;
  const porcelainSrc = `${import.meta.env.BASE_URL}images/porcelain-glass-art.jpg`;

  return (
    <section id="principles" className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-[660px]"
        >
          <h2
            className="text-[30px] font-bold tracking-[-0.03em] leading-[1.15] sm:text-[42px]"
            style={{ color: 'var(--text-1)' }}
          >
            {copy.principles.heading}
          </h2>
          <p className="mt-3.5 text-[15.5px] leading-[1.65]" style={{ color: 'var(--text-2)' }}>
            {copy.principles.subtext}
          </p>
        </motion.div>

        <div ref={containerRef} className="relative mt-10 space-y-6 lg:space-y-0">
          {copy.principles.cards.map((card, index) => (
            <div
              key={card.id}
              className="principle-stack-card relative flex items-center lg:min-h-[100dvh] lg:py-20"
              style={{ zIndex: (index + 1) * 10 }}
            >
              <div
                className="principle-surface grid w-full grid-cols-1 items-center gap-8 rounded-[24px] border p-6 sm:p-9 lg:grid-cols-12 lg:gap-10"
                style={{
                  background:
                    'radial-gradient(60% 80% at 10% 0%, var(--accent-soft), transparent 62%), var(--bg-card-solid)',
                  borderColor: 'var(--bg-shell-border)',
                  boxShadow: 'var(--shadow-shell)',
                }}
              >
                {/* Text Column */}
                <div className="lg:col-span-5">
                  <div
                    className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-[12px]"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    {card.id === 'local' && <FolderOpen size={22} weight="duotone" />}
                    {card.id === 'git' && <GitBranch size={22} weight="duotone" />}
                    {card.id === 'native' && <Cpu size={22} weight="duotone" />}
                    {card.id === 'glass' && <Sparkle size={22} weight="duotone" />}
                  </div>

                  <h3
                    className="text-[24px] font-bold tracking-[-0.025em] leading-[1.2] sm:text-[30px]"
                    style={{ color: 'var(--text-1)' }}
                  >
                    {card.title}
                  </h3>
                  <p
                    className="mt-3.5 text-[15px] leading-[1.7]"
                    style={{ color: 'var(--text-2)' }}
                  >
                    {card.body}
                  </p>

                  <div className="mt-6 space-y-2.5">
                    {card.points.map((pt) => (
                      <div key={pt} className="flex items-center gap-2.5 text-[13.5px] font-medium">
                        <CheckCircle
                          size={17}
                          weight="duotone"
                          style={{ color: 'var(--accent)', flexShrink: 0 }}
                        />
                        <span style={{ color: 'var(--text-1)' }}>{pt}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Interactive Visual Column */}
                <div className="lg:col-span-7">
                  {card.id === 'local' && (
                    <div className="site-card overflow-hidden rounded-[18px]">
                      <div
                        className="flex flex-wrap items-center gap-1.5 border-b px-3.5 py-2.5"
                        style={{ borderColor: 'var(--hairline-soft)', background: 'var(--bg-subtle)' }}
                      >
                        {WORKSPACE_FILES.map((file, idx) => (
                          <button
                            key={file.path}
                            type="button"
                            onClick={() => setSelectedFile(idx)}
                            className="inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 font-mono text-[12px] transition-colors"
                            style={{
                              background: selectedFile === idx ? 'var(--accent-soft)' : 'transparent',
                              color: selectedFile === idx ? 'var(--accent)' : 'var(--text-2)',
                            }}
                          >
                            <FileCode size={14} weight="duotone" />
                            <span>{file.path}</span>
                          </button>
                        ))}
                      </div>
                      <pre
                        className="overflow-x-auto p-5 font-mono text-[13px] leading-[1.7]"
                        style={{ color: 'var(--text-1)' }}
                      >
                        <code>{WORKSPACE_FILES[selectedFile].preview}</code>
                      </pre>
                    </div>
                  )}

                  {card.id === 'git' && (
                    <div className="site-card rounded-[18px] p-5">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div
                          className="rounded-[12px] border p-3.5"
                          style={{ background: 'var(--bg-subtle)', borderColor: 'var(--hairline-soft)' }}
                        >
                          <p className="font-mono text-[11.5px]" style={{ color: 'var(--accent)' }}>
                            macOS · 14:20
                          </p>
                          <p className="mt-1.5 text-[13px] font-medium" style={{ color: 'var(--text-1)' }}>
                            {lang === 'zh' ? '修改任务 A 排期至周四' : 'Moved Task A due to Thu'}
                          </p>
                        </div>
                        <div
                          className="rounded-[12px] border p-3.5"
                          style={{ background: 'var(--bg-subtle)', borderColor: 'var(--hairline-soft)' }}
                        >
                          <p className="font-mono text-[11.5px]" style={{ color: 'var(--status-orange)' }}>
                            Windows · 14:22
                          </p>
                          <p className="mt-1.5 text-[13px] font-medium" style={{ color: 'var(--text-1)' }}>
                            {lang === 'zh' ? '勾选任务 B 并新增灵感 #32' : 'Checked Task B & added Note #32'}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => setGitMerged((m) => !m)}
                          className="site-btn-primary h-10 px-4 text-[13px]"
                        >
                          <GitMerge size={16} weight="bold" />
                          <span>{copy.principles.gitConflictBtn}</span>
                        </button>

                        {gitMerged && (
                          <motion.span
                            initial={reduceMotion ? false : { opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium"
                            style={{
                              background: 'var(--status-green-soft)',
                              color: 'var(--status-green)',
                            }}
                          >
                            <CheckCircle size={14} weight="fill" />
                            <span>{copy.principles.gitResolvedLabel}</span>
                          </motion.span>
                        )}
                      </div>

                      <motion.div
                        animate={{
                          borderColor: gitMerged
                            ? 'var(--status-green)'
                            : 'var(--hairline-soft)',
                        }}
                        className="mt-4 rounded-[12px] border p-3.5 font-mono text-[12px] leading-[1.65]"
                        style={{ background: 'var(--bg-canvas-elevated)', color: 'var(--text-2)' }}
                      >
                        <div>
                          {gitMerged
                            ? '✓ merge(local_bundle, remote_bundle) -> 0 conflicts, 30d tombstones intact'
                            : 'git pull --rebase -> waiting for semantic LWW reconciliation'}
                        </div>
                      </motion.div>
                    </div>
                  )}

                  {card.id === 'native' && (
                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                      <div className="site-card rounded-[18px] p-5">
                        <ShieldCheck size={24} weight="duotone" style={{ color: 'var(--status-green)' }} />
                        <p className="mt-3 text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>
                          {lang === 'zh' ? 'Ed25519 签名直更' : 'Ed25519 Signed Updater'}
                        </p>
                        <p className="mt-1.5 text-[13px] leading-[1.6]" style={{ color: 'var(--text-2)' }}>
                          {lang === 'zh'
                            ? '校验公钥通过后实时进度条下载，刷盘保护后一键原地重启。'
                            : 'Verifies cryptographic signature, flushes pending writes, and relaunches cleanly.'}
                        </p>
                      </div>
                      <div className="site-card rounded-[18px] p-5">
                        <Cpu size={24} weight="duotone" style={{ color: 'var(--accent)' }} />
                        <p className="mt-3 text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>
                          {lang === 'zh' ? '原生跨全屏 NSPanel' : 'Native Fullscreen NSPanel'}
                        </p>
                        <p className="mt-1.5 text-[13px] leading-[1.6]" style={{ color: 'var(--text-2)' }}>
                          {lang === 'zh'
                            ? '快捷小窗与多开桌面便签稳定悬浮于全屏应用上方，不跳桌面不闪 Dock。'
                            : 'Quick capture and desktop stickies float cleanly over macOS fullscreen spaces.'}
                        </p>
                      </div>
                    </div>
                  )}

                  {card.id === 'glass' && (
                    <div className="space-y-3">
                      <div
                        ref={compareBoxRef}
                        onPointerDown={(e) => {
                          draggingCompareRef.current = true;
                          e.currentTarget.setPointerCapture(e.pointerId);
                          updateCompareFromClientX(e.clientX);
                        }}
                        onPointerMove={(e) => {
                          if (!draggingCompareRef.current) return;
                          updateCompareFromClientX(e.clientX);
                        }}
                        onPointerUp={(e) => {
                          draggingCompareRef.current = false;
                          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                            e.currentTarget.releasePointerCapture(e.pointerId);
                          }
                        }}
                        className="relative aspect-[16/10] w-full cursor-ew-resize touch-none overflow-hidden rounded-[18px] border select-none"
                        style={{ borderColor: 'var(--hairline)' }}
                      >
                        <img
                          src={porcelainSrc}
                          alt="Anchor Porcelain Glass light studio surface"
                          draggable={false}
                          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                        />
                        <div
                          className="pointer-events-none absolute inset-0 overflow-hidden"
                          style={{ clipPath: `inset(0 ${100 - comparePos}% 0 0)` }}
                        >
                          <img
                            src={obsidianSrc}
                            alt="Anchor Obsidian Glass dark studio surface"
                            draggable={false}
                            className="h-full w-full object-cover"
                          />
                        </div>

                        {/* Divider line & handle */}
                        <div
                          className="pointer-events-none absolute inset-y-0 w-[2px] bg-white/90 shadow-lg"
                          style={{ left: `${comparePos}%` }}
                        >
                          <div className="absolute top-1/2 left-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/60 bg-[#11151e]/85 text-white shadow-xl">
                            <ArrowsLeftRight size={16} weight="bold" />
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 px-1">
                        <span className="shrink-0 text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
                          {copy.principles.compareObsidian}
                        </span>
                        <input
                          type="range"
                          min={8}
                          max={92}
                          value={comparePos}
                          onChange={(e) => setComparePos(Number(e.target.value))}
                          aria-label={copy.principles.compareDragHint}
                          className="h-1.5 flex-1 cursor-ew-resize accent-[var(--accent)]"
                        />
                        <span className="shrink-0 text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
                          {copy.principles.comparePorcelain}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
