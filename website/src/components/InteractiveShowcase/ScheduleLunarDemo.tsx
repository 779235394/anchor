import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CalendarBlank, Clock, Plus } from '@phosphor-icons/react';
import type { Lang } from '@/i18n/copy';

interface UnscheduledItem {
  id: string;
  zh: string;
  en: string;
  color: string;
  targetDay: number;
  spanDays: number;
}

const POOL_ITEMS: UnscheduledItem[] = [
  { id: 'u1', zh: '官网动效细节走查', en: 'Website motion audit', color: '#0A84FF', targetDay: 27, spanDays: 2 },
  { id: 'u2', zh: '双端安装包回归验收', en: 'Installer QA sweep', color: '#14B8A6', targetDay: 29, spanDays: 2 },
  { id: 'u3', zh: '月度产品复盘汇总', en: 'Monthly review wrap', color: '#FF9F0A', targetDay: 25, spanDays: 1 },
];

const DAYS = [
  { d: 23, lunar: '十四', today: false },
  { d: 24, lunar: '十五', today: false },
  { d: 25, lunar: '十六', today: false },
  { d: 26, lunar: '十七', today: false },
  { d: 27, lunar: '十八', today: true },
  { d: 28, lunar: '十九', today: false },
  { d: 29, lunar: '二十', today: false },
  { d: 30, lunar: '廿一', today: false },
  { d: 1, lunar: '冬月', today: false, monthStart: true },
  { d: 2, lunar: '初二', today: false },
  { d: 3, lunar: '初三', today: false },
  { d: 4, lunar: '初四', today: false },
  { d: 5, lunar: '初五', today: false },
  { d: 6, lunar: '初六', today: false },
];

const WEEK_SLOTS = [
  { time: '09:30', zh: '技术方案对齐 & 接口评审', en: 'API architecture sync', color: '#0A84FF', span: 2 },
  { time: '14:00', zh: '深度编码：移动端同步测试', en: 'Deep work: mobile sync tests', color: '#14B8A6', span: 2 },
  { time: '16:30', zh: '周复盘归档与下周排期', en: 'Weekly review & next sprint', color: '#FF9F0A', span: 1 },
];

export function ScheduleLunarDemo({
  lang,
  autoPlay,
  onInteract,
}: {
  lang: Lang;
  autoPlay: boolean;
  onInteract: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [view, setView] = useState<'month' | 'week'>('month');
  const [scheduledIds, setScheduledIds] = useState<string[]>(['u3']);

  useEffect(() => {
    if (!autoPlay || reduceMotion) return;
    let step = 0;
    const timer = window.setInterval(() => {
      step = (step + 1) % 3;
      if (step === 1) {
        setView('month');
        setScheduledIds(['u3', 'u1']);
      } else if (step === 2) {
        setView('week');
      } else {
        setView('month');
        setScheduledIds(['u3']);
      }
    }, 2400);
    return () => window.clearInterval(timer);
  }, [autoPlay, reduceMotion]);

  const toggleSchedule = (id: string) => {
    onInteract();
    setScheduledIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Left Mini Pool */}
      <div
        className="flex flex-col justify-between rounded-[14px] border p-3.5 lg:col-span-4"
        style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--hairline-soft)' }}
      >
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold" style={{ color: 'var(--text-1)' }}>
              {lang === 'zh' ? '未排期池（点击飞入日历）' : 'Unscheduled Pool (Click to schedule)'}
            </span>
          </div>

          <div className="mt-3 space-y-2">
            {POOL_ITEMS.map((item) => {
              const placed = scheduledIds.includes(item.id);
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  whileTap={reduceMotion ? undefined : { scale: 0.98 }}
                  onClick={() => toggleSchedule(item.id)}
                  className="site-card flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left"
                  style={{ opacity: placed ? 0.55 : 1 }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: item.color }}
                    />
                    <span className="text-[12.5px] font-medium" style={{ color: 'var(--text-1)' }}>
                      {lang === 'zh' ? item.zh : item.en}
                    </span>
                  </div>
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      background: placed ? 'var(--status-green-soft)' : 'var(--accent-soft)',
                      color: placed ? 'var(--status-green)' : 'var(--accent)',
                    }}
                  >
                    {placed ? (lang === 'zh' ? '已排期' : 'Placed') : <Plus size={11} weight="bold" />}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>

        <div
          className="mt-4 flex items-center justify-between rounded-[10px] px-3 py-2 text-[11.5px]"
          style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
        >
          <span>{lang === 'zh' ? '农历与跨天图层' : 'Lunar & Multi-day Layer'}</span>
          <span style={{ color: 'var(--accent)' }}>{lang === 'zh' ? '原生零依赖' : 'Zero-dep'}</span>
        </div>
      </div>

      {/* Right Calendar / Timeline Stage */}
      <div className="site-card rounded-[14px] p-3.5 lg:col-span-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold">
            {view === 'month' ? (
              <CalendarBlank size={16} weight="duotone" style={{ color: 'var(--accent)' }} />
            ) : (
              <Clock size={16} weight="duotone" style={{ color: 'var(--accent)' }} />
            )}
            <span className="tabular-nums">
              {lang === 'zh' ? '2026 年 11 月' : 'November 2026'}
            </span>
          </div>

          <div className="site-segmented relative flex items-center gap-1 text-[12px] font-medium">
            {(['month', 'week'] as const).map((mode) => {
              const active = view === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    onInteract();
                    setView(mode);
                  }}
                  className="relative rounded-[8px] px-3 py-1 transition-colors"
                  style={{ color: active ? 'var(--text-1)' : 'var(--text-2)' }}
                >
                  {active && (
                    <motion.span
                      layoutId="sched-seg-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-[8px]"
                      style={{
                        background: 'var(--seg-active-bg)',
                        boxShadow: 'var(--seg-active-shadow)',
                      }}
                    />
                  )}
                  <span className="relative z-10">
                    {mode === 'month'
                      ? lang === 'zh'
                        ? '月视图'
                        : 'Month'
                      : lang === 'zh'
                        ? '周时间轴'
                        : 'Week'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {view === 'month' ? (
            <motion.div
              key="month"
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
              className="grid grid-cols-7 gap-1.5"
            >
              {DAYS.map((cell) => {
                const bars = POOL_ITEMS.filter(
                  (item) => scheduledIds.includes(item.id) && item.targetDay === cell.d,
                );
                return (
                  <div
                    key={`${cell.d}-${cell.lunar}`}
                    className="min-h-[82px] rounded-[10px] border p-1.5"
                    style={{
                      background: cell.today ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                      borderColor: cell.today
                        ? 'color-mix(in srgb, var(--accent) 40%, transparent)'
                        : 'var(--hairline-soft)',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className="tabular-nums flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold"
                        style={
                          cell.today
                            ? {
                                background: 'var(--accent)',
                                color: '#ffffff',
                                boxShadow: '0 2px 10px var(--accent-glow)',
                              }
                            : { color: 'var(--text-1)' }
                        }
                      >
                        {cell.d}
                      </span>
                      <span
                        className="text-[10px]"
                        style={{
                          color: cell.monthStart ? 'var(--accent)' : 'var(--text-3)',
                          fontWeight: cell.monthStart ? 600 : 400,
                        }}
                      >
                        {cell.lunar}
                      </span>
                    </div>

                    <div className="mt-1.5 space-y-1">
                      <AnimatePresence>
                        {bars.map((bar) => (
                          <motion.div
                            key={bar.id}
                            initial={reduceMotion ? false : { opacity: 0, scaleX: 0.5 }}
                            animate={{ opacity: 1, scaleX: 1 }}
                            exit={reduceMotion ? undefined : { opacity: 0, scaleX: 0.6 }}
                            transition={{ type: 'spring', stiffness: 360, damping: 26 }}
                            className="truncate rounded-[5px] border-l-[3px] px-1.5 py-0.5 text-[10px] font-medium"
                            style={{
                              borderLeftColor: bar.color,
                              background: `color-mix(in srgb, ${bar.color} 18%, transparent)`,
                              color: 'var(--text-1)',
                              transformOrigin: 'left center',
                            }}
                          >
                            {lang === 'zh' ? bar.zh : bar.en}
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                );
              })}
            </motion.div>
          ) : (
            <motion.div
              key="week"
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
              className="relative space-y-2.5 py-1"
            >
              {/* Current-time red indicator line */}
              <div className="pointer-events-none flex items-center gap-2">
                <span className="tabular-nums text-[10.5px] font-semibold" style={{ color: 'var(--status-red)' }}>
                  15:18
                </span>
                <span className="h-2 w-2 rounded-full" style={{ background: 'var(--status-red)' }} />
                <div className="h-[1.5px] flex-1" style={{ background: 'var(--status-red)' }} />
              </div>

              {WEEK_SLOTS.map((slot, i) => (
                <motion.div
                  key={slot.time}
                  initial={reduceMotion ? false : { opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06, type: 'spring', stiffness: 340, damping: 28 }}
                  className="flex items-center gap-3 rounded-[10px] border-l-[3px] px-3 py-2.5"
                  style={{
                    borderLeftColor: slot.color,
                    background: `color-mix(in srgb, ${slot.color} 13%, var(--bg-subtle))`,
                  }}
                >
                  <span className="tabular-nums text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>
                    {slot.time}
                  </span>
                  <span className="text-[13px] font-medium" style={{ color: 'var(--text-1)' }}>
                    {lang === 'zh' ? slot.zh : slot.en}
                  </span>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
