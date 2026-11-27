import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  CheckCircle,
  ClockCounterClockwise,
  Command,
  Image,
  Keyboard,
  MagnifyingGlass,
  Palette,
  ShieldCheck,
} from '@phosphor-icons/react';
import type { AccentKey, Lang, SiteCopy, ThemeMode } from '@/i18n/copy';
import { SpecularCard } from './SpecularCard';

interface FeatureBentoProps {
  copy: SiteCopy;
  lang: Lang;
  theme: ThemeMode;
  accent: AccentKey;
  onSelectAccent: (accent: AccentKey) => void;
  primaryCtaLabel: string;
}

const ACCENT_SWATCHES: Array<{ key: AccentKey; color: string }> = [
  { key: 'blue', color: '#0A84FF' },
  { key: 'indigo', color: '#5E5CE6' },
  { key: 'teal', color: '#14B8A6' },
  { key: 'graphite', color: '#78787D' },
];

const SEARCH_CORPUS = [
  { id: 's1', kindZh: '日程排期', kindEn: 'Schedule', zh: '十一月迭代排期与农历甘特', en: 'November sprint calendar & lunar view' },
  { id: 's2', kindZh: '知识库', kindEn: 'Docs', zh: 'v1.0 白瓷与曜石玻璃设计规范.md', en: 'v1.0 Porcelain & Obsidian spec.md' },
  { id: 's3', kindZh: '附件', kindEn: 'PDF', zh: '架构评审报告导出 A4 矢量 PDF', en: 'Architecture review A4 vector PDF export' },
  { id: 's4', kindZh: '待办', kindEn: 'Task', zh: '校准 Git 同步记录级 LWW 合并用例', en: 'Verify Git record-level LWW merge suite' },
];

export function FeatureBento({
  copy,
  lang,
  theme,
  accent,
  onSelectAccent,
  primaryCtaLabel,
}: FeatureBentoProps) {
  const reduceMotion = useReducedMotion();
  const [query, setQuery] = useState('');
  const [pasted, setPasted] = useState(false);
  const [snapshotVerified, setSnapshotVerified] = useState(false);

  const filtered = SEARCH_CORPUS.filter((item) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${item.zh} ${item.en} ${item.kindZh} ${item.kindEn}`.toLowerCase().includes(q);
  });

  const bannerArt =
    theme === 'dark'
      ? `${import.meta.env.BASE_URL}images/obsidian-glass-art.jpg`
      : `${import.meta.env.BASE_URL}images/porcelain-glass-art.jpg`;

  return (
    <section id="highlights" className="relative py-20 sm:py-28">
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
            {copy.bento.heading}
          </h2>
          <p className="mt-3.5 text-[15.5px] leading-[1.65]" style={{ color: 'var(--text-2)' }}>
            {copy.bento.subtext}
          </p>
        </motion.div>

        {/* Exact 6-Cell Asymmetric Grid: 7+5, 4+4+4, 12 */}
        <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Cell 1 (7 cols): Live Interactive Spotlight Search */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.48 }}
            className="lg:col-span-7"
          >
            <SpecularCard className="site-glass-shell h-full rounded-[22px] border p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Command size={20} weight="duotone" style={{ color: 'var(--accent)' }} />
                <h3 className="text-[18px] font-semibold" style={{ color: 'var(--text-1)' }}>
                  {copy.bento.spotlightTitle}
                </h3>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="site-kbd">⌘</kbd>
                <kbd className="site-kbd">K</kbd>
              </div>
            </div>
            <p className="mt-2 text-[14px] leading-[1.6]" style={{ color: 'var(--text-2)' }}>
              {copy.bento.spotlightDesc}
            </p>

            <div className="site-card mt-4 overflow-hidden rounded-[14px]">
              <div
                className="flex items-center gap-2.5 border-b px-3.5 py-2.5"
                style={{ borderColor: 'var(--hairline-soft)' }}
              >
                <MagnifyingGlass size={16} style={{ color: 'var(--text-3)' }} />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={copy.bento.spotlightPlaceholder}
                  aria-label={copy.bento.spotlightTitle}
                  className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-[var(--text-3)]"
                  style={{ color: 'var(--text-1)' }}
                />
              </div>

              <div className="divide-y" style={{ borderColor: 'var(--hairline-soft)' }}>
                {filtered.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13px]"
                  >
                    <span className="truncate font-medium" style={{ color: 'var(--text-1)' }}>
                      {lang === 'zh' ? item.zh : item.en}
                    </span>
                    <span
                      className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                      style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      {lang === 'zh' ? item.kindZh : item.kindEn}
                    </span>
                  </div>
                ))}
                {filtered.length === 0 && (
                  <div className="px-3.5 py-4 text-[13px]" style={{ color: 'var(--text-3)' }}>
                    {lang === 'zh' ? '未匹配到演示条目，试试清空关键词' : 'No demo matches, try clearing query'}
                  </div>
                )}
              </div>
            </div>
            </SpecularCard>
          </motion.div>

          {/* Cell 2 (5 cols): Live 4-Accent Atmosphere Switcher */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.48, delay: 0.06 }}
            className="relative flex flex-col justify-between overflow-hidden rounded-[22px] border p-6 lg:col-span-5"
            style={{
              background:
                'radial-gradient(circle at 85% 15%, var(--accent-soft), transparent 65%), var(--bg-card)',
              borderColor: 'color-mix(in srgb, var(--accent) 26%, var(--hairline))',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <div>
              <div className="flex items-center gap-2.5">
                <Palette size={20} weight="duotone" style={{ color: 'var(--accent)' }} />
                <h3 className="text-[18px] font-semibold" style={{ color: 'var(--text-1)' }}>
                  {copy.bento.accentTitle}
                </h3>
              </div>
              <p className="mt-2 text-[14px] leading-[1.6]" style={{ color: 'var(--text-2)' }}>
                {copy.bento.accentDesc}
              </p>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2.5">
              {ACCENT_SWATCHES.map((sw) => {
                const active = accent === sw.key;
                return (
                  <button
                    key={sw.key}
                    type="button"
                    onClick={() => onSelectAccent(sw.key)}
                    className="flex items-center gap-2.5 rounded-[12px] border px-3.5 py-3 text-left transition-all"
                    style={{
                      background: active ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                      borderColor: active ? 'var(--accent)' : 'var(--hairline-soft)',
                    }}
                  >
                    <span
                      className="h-4 w-4 shrink-0 rounded-full"
                      style={{
                        background: sw.color,
                        boxShadow: active ? `0 0 0 3px color-mix(in srgb, ${sw.color} 32%, transparent)` : 'none',
                      }}
                    />
                    <span className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                      {copy.bento.accentNames[sw.key]}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>

          {/* Cell 3 (4 cols): Smart Paste Screenshot & Local Path */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.48 }}
            className="site-card flex flex-col justify-between rounded-[22px] p-6 lg:col-span-4"
          >
            <div>
              <Image size={22} weight="duotone" style={{ color: 'var(--accent)' }} />
              <h3 className="mt-3 text-[17px] font-semibold" style={{ color: 'var(--text-1)' }}>
                {copy.bento.pasteTitle}
              </h3>
              <p className="mt-2 text-[13.5px] leading-[1.65]" style={{ color: 'var(--text-2)' }}>
                {copy.bento.pasteDesc}
              </p>
            </div>

            <div className="mt-5 space-y-2.5">
              <button
                type="button"
                onClick={() => setPasted((p) => !p)}
                className="site-btn-secondary h-9 w-full text-[12.5px]"
              >
                <kbd className="site-kbd">⌘V</kbd>
                <span>{copy.bento.pasteTrigger}</span>
              </button>
              {pasted && (
                <motion.div
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 rounded-[10px] px-3 py-2 font-mono text-[11.5px]"
                  style={{ background: 'var(--status-green-soft)', color: 'var(--status-green)' }}
                >
                  <CheckCircle size={14} weight="fill" />
                  <span className="truncate">{copy.bento.pasteArchived}</span>
                </motion.div>
              )}
            </div>
          </motion.div>

          {/* Cell 4 (4 cols): 7-Day Rolling Snapshots */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.48, delay: 0.05 }}
            className="site-card flex flex-col justify-between rounded-[22px] p-6 lg:col-span-4"
          >
            <div>
              <ClockCounterClockwise size={22} weight="duotone" style={{ color: 'var(--status-green)' }} />
              <h3 className="mt-3 text-[17px] font-semibold" style={{ color: 'var(--text-1)' }}>
                {copy.bento.snapshotTitle}
              </h3>
              <p className="mt-2 text-[13.5px] leading-[1.65]" style={{ color: 'var(--text-2)' }}>
                {copy.bento.snapshotDesc}
              </p>
            </div>

            <div className="mt-5 space-y-3">
              <div className="grid grid-cols-7 gap-1.5">
                {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                  <div
                    key={day}
                    className="h-6 rounded-[6px] transition-colors"
                    style={{
                      background: snapshotVerified
                        ? 'var(--status-green)'
                        : 'color-mix(in srgb, var(--accent) 26%, var(--bg-subtle))',
                      opacity: 0.45 + day * 0.08,
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSnapshotVerified((v) => !v)}
                className="site-btn-secondary h-9 w-full text-[12.5px]"
              >
                <span>
                  {snapshotVerified ? copy.bento.snapshotRestored : copy.bento.snapshotRestore}
                </span>
              </button>
            </div>
          </motion.div>

          {/* Cell 5 (4 cols): Dual Global Hotkeys & Tray */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.48, delay: 0.1 }}
            className="site-card flex flex-col justify-between rounded-[22px] p-6 lg:col-span-4"
          >
            <div>
              <Keyboard size={22} weight="duotone" style={{ color: 'var(--status-orange)' }} />
              <h3 className="mt-3 text-[17px] font-semibold" style={{ color: 'var(--text-1)' }}>
                {copy.bento.panelTitle}
              </h3>
              <p className="mt-2 text-[13.5px] leading-[1.65]" style={{ color: 'var(--text-2)' }}>
                {copy.bento.panelDesc}
              </p>
            </div>

            <div className="mt-5 space-y-2">
              <div
                className="flex items-center justify-between rounded-[10px] px-3 py-2 text-[12px]"
                style={{ background: 'var(--bg-subtle)' }}
              >
                <span style={{ color: 'var(--text-2)' }}>
                  {lang === 'zh' ? '快捷灵感小窗' : 'Quick Capture'}
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="site-kbd">⌥</kbd>
                  <kbd className="site-kbd">Space</kbd>
                </span>
              </div>
              <div
                className="flex items-center justify-between rounded-[10px] px-3 py-2 text-[12px]"
                style={{ background: 'var(--bg-subtle)' }}
              >
                <span style={{ color: 'var(--text-2)' }}>
                  {lang === 'zh' ? '新建置顶便签' : 'New Sticky'}
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="site-kbd">⌥</kbd>
                  <kbd className="site-kbd">⇧</kbd>
                  <kbd className="site-kbd">N</kbd>
                </span>
              </div>
            </div>
          </motion.div>

          {/* Cell 6 (12 cols): Architectural Studio Glass Sovereignty Banner */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.48 }}
            className="relative overflow-hidden rounded-[22px] border p-7 sm:p-9 lg:col-span-12"
            style={{ borderColor: 'var(--bg-shell-border)' }}
          >
            <img
              src={bannerArt}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              style={{ opacity: theme === 'dark' ? 0.32 : 0.45 }}
            />
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  theme === 'dark'
                    ? 'linear-gradient(90deg, rgba(8,10,16,0.92) 0%, rgba(8,10,16,0.72) 55%, rgba(8,10,16,0.52) 100%)'
                    : 'linear-gradient(90deg, rgba(244,247,253,0.94) 0%, rgba(244,247,253,0.78) 55%, rgba(244,247,253,0.56) 100%)',
              }}
            />
            <div className="relative z-10 flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
              <div className="max-w-[600px]">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck size={22} weight="duotone" style={{ color: 'var(--accent)' }} />
                  <h3 className="text-[20px] font-bold tracking-tight sm:text-[24px]" style={{ color: 'var(--text-1)' }}>
                    {copy.bento.sovereigntyTitle}
                  </h3>
                </div>
                <p className="mt-2.5 text-[14.5px] leading-[1.68]" style={{ color: 'var(--text-2)' }}>
                  {copy.bento.sovereigntyDesc}
                </p>
              </div>
              <a href="#download" className="site-btn-primary h-11 shrink-0 px-6 text-[14px]">
                <span>{primaryCtaLabel}</span>
              </a>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
