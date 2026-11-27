import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Check, DeviceMobile, Laptop, QrCode, ShieldCheck } from '@phosphor-icons/react';
import type { Lang } from '@/i18n/copy';

interface SyncTask {
  id: string;
  zh: string;
  en: string;
  done: boolean;
}

const INITIAL_SYNC: SyncTask[] = [
  { id: 's1', zh: '地铁上记录新的交互灵感', en: 'Capture idea on commute', done: false },
  { id: 's2', zh: '确认下午版本回归测试项', en: 'Review afternoon QA checklist', done: true },
  { id: 's3', zh: '手机拍白板图直传知识库', en: 'Upload whiteboard photo to Docs', done: false },
];

export function MobileSyncDemo({
  lang,
  autoPlay,
  onInteract,
}: {
  lang: Lang;
  autoPlay: boolean;
  onInteract: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [items, setItems] = useState<SyncTask[]>(INITIAL_SYNC);
  const [pulseKey, setPulseKey] = useState(0);

  useEffect(() => {
    if (!autoPlay || reduceMotion) return;
    const timer = window.setInterval(() => {
      setItems((prev) =>
        prev.map((item, idx) => (idx === 0 ? { ...item, done: !item.done } : item)),
      );
      setPulseKey((k) => k + 1);
    }, 2300);
    return () => window.clearInterval(timer);
  }, [autoPlay, reduceMotion]);

  const toggleItem = (id: string) => {
    onInteract();
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
    );
    setPulseKey((k) => k + 1);
  };

  const pendingCount = items.filter((i) => !i.done).length;

  return (
    <div className="grid grid-cols-1 items-center gap-4 lg:grid-cols-12">
      {/* Desktop Host */}
      <div className="site-card rounded-[16px] p-4 lg:col-span-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <Laptop size={16} weight="duotone" style={{ color: 'var(--accent)' }} />
            <span>{lang === 'zh' ? '电脑本地主机' : 'Desktop Local Host'}</span>
          </div>
          <span
            className="tabular-nums rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: 'var(--status-green-soft)', color: 'var(--status-green)' }}
          >
            {lang === 'zh' ? `托盘剩余 ${pendingCount}` : `Tray: ${pendingCount}`}
          </span>
        </div>

        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[12.5px]"
              style={{ background: 'var(--bg-subtle)' }}
            >
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors"
                style={{
                  borderColor: item.done ? 'var(--status-green)' : 'var(--accent)',
                  background: item.done ? 'var(--status-green)' : 'transparent',
                }}
              >
                {item.done && <Check size={10} weight="bold" color="#ffffff" />}
              </span>
              <span className={item.done ? 'line-through opacity-55' : ''}>
                {lang === 'zh' ? item.zh : item.en}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Encrypted Tunnel Pulse Bridge */}
      <div className="flex flex-col items-center justify-center gap-2 py-2 lg:col-span-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-white text-[#11151E] shadow-md">
          <QrCode size={32} weight="duotone" />
        </div>
        <div className="relative h-2 w-full max-w-[140px] overflow-hidden rounded-full bg-[var(--bg-subtle)]">
          <motion.div
            key={pulseKey}
            initial={reduceMotion ? false : { x: '100%' }}
            animate={{ x: '-100%' }}
            transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
            className="h-full w-1/2 rounded-full"
            style={{ background: 'var(--accent)' }}
          />
        </div>
        <div className="flex items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--status-green)' }}>
          <ShieldCheck size={13} weight="duotone" />
          <span>HTTPS SSE</span>
        </div>
      </div>

      {/* Interactive Mobile Frame */}
      <div
        className="site-float mx-auto w-full max-w-[320px] rounded-[22px] border p-4 lg:col-span-5"
        style={{ borderColor: 'color-mix(in srgb, var(--accent) 32%, var(--hairline))' }}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
            <DeviceMobile size={15} weight="duotone" style={{ color: 'var(--accent)' }} />
            <span>Anchor Mobile</span>
          </div>
          <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            {lang === 'zh' ? '点击勾选试试' : 'Tap to sync'}
          </span>
        </div>

        <div className="space-y-2">
          {items.map((item) => (
            <motion.button
              key={item.id}
              type="button"
              whileTap={reduceMotion ? undefined : { scale: 0.97 }}
              onClick={() => toggleItem(item.id)}
              className="site-card flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-left text-[12.5px]"
            >
              <span
                className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors"
                style={{
                  borderColor: item.done ? 'var(--status-green)' : 'var(--accent)',
                  background: item.done ? 'var(--status-green)' : 'transparent',
                }}
              >
                {item.done && <Check size={11} weight="bold" color="#ffffff" />}
              </span>
              <span className={item.done ? 'line-through opacity-55' : ''}>
                {lang === 'zh' ? item.zh : item.en}
              </span>
            </motion.button>
          ))}
        </div>

        <div
          className="mt-3 grid grid-cols-5 gap-1 rounded-[10px] p-1.5 text-center text-[10px] font-medium"
          style={{ background: 'var(--bg-subtle)', color: 'var(--text-3)' }}
        >
          {(lang === 'zh'
            ? ['待办', '日程', '知识库', '灵感', '复盘']
            : ['Tasks', 'Plan', 'Docs', 'Notes', 'Review']
          ).map((tab, idx) => (
            <span
              key={tab}
              className="rounded-[6px] py-1"
              style={
                idx === 0
                  ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
                  : undefined
              }
            >
              {tab}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
