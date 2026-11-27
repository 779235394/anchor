import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Check, Copy } from '@phosphor-icons/react';
import type { Lang } from '@/i18n/copy';

type RangeId = 'day' | 'week' | 'month' | 'year';

interface RangeStats {
  done: number;
  created: number;
  rate: string;
  docs: number;
  projects: Array<{ zh: string; en: string; pct: number; color: string }>;
}

const DATA: Record<RangeId, RangeStats> = {
  day: {
    done: 7,
    created: 8,
    rate: '88%',
    docs: 2,
    projects: [
      { zh: '核心研发', en: 'Core Engineering', pct: 64, color: '#0A84FF' },
      { zh: '知识沉淀', en: 'Knowledge Docs', pct: 24, color: '#14B8A6' },
      { zh: '产品打磨', en: 'Product Craft', pct: 12, color: '#FF9F0A' },
    ],
  },
  week: {
    done: 34,
    created: 39,
    rate: '87%',
    docs: 9,
    projects: [
      { zh: '核心研发', en: 'Core Engineering', pct: 52, color: '#0A84FF' },
      { zh: '知识沉淀', en: 'Knowledge Docs', pct: 29, color: '#14B8A6' },
      { zh: '产品打磨', en: 'Product Craft', pct: 19, color: '#FF9F0A' },
    ],
  },
  month: {
    done: 142,
    created: 158,
    rate: '90%',
    docs: 31,
    projects: [
      { zh: '核心研发', en: 'Core Engineering', pct: 46, color: '#0A84FF' },
      { zh: '知识沉淀', en: 'Knowledge Docs', pct: 34, color: '#14B8A6' },
      { zh: '产品打磨', en: 'Product Craft', pct: 20, color: '#FF9F0A' },
    ],
  },
  year: {
    done: 1280,
    created: 1394,
    rate: '92%',
    docs: 214,
    projects: [
      { zh: '核心研发', en: 'Core Engineering', pct: 49, color: '#0A84FF' },
      { zh: '知识沉淀', en: 'Knowledge Docs', pct: 31, color: '#14B8A6' },
      { zh: '产品打磨', en: 'Product Craft', pct: 20, color: '#FF9F0A' },
    ],
  },
};

const RANGES: Array<{ id: RangeId; zh: string; en: string }> = [
  { id: 'day', zh: '日复盘', en: 'Day' },
  { id: 'week', zh: '周复盘', en: 'Week' },
  { id: 'month', zh: '月复盘', en: 'Month' },
  { id: 'year', zh: '年复盘', en: 'Year' },
];

export function ReviewAnalyticsDemo({
  lang,
  autoPlay,
  onInteract,
}: {
  lang: Lang;
  autoPlay: boolean;
  onInteract: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [range, setRange] = useState<RangeId>('week');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!autoPlay || reduceMotion) return;
    const order: RangeId[] = ['week', 'month', 'year', 'day'];
    let idx = 0;
    const timer = window.setInterval(() => {
      idx = (idx + 1) % order.length;
      setRange(order[idx]);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [autoPlay, reduceMotion]);

  const stats = DATA[range];

  const handleCopy = () => {
    onInteract();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const kpis = [
    { label: lang === 'zh' ? '已完成待办' : 'Completed', value: stats.done, color: 'var(--status-green)' },
    { label: lang === 'zh' ? '新建待办' : 'Created', value: stats.created, color: 'var(--accent)' },
    { label: lang === 'zh' ? '达成率' : 'Completion', value: stats.rate, color: 'var(--status-orange)' },
    { label: lang === 'zh' ? '知识与灵感' : 'Docs & Notes', value: stats.docs, color: 'var(--status-sky)' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="site-segmented relative flex items-center gap-1 text-[12.5px] font-medium">
          {RANGES.map((r) => {
            const active = range === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  onInteract();
                  setRange(r.id);
                }}
                className="relative rounded-[8px] px-3 py-1"
                style={{ color: active ? 'var(--text-1)' : 'var(--text-2)' }}
              >
                {active && (
                  <motion.span
                    layoutId="review-range-pill"
                    transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                    className="absolute inset-0 rounded-[8px]"
                    style={{
                      background: 'var(--seg-active-bg)',
                      boxShadow: 'var(--seg-active-shadow)',
                    }}
                  />
                )}
                <span className="relative z-10">{lang === 'zh' ? r.zh : r.en}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="site-btn-secondary h-8 px-3.5 text-[12px]"
        >
          {copied ? (
            <Check size={14} weight="bold" style={{ color: 'var(--status-green)' }} />
          ) : (
            <Copy size={14} weight="duotone" />
          )}
          <span>
            {copied
              ? lang === 'zh'
                ? '已复制纯净 Markdown'
                : 'Copied Markdown'
              : lang === 'zh'
                ? '一键复制 Markdown 报告'
                : 'Copy Markdown Report'}
          </span>
        </button>
      </div>

      {/* 4 KPI Tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="site-card rounded-[14px] p-3.5">
            <span className="text-[11.5px] font-medium" style={{ color: 'var(--text-3)' }}>
              {kpi.label}
            </span>
            <motion.div
              key={`${range}-${kpi.label}`}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 360, damping: 28 }}
              className="tabular-nums mt-1.5 text-[28px] font-semibold tracking-tight"
              style={{ color: kpi.color }}
            >
              {kpi.value}
            </motion.div>
          </div>
        ))}
      </div>

      {/* Project Focus Distribution */}
      <div className="site-card rounded-[14px] p-4">
        <p className="mb-3 text-[12.5px] font-semibold" style={{ color: 'var(--text-2)' }}>
          {lang === 'zh' ? '项目精力投入分布（示例数据）' : 'Project Energy Distribution (Sample)'}
        </p>
        <div className="space-y-3">
          {stats.projects.map((p) => (
            <div key={p.zh} className="space-y-1">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="font-medium" style={{ color: 'var(--text-1)' }}>
                  {lang === 'zh' ? p.zh : p.en}
                </span>
                <span className="tabular-nums font-semibold" style={{ color: 'var(--text-2)' }}>
                  {p.pct}%
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                <motion.div
                  initial={false}
                  animate={{ width: `${p.pct}%` }}
                  transition={{ type: 'spring', stiffness: 220, damping: 26 }}
                  className="site-progress-bar h-full"
                  style={{ background: p.color }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
