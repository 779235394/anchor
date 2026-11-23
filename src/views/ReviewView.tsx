import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  FileDown,
} from 'lucide-react';
import { isActive, type Priority } from '@/domain/types';
import { dayDiff, todayStr } from '@/domain/date';
import { computeWeeklyReview, generateWeeklyMarkdown } from '@/domain/review';
import { getDict } from '@/i18n';
import { storageApi } from '@/services/storage';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { PRIO_COLORS } from '@/components/CircularCheck';

export function ReviewView() {
  const { config, data, pushToast } = useWorkbenchStore();
  const t = getDict(config.lang);
  const today = todayStr();
  const [weekOffset, setWeekOffset] = useState(0);

  const review = useMemo(
    () => computeWeeklyReview(data, today, weekOffset),
    [data, today, weekOffset],
  );

  const projectMap = useMemo(
    () => new Map(data.projects.filter(isActive).map((p) => [p.id, p.name])),
    [data.projects],
  );

  const prioMax = Math.max(1, ...Object.values(review.personal.prioDist));
  const effortMax = Math.max(1, ...review.personal.effortByProject.map((e) => e.count));

  const prioNames: Record<Priority, string> = {
    1: t.prio1,
    2: t.prio2,
    3: t.prio3,
    4: t.prio4,
  };

  const handleCopyMd = async () => {
    const md = generateWeeklyMarkdown(review, data, today, config.lang);
    try {
      await navigator.clipboard.writeText(md);
      pushToast(t.revCopiedMd);
    } catch {
      pushToast('Clipboard unavailable', 'err');
    }
  };

  const handleSaveMd = async () => {
    const md = generateWeeklyMarkdown(review, data, today, config.lang);
    try {
      const path = await storageApi.exportMarkdownReport(review.weekKey, md);
      pushToast(t.revSavedMd(path));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  return (
    <div className="h-full overflow-y-auto px-8 py-7">
      <div className="max-w-[960px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-semibold tracking-[-0.025em] leading-tight">
              {t.reviewTitle}
            </h1>
            <p className="text-[13px] mt-1" style={{ color: 'var(--text-2)' }}>
              {review.weekKey} · {review.weekStart.replace(/-/g, '/')} —{' '}
              {review.weekEnd.replace(/-/g, '/')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => setWeekOffset((w) => w - 1)}
                className="ap-btn ap-btn-sm px-2"
                aria-label={t.weekPrev}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setWeekOffset(0)}
                className="ap-btn ap-btn-sm"
              >
                {t.weekThis}
              </button>
              <button
                type="button"
                disabled={weekOffset >= 0}
                onClick={() => setWeekOffset((w) => Math.min(0, w + 1))}
                className="ap-btn ap-btn-sm px-2 disabled:opacity-40"
                aria-label={t.weekNext}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <button type="button" onClick={() => void handleCopyMd()} className="ap-btn ap-btn-sm">
              <Copy className="w-3.5 h-3.5" />
              {t.copyMdBtn}
            </button>
            <button
              type="button"
              onClick={() => void handleSaveMd()}
              className="ap-btn ap-btn-primary ap-btn-sm"
            >
              <FileDown className="w-3.5 h-3.5" />
              {t.exportMdBtn}
            </button>
          </div>
        </div>

        {/* Section 1: Personal Productivity */}
        <section className="space-y-3.5">
          <h2
            className="text-[12px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-3)' }}
          >
            {t.reviewPersonalSec}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { n: review.personal.doneCount, l: t.revDoneTasks },
              { n: review.personal.createdCount, l: t.revNewTasks },
              { n: `${review.personal.completionRate}%`, l: t.revRate },
              { n: review.personal.notesCount, l: t.revNotes },
            ].map((k) => (
              <div key={k.l} className="ap-card px-4 py-4">
                <div className="text-[28px] font-semibold tracking-[-0.03em] leading-none">
                  {k.n}
                </div>
                <div className="text-[12px] mt-1.5" style={{ color: 'var(--text-3)' }}>
                  {k.l}
                </div>
              </div>
            ))}
          </div>

          {/* Pipeline Snapshot */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { n: review.personal.flowCounts.todo, l: t.statusTodo, color: 'var(--text-2)' },
              { n: review.personal.flowCounts.doing, l: t.statusDoing, color: 'var(--accent)' },
              {
                n: review.personal.flowCounts.confirm,
                l: t.statusConfirm,
                color: 'var(--status-orange)',
              },
              {
                n: review.personal.flowCounts.done,
                l: `${t.weekThis}${t.statusDone}`,
                color: 'var(--status-green)',
              },
            ].map((k) => (
              <div key={k.l} className="ap-card px-4 py-3.5 flex items-center justify-between">
                <span className="text-[12.5px] font-medium" style={{ color: 'var(--text-2)' }}>
                  {k.l}
                </span>
                <span className="text-[20px] font-semibold" style={{ color: k.color }}>
                  {k.n}
                </span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Priority Distribution */}
            <div className="ap-card p-5 space-y-3.5">
              <div>
                <h3 className="text-[14.5px] font-semibold">{t.revPrioDist}</h3>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {t.revPrioWarn}
                </p>
              </div>
              <div className="space-y-2.5">
                {([1, 2, 3, 4] as Priority[]).map((p) => {
                  const cnt = review.personal.prioDist[p];
                  const pct = Math.round((cnt / prioMax) * 100);
                  return (
                    <div key={p} className="flex items-center gap-3 text-[12.5px]">
                      <span className="w-[92px] shrink-0" style={{ color: 'var(--text-2)' }}>
                        P{p} · {prioNames[p].slice(0, 4)}
                      </span>
                      <div
                        className="flex-1 h-2 rounded-full overflow-hidden"
                        style={{ background: 'var(--bg-subtle)' }}
                      >
                        <div
                          className="h-full rounded-full ap-ease"
                          style={{
                            width: `${cnt ? Math.max(pct, 4) : 0}%`,
                            background: PRIO_COLORS[p].color,
                          }}
                        />
                      </div>
                      <span className="w-8 text-right font-semibold">{cnt}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Effort by Project */}
            <div className="ap-card p-5 space-y-3.5">
              <h3 className="text-[14.5px] font-semibold">{t.revEffortByProj}</h3>
              {review.personal.effortByProject.length === 0 ? (
                <p className="text-[13px] py-4" style={{ color: 'var(--text-3)' }}>
                  —
                </p>
              ) : (
                <div className="space-y-2.5">
                  {review.personal.effortByProject.map((e) => {
                    const pct = Math.round((e.count / effortMax) * 100);
                    return (
                      <div key={e.projectId} className="flex items-center gap-3 text-[12.5px]">
                        <span
                          className="w-[108px] shrink-0 truncate"
                          style={{ color: 'var(--text-2)' }}
                        >
                          {e.name || t.noProject}
                        </span>
                        <div
                          className="flex-1 h-2 rounded-full overflow-hidden"
                          style={{ background: 'var(--bg-subtle)' }}
                        >
                          <div
                            className="h-full rounded-full ap-ease"
                            style={{
                              width: `${Math.max(pct, 6)}%`,
                              background:
                                e.projectId === '__none' ? 'var(--text-4)' : 'var(--accent)',
                            }}
                          />
                        </div>
                        <span className="w-8 text-right font-semibold">{e.count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Section 2: Personal Blockers & Pending Confirmations */}
        <section className="space-y-3.5">
          <div className="flex items-center justify-between">
            <h2
              className="text-[12px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-3)' }}
            >
              {t.reviewBlockersSec}
            </h2>
            <span
              className="ap-pill"
              style={{
                background: review.blockers.totalCount
                  ? 'var(--status-red-soft)'
                  : 'var(--status-green-soft)',
                color: review.blockers.totalCount
                  ? 'var(--status-red)'
                  : 'var(--status-green)',
              }}
            >
              {review.blockers.totalCount}
            </span>
          </div>

          <div className="ap-card p-5">
            {review.blockers.totalCount === 0 ? (
              <div
                className="flex items-center gap-2.5 text-[13.5px] font-medium"
                style={{ color: 'var(--status-green)' }}
              >
                <CheckCircle2 className="w-5 h-5" />
                <span>{t.revNoBlockers}</span>
              </div>
            ) : (
              <div className="ap-divide">
                {review.blockers.confirmTasks.map((k) => (
                  <div key={`cfm-${k.id}`} className="py-3 first:pt-0 last:pb-0 flex items-start gap-2.5">
                    <Clock
                      className="w-4 h-4 shrink-0 mt-0.5"
                      style={{ color: 'var(--status-orange)' }}
                    />
                    <div className="text-[13.5px] flex flex-wrap items-center gap-1.5">
                      <span
                        className="ap-pill"
                        style={{
                          background: 'var(--status-orange-soft)',
                          color: 'var(--status-orange)',
                        }}
                      >
                        {t.statusConfirm}
                      </span>
                      <span className="font-medium">{k.title}</span>
                      {k.projectId && projectMap.get(k.projectId) && (
                        <span
                          className="ap-pill"
                          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                        >
                          {projectMap.get(k.projectId)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}

                {review.blockers.overdueTasks.map((k) => {
                  const od = -dayDiff(today, k.due);
                  return (
                    <div key={k.id} className="py-3 first:pt-0 last:pb-0 flex items-start gap-2.5">
                      <AlertTriangle
                        className="w-4 h-4 shrink-0 mt-0.5"
                        style={{ color: 'var(--status-orange)' }}
                      />
                      <div className="text-[13.5px] flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{k.title}</span>
                        {k.projectId && projectMap.get(k.projectId) && (
                          <span
                            className="ap-pill"
                            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                          >
                            {projectMap.get(k.projectId)}
                          </span>
                        )}
                        <span style={{ color: 'var(--status-red)' }}>
                          {config.lang === 'zh' ? `逾期 ${od} 天` : `${od}d overdue`}
                        </span>
                        {k.rolls > 0 && (
                          <span style={{ color: 'var(--status-orange)' }}>
                            ({t.rollsBadge(k.rolls)})
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
