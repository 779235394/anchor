import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Check,
  FilePdf,
  FileText,
  FolderOpen,
  Sparkle,
} from '@phosphor-icons/react';
import type { Lang } from '@/i18n/copy';

const INITIAL_TREE = [
  { id: 'd1', name: '产品设计/v1.0-视觉规范.md', en: 'Design/v1.0-Glass-Spec.md' },
  { id: 'd2', name: '工程/本地同步架构.md', en: 'Engineering/Local-Sync.md' },
  { id: 'd3', name: '复盘/2026-W48-周报.md', en: 'Review/2026-W48.md' },
];

export function KnowledgeConsolidateDemo({
  lang,
  autoPlay,
  onInteract,
}: {
  lang: Lang;
  autoPlay: boolean;
  onInteract: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [merged, setMerged] = useState(false);
  const [pdfReady, setPdfReady] = useState(false);
  const [checkedLine, setCheckedLine] = useState(true);
  const [reordered, setReordered] = useState(false);

  useEffect(() => {
    if (!autoPlay || reduceMotion) return;
    let step = 0;
    const timer = window.setInterval(() => {
      step = (step + 1) % 3;
      if (step === 1) {
        setMerged(true);
        setReordered(true);
      } else if (step === 2) {
        setPdfReady(true);
      } else {
        setMerged(false);
        setPdfReady(false);
        setReordered(false);
      }
    }, 2400);
    return () => window.clearInterval(timer);
  }, [autoPlay, reduceMotion]);

  const tree = reordered
    ? [INITIAL_TREE[1], INITIAL_TREE[0], INITIAL_TREE[2]]
    : INITIAL_TREE;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Left: Real <dataDir>/docs/ tree */}
      <div
        className="rounded-[14px] border p-3.5 lg:col-span-4"
        style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--hairline-soft)' }}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-mono text-[12px]" style={{ color: 'var(--text-2)' }}>
            <FolderOpen size={15} weight="duotone" style={{ color: 'var(--accent)' }} />
            <span>docs/</span>
          </div>
          <button
            type="button"
            onClick={() => {
              onInteract();
              setReordered((r) => !r);
            }}
            className="rounded-[7px] px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--bg-subtle-hover)]"
            style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
          >
            {lang === 'zh' ? '演示拖拽排序' : 'Reorder'}
          </button>
        </div>

        <div className="space-y-1.5">
          {tree.map((node, idx) => (
            <motion.div
              key={node.id}
              layout={!reduceMotion}
              transition={{ type: 'spring', stiffness: 360, damping: 30 }}
              className="flex items-center gap-2 rounded-[9px] px-2.5 py-2 text-[12px]"
              style={{
                background: idx === 0 ? 'var(--accent-soft)' : 'transparent',
                color: idx === 0 ? 'var(--accent)' : 'var(--text-2)',
              }}
            >
              <FileText size={14} weight="duotone" />
              <span className="truncate font-medium">
                {lang === 'zh' ? node.name : node.en}
              </span>
            </motion.div>
          ))}
        </div>

        {/* Consolidate Notes Trigger */}
        <div
          className="mt-4 rounded-[12px] border p-3"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--hairline)' }}
        >
          <p className="text-[11.5px] font-medium" style={{ color: 'var(--text-2)' }}>
            {lang === 'zh' ? '3 条待沉淀灵感碎片' : '3 loose notes ready'}
          </p>
          <button
            type="button"
            onClick={() => {
              onInteract();
              setMerged((m) => !m);
            }}
            className="site-btn-primary mt-2.5 h-8 w-full text-[12px]"
          >
            <Sparkle size={14} weight="bold" />
            <span>
              {merged
                ? lang === 'zh'
                  ? '重置灵感碎片'
                  : 'Reset Notes'
                : lang === 'zh'
                  ? '一键合并沉淀为 .md'
                  : 'Consolidate into .md'}
            </span>
          </button>
        </div>
      </div>

      {/* Right: Markdown Live View + Checklist write-back + PDF Export */}
      <div className="site-card flex flex-col justify-between rounded-[14px] p-4 lg:col-span-8">
        <div>
          <div
            className="flex flex-wrap items-center justify-between gap-2 border-b pb-3"
            style={{ borderColor: 'var(--hairline-soft)' }}
          >
            <span className="font-mono text-[12.5px] font-semibold" style={{ color: 'var(--text-1)' }}>
              {lang === 'zh' ? 'docs/产品设计/v1.0-视觉规范.md' : 'docs/Design/v1.0-Glass-Spec.md'}
            </span>

            <button
              type="button"
              onClick={() => {
                onInteract();
                setPdfReady((p) => !p);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors"
              style={{
                background: pdfReady ? 'var(--status-green-soft)' : 'var(--bg-subtle)',
                borderColor: pdfReady ? 'var(--status-green)' : 'var(--hairline)',
                color: pdfReady ? 'var(--status-green)' : 'var(--text-1)',
              }}
            >
              <FilePdf size={14} weight="duotone" />
              <span>
                {pdfReady
                  ? lang === 'zh'
                    ? 'A4 矢量 PDF 已导出'
                    : 'A4 Vector PDF Exported'
                  : lang === 'zh'
                    ? '导出 A4 矢量 PDF'
                    : 'Export A4 PDF'}
              </span>
            </button>
          </div>

          <div className="mt-3.5 space-y-2.5">
            <h4 className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>
              {lang === 'zh'
                ? '阅读态直接勾选清单并回写原文件'
                : 'Check items in read mode with live .md write-back'}
            </h4>

            <button
              type="button"
              onClick={() => {
                onInteract();
                setCheckedLine((c) => !c);
              }}
              className="flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-subtle-hover)]"
              style={{ background: 'var(--bg-subtle)' }}
            >
              <span className="flex items-center gap-2.5 text-[13px]">
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-[4px] border"
                  style={{
                    background: checkedLine ? 'var(--accent)' : 'transparent',
                    borderColor: checkedLine ? 'var(--accent)' : 'var(--text-3)',
                  }}
                >
                  {checkedLine && <Check size={10} weight="bold" color="#ffffff" />}
                </span>
                <span className={checkedLine ? 'line-through opacity-60' : ''}>
                  {lang === 'zh'
                    ? '图片采用便携相对路径 ../attachments/ 归档'
                    : 'Archive images via portable ../attachments/ paths'}
                </span>
              </span>
              <code className="text-[11px]" style={{ color: 'var(--accent)' }}>
                {checkedLine ? '- [x]' : '- [ ]'}
              </code>
            </button>

            <AnimatePresence>
              {merged && (
                <motion.div
                  initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
                  transition={{ type: 'spring', stiffness: 340, damping: 26 }}
                  className="rounded-[12px] border p-3"
                  style={{
                    background: 'var(--accent-soft)',
                    borderColor: 'color-mix(in srgb, var(--accent) 32%, transparent)',
                  }}
                >
                  <p className="text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
                    {lang === 'zh'
                      ? '## 2026-11-27 灵感合并沉淀（已自动去重标签）'
                      : '## 2026-11-27 Consolidated Notes (Auto-deduplicated)'}
                  </p>
                  <p className="mt-1 text-[12.5px] leading-[1.55]" style={{ color: 'var(--text-1)' }}>
                    {lang === 'zh'
                      ? '将零散灵感、附图与会议纪要按时间顺序合流为标准 Markdown，随时在 VS Code 或 Typora 中无缝打开。'
                      : 'Merged field notes, screenshots, and meeting thoughts into clean Markdown ready for VS Code or Typora.'}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
