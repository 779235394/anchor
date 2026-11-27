import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  BookOpen,
  CalendarBlank,
  ChartBar,
  DeviceMobile,
  Kanban,
  Lightning,
  Pause,
  Play,
} from '@phosphor-icons/react';
import type { Lang, SiteCopy } from '@/i18n/copy';
import { TasksKanbanDemo } from './TasksKanbanDemo';
import { ScheduleLunarDemo } from './ScheduleLunarDemo';
import { QuickCaptureStickyDemo } from './QuickCaptureStickyDemo';
import { KnowledgeConsolidateDemo } from './KnowledgeConsolidateDemo';
import { MobileSyncDemo } from './MobileSyncDemo';
import { ReviewAnalyticsDemo } from './ReviewAnalyticsDemo';

type TabId = SiteCopy['showcase']['tabs'][number]['id'];

const TAB_ICONS: Record<TabId, typeof Kanban> = {
  kanban: Kanban,
  schedule: CalendarBlank,
  capture: Lightning,
  knowledge: BookOpen,
  mobile: DeviceMobile,
  review: ChartBar,
};

const AUTO_SWITCH_MS = 6500;

export function ShowcaseShell({ copy, lang }: { copy: SiteCopy; lang: Lang }) {
  const reduceMotion = useReducedMotion();
  const [activeTab, setActiveTab] = useState<TabId>('kanban');
  const [autoPlay, setAutoPlay] = useState(true);

  useEffect(() => {
    if (!autoPlay || reduceMotion) return;
    const ids = copy.showcase.tabs.map((t) => t.id);
    const timer = window.setInterval(() => {
      setActiveTab((prev) => {
        const idx = ids.indexOf(prev);
        return ids[(idx + 1) % ids.length];
      });
    }, AUTO_SWITCH_MS);
    return () => window.clearInterval(timer);
  }, [autoPlay, reduceMotion, copy.showcase.tabs]);

  const pauseAuto = () => {
    setAutoPlay(false);
  };

  const currentTabMeta =
    copy.showcase.tabs.find((t) => t.id === activeTab) || copy.showcase.tabs[0];

  return (
    <section id="showcase" className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8">
        {/* Stacked Section Header (No split-header anti-pattern) */}
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
            {copy.showcase.heading}
          </h2>
          <p
            className="mt-3.5 text-[15.5px] leading-[1.65]"
            style={{ color: 'var(--text-2)' }}
          >
            {copy.showcase.subtext}
          </p>
        </motion.div>

        {/* Glass Theater Container */}
        <div className="site-glass-shell mt-10 overflow-hidden rounded-[24px] p-4 sm:p-6">
          {/* Top Bar: Horizontally scrollable 6-module tabs + Auto-play toggle */}
          <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-center lg:justify-between" style={{ borderColor: 'var(--hairline-soft)' }}>
            <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 lg:pb-0">
              {copy.showcase.tabs.map((tab) => {
                const Icon = TAB_ICONS[tab.id];
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      pauseAuto();
                      setActiveTab(tab.id);
                    }}
                    className="relative flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-medium whitespace-nowrap transition-colors"
                    style={{ color: active ? 'var(--text-1)' : 'var(--text-2)' }}
                  >
                    {active && (
                      <motion.span
                        layoutId="showcase-active-tab"
                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                        className="absolute inset-0 rounded-full border"
                        style={{
                          background: 'var(--accent-soft)',
                          borderColor: 'color-mix(in srgb, var(--accent) 36%, transparent)',
                        }}
                      />
                    )}
                    <Icon
                      size={16}
                      weight={active ? 'fill' : 'duotone'}
                      className="relative z-10"
                      style={{ color: active ? 'var(--accent)' : 'var(--text-3)' }}
                    />
                    <span className="relative z-10 hidden sm:inline">{tab.label}</span>
                    <span className="relative z-10 sm:hidden">{tab.shortLabel}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setAutoPlay((v) => !v)}
              className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border px-3 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors lg:self-auto"
              style={{
                background: 'var(--bg-subtle)',
                borderColor: 'var(--hairline)',
                color: 'var(--text-2)',
              }}
            >
              {autoPlay ? <Pause size={13} weight="bold" /> : <Play size={13} weight="bold" />}
              <span>{autoPlay ? copy.showcase.autoPlayOn : copy.showcase.autoPlayPaused}</span>
            </button>
          </div>

          {/* Active Module Summary + Progress Indicator */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13.5px] leading-[1.55]" style={{ color: 'var(--text-2)' }}>
              {currentTabMeta.summary}
            </p>
            <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>
              {copy.showcase.interactiveTip}
            </span>
          </div>

          {/* Stage Canvas */}
          <div className="mt-5 min-h-[290px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
                transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              >
                {activeTab === 'kanban' && (
                  <TasksKanbanDemo lang={lang} autoPlay={autoPlay} onInteract={pauseAuto} />
                )}
                {activeTab === 'schedule' && (
                  <ScheduleLunarDemo lang={lang} autoPlay={autoPlay} onInteract={pauseAuto} />
                )}
                {activeTab === 'capture' && (
                  <QuickCaptureStickyDemo lang={lang} autoPlay={autoPlay} onInteract={pauseAuto} />
                )}
                {activeTab === 'knowledge' && (
                  <KnowledgeConsolidateDemo
                    lang={lang}
                    autoPlay={autoPlay}
                    onInteract={pauseAuto}
                  />
                )}
                {activeTab === 'mobile' && (
                  <MobileSyncDemo lang={lang} autoPlay={autoPlay} onInteract={pauseAuto} />
                )}
                {activeTab === 'review' && (
                  <ReviewAnalyticsDemo lang={lang} autoPlay={autoPlay} onInteract={pauseAuto} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
