import { useRef, useState } from 'react';
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';
import {
  ArrowsLeftRight,
  CheckCircle,
  FileCode,
  FolderOpen,
  GitBranch,
  GitMerge,
  Sparkle,
  Stack,
} from '@phosphor-icons/react';
import type { Lang, SiteCopy } from '@/i18n/copy';
import { SpecularCard } from './SpecularCard';

const LAYERS = [
  {
    id: 'L4',
    zhName: 'L4 系统悬浮岛',
    enName: 'L4 System Islands',
    zhDesc: '⌥ Space 快捷小窗、多开 6 色便签与 Spotlight，强景深隔离跨全屏置顶',
    enDesc: '⌥ Space quick capture, 6-tone stickies & Spotlight floating above fullscreen spaces',
    color: '#0A84FF',
    zBase: 140,
  },
  {
    id: 'L3',
    zhName: 'L3 悬浮交互层',
    enName: 'L3 Floating Overlays',
    zhDesc: '任务详情悬浮抽屉与划词格式条，blur(28px) 柔焦不挤压看板与日历网格',
    enDesc: 'Overlay task inspector drawer & bubble toolbar with blur(28px), zero grid shift',
    color: '#38BDF8',
    zBase: 105,
  },
  {
    id: 'L2',
    zhName: 'L2 瓷质 / 曜石卡片层',
    enName: 'L2 Porcelain / Obsidian Cards',
    zhDesc: '1px 镜面顶部内高光 + 漫反射柔影，刻意去除卡片模糊保证双端 60fps 滚动',
    enDesc: '1px specular top rim + soft elevation shadow, engineered for 60fps long-list scrolling',
    color: '#30D158',
    zBase: 70,
  },
  {
    id: 'L1',
    zhName: 'L1 磨砂结构容器',
    enName: 'L1 Frosted Structure',
    zhDesc: '悬浮侧边栏、四列看板槽与知识库目录树，通透承接冷雾极光基底',
    enDesc: 'Floating sidebar, Kanban column tracks & docs tree inheriting ambient aurora light',
    color: '#FF9F0A',
    zBase: 35,
  },
  {
    id: 'L0',
    zhName: 'L0 极光氛围画布',
    enName: 'L0 Aurora Mist Canvas',
    zhDesc: '深邃玄曜 #080A10 与白瓷冷雾 #E6ECF5，随 4 档强调色柔和联动',
    enDesc: 'Obsidian #080A10 & Porcelain #E6ECF5 breathing gently with 4 system accents',
    color: '#64748B',
    zBase: 0,
  },
];

const WORKSPACE_FILES = [
  {
    path: 'tasks.json',
    preview: `{
  "id": "tsk_9f2a",
  "status": "doing",
  "prio": 1,
  "due": "2026-11-27",
  "note": "Verify Ed25519 signed installers"
}`,
  },
  {
    path: 'docs/glass-spec.md',
    preview: `# Porcelain & Obsidian Glass
- [x] Atomic write: tmp -> sync_all -> rename
- [x] Portable ../attachments/ relative links
- [ ] Export A4 vector PDF`,
  },
  {
    path: 'stickies.json',
    preview: `{
  "color": "yellow",
  "pinned": true,
  "autoOpen": false,
  "content": "15:30 review checklist"
}`,
  },
];

export function ExplodedGlassLayers({ copy, lang }: { copy: SiteCopy; lang: Lang }) {
  const explodeRef = useRef<HTMLDivElement>(null);
  const compareBoxRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const reduceMotion = useReducedMotion();

  const [focusedLayer, setFocusedLayer] = useState<string>('L2');
  const [vaultTab, setVaultTab] = useState<'glass' | 'local' | 'git'>('glass');
  const [comparePos, setComparePos] = useState(50);
  const [selectedFile, setSelectedFile] = useState(0);
  const [gitMerged, setGitMerged] = useState(false);

  // Scroll-scrubbed 3D explosion factor (0 = stacked together, 1 = exploded along Z axis)
  const { scrollYProgress } = useScroll({
    target: explodeRef,
    offset: ['start end', 'center center'],
  });
  const smoothExplode = useSpring(scrollYProgress, { stiffness: 120, damping: 22 });

  const layer4Y = useTransform(smoothExplode, [0, 1], [0, -104]);
  const layer3Y = useTransform(smoothExplode, [0, 1], [0, -52]);
  const layer2Y = useTransform(smoothExplode, [0, 1], [0, 0]);
  const layer1Y = useTransform(smoothExplode, [0, 1], [0, 52]);
  const layer0Y = useTransform(smoothExplode, [0, 1], [0, 104]);
  const layerTransforms = [layer4Y, layer3Y, layer2Y, layer1Y, layer0Y];

  const updateCompareFromX = (clientX: number) => {
    if (!compareBoxRef.current) return;
    const rect = compareBoxRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setComparePos(Math.round(Math.max(8, Math.min(92, pct))));
  };

  const obsidianSrc = `${import.meta.env.BASE_URL}images/obsidian-glass-art.jpg`;
  const porcelainSrc = `${import.meta.env.BASE_URL}images/porcelain-glass-art.jpg`;

  return (
    <section id="principles" className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 0.55 }}
          className="max-w-[700px]"
        >
          <h2
            className="text-[30px] font-bold tracking-[-0.035em] leading-[1.15] sm:text-[44px]"
            style={{ color: 'var(--text-1)' }}
          >
            {lang === 'zh'
              ? '五级玻璃景深拆解，与四条工程底线'
              : 'Five-layer glass anatomy & engineering foundations'}
          </h2>
          <p className="mt-3.5 text-[15.5px] leading-[1.68]" style={{ color: 'var(--text-2)' }}>
            {lang === 'zh'
              ? 'macOS 与 Windows 纯 WebView 100% 一致渲染。随滚动展开 L0 至 L4 每一层材质职责，零黑盒、零云端锁定。'
              : '100% visual parity across macOS and Windows. Watch L0 through L4 separate as you scroll, backed by plain-text ownership.'}
          </p>
        </motion.div>

        {/* PART 1: Scroll-Scrubbed 3D Isometric 5-Layer Glass Explosion */}
        <div
          ref={explodeRef}
          className="site-glass-shell mt-12 grid grid-cols-1 items-center gap-10 rounded-[26px] p-6 sm:p-10 lg:grid-cols-12"
        >
          {/* Left 7 cols: Isometric 3D Floating Glass Plates */}
          <div className="relative flex min-h-[340px] items-center justify-center sm:min-h-[420px] lg:col-span-7">
            <div
              className="relative h-[260px] w-[280px] sm:h-[310px] sm:w-[360px]"
              style={{ perspective: 1100 }}
            >
              {LAYERS.map((layer, idx) => {
                const isActive = focusedLayer === layer.id;
                const yTransform = layerTransforms[idx];
                return (
                  <motion.button
                    key={layer.id}
                    type="button"
                    onClick={() => setFocusedLayer(layer.id)}
                    onMouseEnter={() => setFocusedLayer(layer.id)}
                    style={
                      reduceMotion
                        ? {
                            top: `${idx * 44}px`,
                            zIndex: 50 - idx * 10,
                          }
                        : {
                            y: yTransform,
                            zIndex: 50 - idx * 10,
                          }
                    }
                    className="absolute inset-x-0 top-1/2 -mt-[78px] h-[156px] w-full text-left transition-all duration-300"
                  >
                    <div
                      className="flex h-full w-full flex-col justify-between rounded-[20px] border p-4 backdrop-blur-md transition-all duration-300"
                      style={{
                        transform: 'rotateX(52deg) rotateZ(-28deg)',
                        background: isActive
                          ? `linear-gradient(135deg, color-mix(in srgb, ${layer.color} 28%, var(--bg-card)), var(--bg-card))`
                          : 'var(--bg-shell)',
                        borderColor: isActive ? layer.color : 'var(--hairline)',
                        boxShadow: isActive
                          ? `0 22px 46px -12px color-mix(in srgb, ${layer.color} 45%, rgba(0,0,0,0.45)), var(--glass-specular)`
                          : '0 14px 32px -12px rgba(0,0,0,0.38), var(--glass-specular)',
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className="rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold"
                          style={{
                            background: `color-mix(in srgb, ${layer.color} 22%, transparent)`,
                            color: layer.color,
                          }}
                        >
                          {layer.id}
                        </span>
                        <span className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                          {lang === 'zh' ? layer.zhName : layer.enName}
                        </span>
                      </div>

                      {/* Subtle architectural wireframe hint inside each glass layer */}
                      <div className="grid grid-cols-12 gap-2 opacity-65">
                        <div
                          className="col-span-3 h-8 rounded-[7px]"
                          style={{ background: 'var(--bg-subtle-hover)' }}
                        />
                        <div
                          className="col-span-6 h-8 rounded-[7px]"
                          style={{
                            background: isActive
                              ? `color-mix(in srgb, ${layer.color} 24%, var(--bg-subtle))`
                              : 'var(--bg-subtle)',
                          }}
                        />
                        <div
                          className="col-span-3 h-8 rounded-[7px]"
                          style={{ background: 'var(--bg-subtle)' }}
                        />
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* Right 5 cols: Synchronized Layer Legend */}
          <div className="space-y-2.5 lg:col-span-5">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'var(--text-2)' }}>
              <Stack size={17} weight="duotone" style={{ color: 'var(--accent)' }} />
              <span>{lang === 'zh' ? '悬停或点击高亮每一级景深' : 'Hover or click any elevation plane'}</span>
            </div>

            {LAYERS.map((layer) => {
              const active = focusedLayer === layer.id;
              return (
                <button
                  key={layer.id}
                  type="button"
                  onClick={() => setFocusedLayer(layer.id)}
                  onMouseEnter={() => setFocusedLayer(layer.id)}
                  className="w-full rounded-[14px] border p-3.5 text-left transition-all"
                  style={{
                    background: active ? 'var(--bg-card)' : 'transparent',
                    borderColor: active ? layer.color : 'var(--hairline-soft)',
                    boxShadow: active ? 'var(--shadow-card)' : 'none',
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className="rounded-md px-2 py-0.5 font-mono text-[11px] font-bold"
                      style={{
                        background: `color-mix(in srgb, ${layer.color} 18%, transparent)`,
                        color: layer.color,
                      }}
                    >
                      {layer.id}
                    </span>
                    <span className="text-[14px] font-semibold" style={{ color: 'var(--text-1)' }}>
                      {lang === 'zh' ? layer.zhName : layer.enName}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-[1.55]" style={{ color: 'var(--text-2)' }}>
                    {lang === 'zh' ? layer.zhDesc : layer.enDesc}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* PART 2: Interactive Engineering & Material Vault (Zero overlapping stack bleed!) */}
        <SpecularCard className="site-glass-shell mt-8 rounded-[26px] border p-6 sm:p-9">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-5" style={{ borderColor: 'var(--hairline-soft)' }}>
            <div className="site-segmented relative flex flex-wrap items-center gap-1 text-[13px] font-medium">
              {(
                [
                  { id: 'glass', icon: Sparkle, zh: '双态玻璃对比帘', en: 'Obsidian vs Porcelain' },
                  { id: 'local', icon: FolderOpen, zh: '100% 本地明文目录', en: 'Plain-Text Folder' },
                  { id: 'git', icon: GitBranch, zh: 'Git LWW 无损自愈', en: 'Git LWW Merge' },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = vaultTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setVaultTab(tab.id)}
                    className="relative flex items-center gap-2 rounded-[9px] px-3.5 py-2 transition-colors"
                    style={{ color: active ? 'var(--text-1)' : 'var(--text-2)' }}
                  >
                    {active && (
                      <motion.span
                        layoutId="vault-tab-pill"
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        className="absolute inset-0 rounded-[9px]"
                        style={{
                          background: 'var(--seg-active-bg)',
                          boxShadow: 'var(--seg-active-shadow)',
                        }}
                      />
                    )}
                    <Icon size={16} weight={active ? 'fill' : 'duotone'} className="relative z-10" style={{ color: active ? 'var(--accent)' : 'var(--text-3)' }} />
                    <span className="relative z-10">{lang === 'zh' ? tab.zh : tab.en}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-7 grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
            {/* Left Copy */}
            <div className="lg:col-span-5">
              {vaultTab === 'glass' && (
                <>
                  <h3 className="text-[24px] font-bold tracking-tight sm:text-[28px]" style={{ color: 'var(--text-1)' }}>
                    {copy.principles.cards[3].title}
                  </h3>
                  <p className="mt-3 text-[14.5px] leading-[1.7]" style={{ color: 'var(--text-2)' }}>
                    {copy.principles.cards[3].body}
                  </p>
                  <div className="mt-5 space-y-2">
                    {copy.principles.cards[3].points.map((pt) => (
                      <div key={pt} className="flex items-center gap-2 text-[13.5px] font-medium">
                        <CheckCircle size={16} weight="duotone" style={{ color: 'var(--accent)' }} />
                        <span>{pt}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {vaultTab === 'local' && (
                <>
                  <h3 className="text-[24px] font-bold tracking-tight sm:text-[28px]" style={{ color: 'var(--text-1)' }}>
                    {copy.principles.cards[0].title}
                  </h3>
                  <p className="mt-3 text-[14.5px] leading-[1.7]" style={{ color: 'var(--text-2)' }}>
                    {copy.principles.cards[0].body}
                  </p>
                  <div className="mt-5 space-y-2">
                    {copy.principles.cards[0].points.map((pt) => (
                      <div key={pt} className="flex items-center gap-2 text-[13.5px] font-medium">
                        <CheckCircle size={16} weight="duotone" style={{ color: 'var(--accent)' }} />
                        <span>{pt}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {vaultTab === 'git' && (
                <>
                  <h3 className="text-[24px] font-bold tracking-tight sm:text-[28px]" style={{ color: 'var(--text-1)' }}>
                    {copy.principles.cards[1].title}
                  </h3>
                  <p className="mt-3 text-[14.5px] leading-[1.7]" style={{ color: 'var(--text-2)' }}>
                    {copy.principles.cards[1].body}
                  </p>
                  <div className="mt-5 space-y-2">
                    {copy.principles.cards[1].points.map((pt) => (
                      <div key={pt} className="flex items-center gap-2 text-[13.5px] font-medium">
                        <CheckCircle size={16} weight="duotone" style={{ color: 'var(--accent)' }} />
                        <span>{pt}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Right Interactive Panel */}
            <div className="lg:col-span-7">
              {vaultTab === 'glass' && (
                <div className="space-y-3">
                  <div
                    ref={compareBoxRef}
                    onPointerDown={(e) => {
                      draggingRef.current = true;
                      e.currentTarget.setPointerCapture(e.pointerId);
                      updateCompareFromX(e.clientX);
                    }}
                    onPointerMove={(e) => {
                      if (!draggingRef.current) return;
                      updateCompareFromX(e.clientX);
                    }}
                    onPointerUp={(e) => {
                      draggingRef.current = false;
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

              {vaultTab === 'local' && (
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
                        className="inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 font-mono text-[12px]"
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
                  <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-[1.7]" style={{ color: 'var(--text-1)' }}>
                    <code>{WORKSPACE_FILES[selectedFile].preview}</code>
                  </pre>
                </div>
              )}

              {vaultTab === 'git' && (
                <div className="site-card rounded-[18px] p-5">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-[12px] border p-3.5" style={{ background: 'var(--bg-subtle)', borderColor: 'var(--hairline-soft)' }}>
                      <p className="font-mono text-[11.5px]" style={{ color: 'var(--accent)' }}>macOS · 14:20</p>
                      <p className="mt-1.5 text-[13px] font-medium">
                        {lang === 'zh' ? '修改任务 A 排期至周四' : 'Moved Task A due to Thu'}
                      </p>
                    </div>
                    <div className="rounded-[12px] border p-3.5" style={{ background: 'var(--bg-subtle)', borderColor: 'var(--hairline-soft)' }}>
                      <p className="font-mono text-[11.5px]" style={{ color: 'var(--status-orange)' }}>Windows · 14:22</p>
                      <p className="mt-1.5 text-[13px] font-medium">
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
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium"
                        style={{ background: 'var(--status-green-soft)', color: 'var(--status-green)' }}
                      >
                        <CheckCircle size={14} weight="fill" />
                        <span>{copy.principles.gitResolvedLabel}</span>
                      </span>
                    )}
                  </div>
                  <div
                    className="mt-4 rounded-[12px] border p-3.5 font-mono text-[12px]"
                    style={{
                      background: 'var(--bg-canvas-elevated)',
                      borderColor: gitMerged ? 'var(--status-green)' : 'var(--hairline-soft)',
                      color: 'var(--text-2)',
                    }}
                  >
                    {gitMerged
                      ? '✓ merge(local_bundle, remote_bundle) -> 0 conflicts, 30d tombstones intact'
                      : 'git pull --rebase -> waiting for semantic LWW reconciliation'}
                  </div>
                </div>
              )}
            </div>
          </div>
        </SpecularCard>
      </div>
    </section>
  );
}
