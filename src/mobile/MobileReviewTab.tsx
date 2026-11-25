import { useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Lightbulb,
  Loader2,
} from 'lucide-react';
import type { Lang, WorkspaceData } from '@/domain/types';
import {
  computeReview,
  generateReviewMarkdown,
  resolveReviewDocTarget,
  resolveReviewPeriod,
  type ReviewGranularity,
} from '@/domain/review';
import {
  getBaseName,
  resolveUniqueDocRelPath,
  stripMdExtension,
  type DocEntry,
} from '@/domain/docs';
import { shiftDate, todayStr } from '@/domain/date';
import { markdownToPlainText } from '@/domain/markdown';
import { mobileApi } from './api';

interface MobileReviewTabProps {
  lang: Lang;
  workspace: WorkspaceData;
  docsTree: DocEntry[];
  onRefreshDocsTree: () => Promise<void>;
  onOpenDocInKnowledge: (relPath: string) => void;
  onToast: (msg: string, tone?: 'ok' | 'err') => void;
}

const GRANULARITIES: Array<{ key: ReviewGranularity; zh: string; en: string }> = [
  { key: 'day', zh: '日', en: 'Day' },
  { key: 'week', zh: '周', en: 'Week' },
  { key: 'month', zh: '月', en: 'Month' },
  { key: 'year', zh: '年', en: 'Year' },
  { key: 'custom', zh: '自定义', en: 'Custom' },
];

export function MobileReviewTab({
  lang,
  workspace,
  docsTree,
  onRefreshDocsTree,
  onOpenDocInKnowledge,
  onToast,
}: MobileReviewTabProps) {
  const zh = lang !== 'en';
  const today = todayStr();

  const [granularity, setGranularity] = useState<ReviewGranularity>('week');
  const [offset, setOffset] = useState(0);
  const [customStart, setCustomStart] = useState(() => shiftDate(today, -6));
  const [customEnd, setCustomEnd] = useState(today);
  const [copied, setCopied] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);

  const period = useMemo(
    () =>
      resolveReviewPeriod({
        granularity,
        today,
        offset,
        customStart,
        customEnd,
        lang,
      }),
    [granularity, today, offset, customStart, customEnd, lang],
  );

  const review = useMemo(
    () => computeReview(workspace, period, today, docsTree),
    [workspace, period, today, docsTree],
  );

  const handleCopyMarkdown = async () => {
    const md = generateReviewMarkdown(review, workspace, today, lang);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      onToast(zh ? '已复制复盘 Markdown 报告' : 'Review Markdown copied', 'ok');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      onToast(zh ? '复制失败' : 'Copy failed', 'err');
    }
  };

  const handleSaveToKnowledge = async () => {
    setSavingDoc(true);
    try {
      const md = generateReviewMarkdown(review, workspace, today, lang);
      const { folderRelPath, baseTitle } = resolveReviewDocTarget(period, lang);
      const { relPath } = resolveUniqueDocRelPath(
        docsTree.filter((e) => !e.isDir).map((e) => e.relPath),
        folderRelPath,
        baseTitle,
      );
      await mobileApi.writeDocFile({ relPath, content: md });
      await onRefreshDocsTree();
      onToast(zh ? `已保存至知识库：${relPath}` : `Saved to Docs: ${relPath}`, 'ok');
      onOpenDocInKnowledge(relPath);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      setSavingDoc(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Granularity & Period Switcher */}
      <div
        className="px-4 pt-2.5 pb-3 space-y-2.5 shrink-0"
        style={{
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--hairline-soft)',
        }}
      >
        <div
          className="grid grid-cols-5 p-1 rounded-[11px]"
          style={{ background: 'var(--bg-subtle)' }}
        >
          {GRANULARITIES.map((g) => {
            const active = granularity === g.key;
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => {
                  setGranularity(g.key);
                  setOffset(0);
                }}
                className="py-1.5 rounded-[8px] text-[12.5px] font-semibold"
                style={{
                  background: active ? 'var(--seg-active-bg)' : 'transparent',
                  color: active ? 'var(--text-1)' : 'var(--text-3)',
                  boxShadow: active ? 'var(--seg-active-shadow)' : 'none',
                }}
              >
                {zh ? g.zh : g.en}
              </button>
            );
          })}
        </div>

        {granularity === 'custom' ? (
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="ap-input text-[12.5px]"
            />
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="ap-input text-[12.5px]"
            />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setOffset((o) => o - 1)}
              className="p-1.5 rounded-[8px]"
              style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-center min-w-0 flex-1">
              <div className="text-[14px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                {period.label}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {period.startDate} ~ {period.endDate}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOffset((o) => o + 1)}
              className="p-1.5 rounded-[8px]"
              style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void handleCopyMarkdown()}
            className="py-2 px-3 rounded-[10px] text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {zh ? '复制 Markdown' : 'Copy Markdown'}
          </button>
          <button
            type="button"
            disabled={savingDoc}
            onClick={() => void handleSaveToKnowledge()}
            className="ap-btn-primary py-2 px-3 rounded-[10px] text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5"
          >
            {savingDoc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />}
            {zh ? '存入知识库' : 'Save to Docs'}
          </button>
        </div>
      </div>

      {/* Scrollable Review Details */}
      <div className="flex-1 overflow-y-auto m-scroll px-4 py-3 pb-24 space-y-3.5">
        {/* KPI Grid */}
        <div className="grid grid-cols-2 gap-2.5">
          {[
            {
              label: zh ? '完成待办' : 'Done Tasks',
              val: review.personal.doneCount,
              sub: zh
                ? `新建 ${review.personal.createdCount} · 完成率 ${review.personal.completionRate}%`
                : `New ${review.personal.createdCount} · ${review.personal.completionRate}%`,
              color: 'var(--accent)',
            },
            {
              label: zh ? '知识库记录' : 'Docs Updated',
              val: review.personal.docsCount,
              sub: zh ? '篇文档更新' : 'markdown docs',
              color: 'var(--status-green)',
            },
            {
              label: zh ? '灵感捕获' : 'Notes Captured',
              val: review.personal.notesCount,
              sub: zh ? '条碎片灵感' : 'quick notes',
              color: 'var(--status-orange)',
            },
            {
              label: zh ? '待跟进/逾期' : 'Blockers',
              val: review.blockers.totalCount,
              sub: zh
                ? `待确认 ${review.blockers.confirmTasks.length} · 逾期 ${review.blockers.overdueTasks.length}`
                : `${review.blockers.confirmTasks.length} confirm · ${review.blockers.overdueTasks.length} overdue`,
              color: review.blockers.totalCount > 0 ? 'var(--status-red)' : 'var(--text-3)',
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-[13px] p-3"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--hairline-soft)',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div className="text-[11.5px] font-medium" style={{ color: 'var(--text-3)' }}>
                {card.label}
              </div>
              <div className="mt-1 text-[22px] font-bold leading-none" style={{ color: card.color }}>
                {card.val}
              </div>
              <div className="mt-1.5 text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
                {card.sub}
              </div>
            </div>
          ))}
        </div>

        {/* Project Effort Bars */}
        {review.personal.effortByProject.length > 0 && (
          <div
            className="rounded-[14px] p-3.5 space-y-2.5"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--hairline-soft)',
            }}
          >
            <div className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
              {zh ? '项目精力分布' : 'Effort by Project'}
            </div>
            <div className="space-y-2">
              {review.personal.effortByProject.map((item) => (
                <div key={item.projectId} className="space-y-1">
                  <div className="flex items-center justify-between text-[12px]">
                    <span style={{ color: 'var(--text-2)' }}>
                      {item.name || (zh ? '未归类' : 'Uncategorized')}
                    </span>
                    <span style={{ color: 'var(--text-3)' }}>
                      {item.count} ({item.share}%)
                    </span>
                  </div>
                  <div
                    className="h-2 rounded-full overflow-hidden"
                    style={{ background: 'var(--bg-subtle)' }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${item.share}%`, background: 'var(--accent)' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed Tasks */}
        <div
          className="rounded-[14px] p-3.5 space-y-2"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--hairline-soft)',
          }}
        >
          <div className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
            <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--status-green)' }} />
            {zh
              ? `已完成待办（${review.personal.doneTasks.length}）`
              : `Completed Tasks (${review.personal.doneTasks.length})`}
          </div>
          {review.personal.doneTasks.length === 0 ? (
            <div className="text-[12.5px]" style={{ color: 'var(--text-3)' }}>
              {zh ? '该周期暂无已完成待办' : 'No completed tasks in this period'}
            </div>
          ) : (
            <div className="space-y-1.5">
              {review.personal.doneTasks.map((t) => (
                <div
                  key={t.id}
                  className="text-[13px] flex items-start gap-1.5"
                  style={{ color: 'var(--text-2)' }}
                >
                  <span className="font-semibold shrink-0" style={{ color: 'var(--text-3)' }}>
                    P{t.prio}
                  </span>
                  <span className="flex-1 break-words">{t.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Docs Updated */}
        {review.personal.docs.length > 0 && (
          <div
            className="rounded-[14px] p-3.5 space-y-2"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--hairline-soft)',
            }}
          >
            <div className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
              <FileText className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              {zh
                ? `知识库更新（${review.personal.docs.length}）`
                : `Docs Updated (${review.personal.docs.length})`}
            </div>
            <div className="space-y-1.5">
              {review.personal.docs.map((d) => (
                <button
                  key={d.relPath}
                  type="button"
                  onClick={() => onOpenDocInKnowledge(d.relPath)}
                  className="w-full text-left text-[13px] truncate block"
                  style={{ color: 'var(--accent)' }}
                >
                  {stripMdExtension(getBaseName(d.relPath))}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Notes Captured */}
        {review.personal.notes.length > 0 && (
          <div
            className="rounded-[14px] p-3.5 space-y-2"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--hairline-soft)',
            }}
          >
            <div className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
              <Lightbulb className="w-4 h-4" style={{ color: 'var(--status-orange)' }} />
              {zh
                ? `周期灵感（${review.personal.notes.length}）`
                : `Notes Captured (${review.personal.notes.length})`}
            </div>
            <div className="space-y-1.5">
              {review.personal.notes.map((n) => (
                <div key={n.id} className="text-[13px] line-clamp-2" style={{ color: 'var(--text-2)' }}>
                  • {markdownToPlainText(n.text).trim()}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Blockers */}
        {review.blockers.totalCount > 0 && (
          <div
            className="rounded-[14px] p-3.5 space-y-2"
            style={{
              background: 'var(--status-red-soft)',
              border: '1px solid var(--status-red-line)',
            }}
          >
            <div className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: 'var(--status-red)' }}>
              <AlertCircle className="w-4 h-4" />
              {zh
                ? `当前待确认与逾期（${review.blockers.totalCount}）`
                : `Follow-ups & Overdue (${review.blockers.totalCount})`}
            </div>
            <div className="space-y-1">
              {review.blockers.confirmTasks.map((t) => (
                <div key={t.id} className="text-[12.5px]" style={{ color: 'var(--text-1)' }}>
                  [{zh ? '待确认' : 'Confirm'}] {t.title}
                </div>
              ))}
              {review.blockers.overdueTasks.map((t) => (
                <div key={t.id} className="text-[12.5px]" style={{ color: 'var(--text-1)' }}>
                  [{zh ? '逾期' : 'Overdue'} {t.due}] {t.title}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
