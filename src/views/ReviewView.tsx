import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  FileDown,
  FileText,
  Lightbulb,
  ListPlus,
  Sparkles,
} from 'lucide-react';
import { isActive, type Priority, type TaskStatus } from '@/domain/types';
import { dayDiff, formatClock, quarterStart, shiftDate, todayStr } from '@/domain/date';
import {
  getBaseName,
  getParentRelPath,
  resolveUniqueDocRelPath,
  stripMdExtension,
  type DocEntry,
} from '@/domain/docs';
import { markdownToPlainText } from '@/domain/markdown';
import { getTaskDisplayTitle, getTaskSecondaryPreview } from '@/domain/taskContent';
import { getProjectColorMeta } from '@/domain/projectColor';
import {
  computeReview,
  generateReviewMarkdown,
  resolveReviewDocTarget,
  resolveReviewPeriod,
  type ReviewGranularity,
} from '@/domain/review';
import { getDict, taskStatusLabel } from '@/i18n';
import { storageApi } from '@/services/storage';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { PRIO_COLORS } from '@/components/CircularCheck';
import { SegmentedControl } from '@/components/SegmentedControl';
import { STATUS_COLORS } from '@/components/TaskInspector';

const DONE_PREVIEW_LIMIT = 15;
const CREATED_PREVIEW_LIMIT = 12;
const DOCS_PREVIEW_LIMIT = 12;
const NOTES_PREVIEW_LIMIT = 10;

function formatItemTime(ts: number | null | undefined, singleDay: boolean): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  if (singleDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

export function ReviewView() {
  const { config, data, openDoc, pushToast } = useWorkbenchStore();
  const t = getDict(config.lang);
  const today = todayStr();

  const [granularity, setGranularity] = useState<ReviewGranularity>('week');
  const [offset, setOffset] = useState(0);
  const [customStart, setCustomStart] = useState(() => shiftDate(today, -6));
  const [customEnd, setCustomEnd] = useState(today);
  const [docEntries, setDocEntries] = useState<DocEntry[]>([]);
  const [copiedFlag, setCopiedFlag] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);
  const [lastSavedDocPath, setLastSavedDocPath] = useState<string | null>(null);
  const [showAllDone, setShowAllDone] = useState(false);
  const [showAllCreated, setShowAllCreated] = useState(false);
  const [showAllDocs, setShowAllDocs] = useState(false);
  const [showAllNotes, setShowAllNotes] = useState(false);

  // Load Knowledge Base entries so Review displays concrete docs updated in the period
  useEffect(() => {
    let cancelled = false;
    void storageApi
      .listDocsTree()
      .then((list) => {
        if (!cancelled) setDocEntries(list);
      })
      .catch(() => {
        if (!cancelled) setDocEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [config.dataDir, config.storageMode, lastSavedDocPath]);

  const period = useMemo(
    () =>
      resolveReviewPeriod({
        granularity,
        today,
        offset,
        customStart,
        customEnd,
        lang: config.lang,
      }),
    [granularity, today, offset, customStart, customEnd, config.lang],
  );

  const review = useMemo(
    () => computeReview(data, period, today, docEntries),
    [data, period, today, docEntries],
  );

  const isSingleDay = period.daySpan === 1;

  const activeProjects = useMemo(() => data.projects.filter(isActive), [data.projects]);
  const projectMap = useMemo(
    () => new Map(activeProjects.map((p) => [p.id, p])),
    [activeProjects],
  );

  const prioMax = Math.max(1, ...Object.values(review.personal.prioDist));
  const effortMax = Math.max(1, ...review.personal.effortByProject.map((e) => e.count));

  const prioNames: Record<Priority, string> = {
    1: t.prio1,
    2: t.prio2,
    3: t.prio3,
    4: t.prio4,
  };

  const currentPeriodBtnLabel =
    granularity === 'day'
      ? t.revCurrentDay
      : granularity === 'month'
        ? t.revCurrentMonth
        : granularity === 'year'
          ? t.revCurrentYear
          : t.revCurrentWeek;

  const subtitleText = useMemo(() => {
    const startFmt = period.startDate.replace(/-/g, '/');
    const endFmt = period.endDate.replace(/-/g, '/');
    if (period.granularity === 'day') return period.label;
    if (period.granularity === 'week') return `${period.label} · ${startFmt} — ${endFmt}`;
    return `${period.label} · ${startFmt} — ${endFmt} · ${t.revDaysSpan(period.daySpan)}`;
  }, [period, t]);

  const handleGranularityChange = (next: ReviewGranularity) => {
    setGranularity(next);
    setOffset(0);
    setShowAllDone(false);
    setShowAllCreated(false);
    setShowAllDocs(false);
    setShowAllNotes(false);
  };

  const scrollToDetail = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleCopyMd = async () => {
    const md = generateReviewMarkdown(review, data, today, config.lang);
    const markCopied = () => {
      setCopiedFlag(true);
      setTimeout(() => setCopiedFlag(false), 1800);
      pushToast(t.revCopiedMd, 'ok');
    };
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(md);
        markCopied();
        return;
      }
    } catch {
      // Fallback below
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = md;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      markCopied();
    } catch {
      pushToast('Clipboard unavailable', 'err');
    }
  };

  const handleSaveMd = async () => {
    if (savingDoc) return;
    setSavingDoc(true);
    const md = generateReviewMarkdown(review, data, today, config.lang);
    try {
      const existing = await storageApi.listDocsTree();
      const existingFiles = existing.filter((e) => !e.isDir).map((e) => e.relPath);
      const { folderRelPath, baseTitle } = resolveReviewDocTarget(period, config.lang);
      const { relPath } = resolveUniqueDocRelPath(existingFiles, folderRelPath, baseTitle);
      await storageApi.writeDocFile(relPath, md);
      setLastSavedDocPath(relPath);
      pushToast(t.revSavedMd(relPath), 'ok', {
        label: t.noteOpenInKb,
        onClick: () => openDoc(relPath),
      });
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      setSavingDoc(false);
    }
  };

  const visibleDoneTasks = showAllDone
    ? review.personal.doneTasks
    : review.personal.doneTasks.slice(0, DONE_PREVIEW_LIMIT);
  const visibleCreatedTasks = showAllCreated
    ? review.personal.createdTasks
    : review.personal.createdTasks.slice(0, CREATED_PREVIEW_LIMIT);
  const visibleDocs = showAllDocs
    ? review.personal.docs
    : review.personal.docs.slice(0, DOCS_PREVIEW_LIMIT);
  const visibleNotes = showAllNotes
    ? review.personal.notes
    : review.personal.notes.slice(0, NOTES_PREVIEW_LIMIT);

  return (
    <div className="relative h-full flex flex-col overflow-hidden">
      {/* Scroll-Behind Frosted Header (Skeleton D) */}
      <header
        data-tauri-drag-region="deep"
        className="absolute top-0 inset-x-0 z-20 shrink-0 px-7 pt-5 pb-3.5 select-none ap-header-glass"
      >
        <div className="max-w-[960px] mx-auto flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.025em] leading-[1.25]">
              {t.reviewTitle}
            </h1>
            <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-2)' }}>
              {subtitleText}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {lastSavedDocPath && (
              <button
                type="button"
                onClick={() => openDoc(lastSavedDocPath)}
                className="ap-btn ap-btn-sm"
                style={{ color: 'var(--accent)' }}
              >
                <BookOpen className="w-3.5 h-3.5" />
                {t.revViewSavedBtn}
              </button>
            )}
            <button
              type="button"
              disabled={savingDoc}
              onClick={() => void handleSaveMd()}
              className="ap-btn ap-btn-sm disabled:opacity-50"
            >
              <FileDown className="w-3.5 h-3.5" />
              {t.exportMdBtn}
            </button>
            <button
              type="button"
              onClick={() => void handleCopyMd()}
              className="ap-btn ap-btn-primary ap-btn-sm"
            >
              {copiedFlag ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copiedFlag ? t.revCopiedBtn : t.copyMdBtn}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-7 pt-[96px] pb-8">
        <div className="max-w-[960px] mx-auto space-y-6">
          {/* Multi-Range Granularity Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <SegmentedControl<ReviewGranularity>
              value={granularity}
              onChange={handleGranularityChange}
              options={[
                { value: 'day', label: t.revRangeDay },
                { value: 'week', label: t.revRangeWeek },
                { value: 'month', label: t.revRangeMonth },
                { value: 'year', label: t.revRangeYear },
                { value: 'custom', label: t.revRangeCustom },
              ]}
            />

            {granularity !== 'custom' ? (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setOffset((v) => v - 1)}
                  className="ap-btn ap-btn-sm px-2"
                  aria-label={t.weekPrev}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setOffset(0)}
                  className="ap-btn ap-btn-sm min-w-[64px] justify-center"
                >
                  {currentPeriodBtnLabel}
                </button>
                <button
                  type="button"
                  disabled={offset >= 0}
                  onClick={() => setOffset((v) => Math.min(0, v + 1))}
                  className="ap-btn ap-btn-sm px-2 disabled:opacity-40"
                  aria-label={t.weekNext}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-1.5">
                  <input
                    type="date"
                    value={customStart}
                    max={today}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="ap-input py-1 px-2 text-[12px]"
                  />
                  <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                    —
                  </span>
                  <input
                    type="date"
                    value={customEnd}
                    max={today}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="ap-input py-1 px-2 text-[12px]"
                  />
                </div>
                <div className="inline-flex items-center gap-1">
                  {[
                    { label: t.revPreset7d, start: shiftDate(today, -6), end: today },
                    { label: t.revPreset30d, start: shiftDate(today, -29), end: today },
                    { label: t.revPresetQuarter, start: quarterStart(today), end: today },
                  ].map((preset) => {
                    const active =
                      period.startDate === preset.start && period.endDate === preset.end;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setCustomStart(preset.start);
                          setCustomEnd(preset.end);
                        }}
                        className="ap-pill ap-ease"
                        style={{
                          background: active ? 'var(--accent)' : 'var(--bg-subtle)',
                          color: active ? '#ffffff' : 'var(--text-2)',
                        }}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

        {/* Section 1: KPI Summary Cards (click to jump straight to details) */}
        <section className="space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2
              className="text-[11px] font-semibold uppercase tracking-[0.06em]"
              style={{ color: 'var(--text-3)' }}
            >
              {t.reviewPersonalSec}
            </h2>
            {!isSingleDay && review.personal.bestDay && (
              <span
                className="ap-pill inline-flex items-center gap-1"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <Sparkles className="w-3 h-3" />
                {t.revBestDay(review.personal.bestDay.date, review.personal.bestDay.count)}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              {
                n: review.personal.doneCount,
                l: t.revDoneTasks,
                target: 'rev-sec-done',
                icon: CheckCircle2,
                tone: 'var(--accent)',
                soft: 'var(--accent-soft)',
              },
              {
                n: review.personal.createdCount,
                l: t.revNewTasks,
                target: 'rev-sec-created',
                icon: ListPlus,
                tone: 'var(--status-sky)',
                soft: 'var(--status-sky-soft)',
              },
              {
                n: `${review.personal.completionRate}%`,
                l: t.revRate,
                target: '',
                icon: Sparkles,
                tone: 'var(--status-green)',
                soft: 'var(--status-green-soft)',
              },
              {
                n: review.personal.docsCount,
                l: t.revDocs,
                target: 'rev-sec-docs',
                icon: BookOpen,
                tone: '#8B5CF6',
                soft: 'rgba(139, 92, 246, 0.13)',
              },
              {
                n: review.personal.notesCount,
                l: t.revNotes,
                target: 'rev-sec-notes',
                icon: Lightbulb,
                tone: 'var(--status-orange)',
                soft: 'var(--status-orange-soft)',
              },
            ].map((k) => {
              const Icon = k.icon;
              return (
                <button
                  key={k.l}
                  type="button"
                  onClick={() => k.target && scrollToDetail(k.target)}
                  className={`relative overflow-hidden ap-card px-4 py-4 text-left ${
                    k.target
                      ? 'ap-card-interactive hover:border-[var(--accent)] cursor-pointer'
                      : 'cursor-default'
                  }`}
                  style={{
                    backgroundImage: `radial-gradient(90% 80% at 100% 0%, color-mix(in srgb, ${k.tone} 11%, transparent), transparent 70%)`,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[28px] font-semibold tracking-[-0.035em] leading-[1.05]">
                      {k.n}
                    </div>
                    <span
                      className="w-7 h-7 rounded-[9px] inline-flex items-center justify-center shrink-0"
                      style={{ background: k.soft, color: k.tone }}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                  </div>
                  <div className="text-[12px] font-medium mt-2" style={{ color: 'var(--text-3)' }}>
                    {k.l}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Section 2: Concrete Itemized Details (Completed Tasks, Created Tasks, Knowledge Docs, Notes) */}
        <section className="space-y-4">
          <h2
            className="text-[11px] font-semibold uppercase tracking-[0.06em]"
            style={{ color: 'var(--text-3)' }}
          >
            {t.reviewDetailsSec}
          </h2>

          {/* 2.1 Completed Tasks Detail (Full Width for Rich Visibility) */}
          <div id="rev-sec-done" className="ap-card p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[14.5px] font-semibold inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--status-green)' }} />
                {t.revDoneListTitle}
              </h3>
              <span
                className="ap-pill"
                style={{
                  background: review.personal.doneTasks.length
                    ? 'var(--status-green-soft)'
                    : 'var(--bg-subtle)',
                  color: review.personal.doneTasks.length
                    ? 'var(--status-green)'
                    : 'var(--text-3)',
                }}
              >
                {review.personal.doneTasks.length}
              </span>
            </div>
            {review.personal.doneTasks.length === 0 ? (
              <p className="text-[13px] py-2" style={{ color: 'var(--text-3)' }}>
                {t.revDoneListEmpty}
              </p>
            ) : (
              <>
                <div className="ap-divide">
                  {visibleDoneTasks.map((task) => {
                    const proj = task.projectId ? projectMap.get(task.projectId) : null;
                    const projColor = proj ? getProjectColorMeta(proj) : null;
                    const noteSummary = getTaskSecondaryPreview(task);
                    const timeStr = formatItemTime(task.doneAt, isSingleDay);
                    return (
                      <div
                        key={task.id}
                        className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-3 text-[13px]"
                      >
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          <span
                            className="w-2 h-2 rounded-full shrink-0 mt-1.5"
                            style={{ background: PRIO_COLORS[task.prio].color }}
                          />
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium" style={{ color: 'var(--text-1)' }}>
                                {getTaskDisplayTitle(task, config.lang)}
                              </span>
                              <span
                                className="text-[10.5px] font-medium px-1.5 py-[1px] rounded-[6px]"
                                style={{
                                  background: 'var(--bg-subtle)',
                                  color: PRIO_COLORS[task.prio].color,
                                }}
                              >
                                P{task.prio}
                              </span>
                              {proj && projColor && (
                                <span
                                  className="ap-pill shrink-0 text-[11px]"
                                  style={{ background: projColor.soft, color: projColor.dot }}
                                >
                                  {proj.name}
                                </span>
                              )}
                            </div>
                            {noteSummary && (
                              <p
                                className="text-[12px] truncate"
                                style={{ color: 'var(--text-3)' }}
                              >
                                {noteSummary}
                              </p>
                            )}
                          </div>
                        </div>
                        {timeStr && (
                          <span className="text-[11.5px] shrink-0 pt-0.5" style={{ color: 'var(--text-3)' }}>
                            {timeStr}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {review.personal.doneTasks.length > DONE_PREVIEW_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setShowAllDone((v) => !v)}
                    className="w-full py-1.5 rounded-[8px] text-[12px] font-medium hover:bg-[var(--bg-subtle)] ap-ease"
                    style={{ color: 'var(--accent)' }}
                  >
                    {showAllDone
                      ? t.revCollapseList
                      : t.revExpandAll(review.personal.doneTasks.length)}
                  </button>
                )}
              </>
            )}
          </div>

          {/* 2.2 Newly Created Tasks & Knowledge Base Docs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Newly Created Tasks */}
            <div id="rev-sec-created" className="ap-card p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[14.5px] font-semibold inline-flex items-center gap-1.5">
                  <ListPlus className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                  {t.revCreatedListTitle}
                </h3>
                <span
                  className="ap-pill"
                  style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
                >
                  {review.personal.createdTasks.length}
                </span>
              </div>
              {review.personal.createdTasks.length === 0 ? (
                <p className="text-[13px] py-2" style={{ color: 'var(--text-3)' }}>
                  {t.revCreatedListEmpty}
                </p>
              ) : (
                <>
                  <div className="ap-divide">
                    {visibleCreatedTasks.map((task) => {
                      const st: TaskStatus = task.status || (task.done ? 'done' : 'todo');
                      const stStyle = STATUS_COLORS[st];
                      const proj = task.projectId ? projectMap.get(task.projectId) : null;
                      const projColor = proj ? getProjectColorMeta(proj) : null;
                      const timeStr = formatItemTime(task.createdAt, isSingleDay);
                      return (
                        <div
                          key={task.id}
                          className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-2 text-[13px]"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="ap-pill shrink-0 text-[10.5px]"
                              style={{ background: stStyle.soft, color: stStyle.color }}
                            >
                              {taskStatusLabel(st, config.lang)}
                            </span>
                            <span
                              className={`truncate font-medium ${st === 'done' ? 'line-through opacity-65' : ''}`}
                              style={{ color: 'var(--text-1)' }}
                            >
                              {getTaskDisplayTitle(task, config.lang)}
                            </span>
                            {proj && projColor && (
                              <span
                                className="ap-pill shrink-0 text-[10.5px]"
                                style={{ background: projColor.soft, color: projColor.dot }}
                              >
                                {proj.name}
                              </span>
                            )}
                          </div>
                          {timeStr && (
                            <span className="text-[11px] shrink-0" style={{ color: 'var(--text-3)' }}>
                              {timeStr}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {review.personal.createdTasks.length > CREATED_PREVIEW_LIMIT && (
                    <button
                      type="button"
                      onClick={() => setShowAllCreated((v) => !v)}
                      className="w-full py-1.5 rounded-[8px] text-[12px] font-medium hover:bg-[var(--bg-subtle)] ap-ease"
                      style={{ color: 'var(--accent)' }}
                    >
                      {showAllCreated
                        ? t.revCollapseList
                        : t.revExpandAll(review.personal.createdTasks.length)}
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Knowledge Base Docs Updated / Created in Period */}
            <div id="rev-sec-docs" className="ap-card p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[14.5px] font-semibold inline-flex items-center gap-1.5">
                  <BookOpen className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                  {t.revDocsListTitle}
                </h3>
                <span
                  className="ap-pill"
                  style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
                >
                  {review.personal.docs.length}
                </span>
              </div>
              {review.personal.docs.length === 0 ? (
                <p className="text-[13px] py-2" style={{ color: 'var(--text-3)' }}>
                  {t.revDocsListEmpty}
                </p>
              ) : (
                <>
                  <div className="ap-divide">
                    {visibleDocs.map((doc) => {
                      const docTitle = stripMdExtension(getBaseName(doc.relPath));
                      const parentDir = getParentRelPath(doc.relPath);
                      const timeStr = formatItemTime(doc.updatedAt, isSingleDay);
                      return (
                        <button
                          key={doc.relPath}
                          type="button"
                          onClick={() => openDoc(doc.relPath)}
                          className="w-full py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-2 text-[13px] text-left group"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText
                              className="w-3.5 h-3.5 shrink-0"
                              style={{ color: 'var(--text-3)' }}
                            />
                            <span
                              className="truncate font-medium group-hover:text-[var(--accent)] ap-ease"
                              style={{ color: 'var(--text-1)' }}
                            >
                              {docTitle}
                            </span>
                            {parentDir && (
                              <span
                                className="ap-pill shrink-0 text-[10.5px]"
                                style={{
                                  background: 'var(--bg-subtle)',
                                  color: 'var(--text-3)',
                                }}
                              >
                                {parentDir}
                              </span>
                            )}
                          </div>
                          {timeStr && (
                            <span className="text-[11px] shrink-0" style={{ color: 'var(--text-3)' }}>
                              {timeStr}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {review.personal.docs.length > DOCS_PREVIEW_LIMIT && (
                    <button
                      type="button"
                      onClick={() => setShowAllDocs((v) => !v)}
                      className="w-full py-1.5 rounded-[8px] text-[12px] font-medium hover:bg-[var(--bg-subtle)] ap-ease"
                      style={{ color: 'var(--accent)' }}
                    >
                      {showAllDocs
                        ? t.revCollapseList
                        : t.revExpandAll(review.personal.docs.length)}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* 2.3 Period Notes Detail */}
          <div id="rev-sec-notes" className="ap-card p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[14.5px] font-semibold inline-flex items-center gap-1.5">
                <Lightbulb className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                {t.revNotesListTitle}
              </h3>
              <span
                className="ap-pill"
                style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
              >
                {review.personal.notes.length}
              </span>
            </div>
            {review.personal.notes.length === 0 ? (
              <p className="text-[13px] py-2" style={{ color: 'var(--text-3)' }}>
                {t.revNotesListEmpty}
              </p>
            ) : (
              <>
                <div className="ap-divide">
                  {visibleNotes.map((note) => {
                    const plain = markdownToPlainText(note.text).replace(/\s+/g, ' ').trim();
                    return (
                      <div key={note.id} className="py-2.5 first:pt-0 last:pb-0 space-y-1.5">
                        <p
                          className="text-[13px] leading-relaxed line-clamp-3"
                          style={{ color: 'var(--text-1)' }}
                        >
                          {plain || '—'}
                        </p>
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <div className="flex flex-wrap items-center gap-1">
                            {note.tags.map((tg) => (
                              <span
                                key={tg}
                                className="ap-pill text-[10.5px]"
                                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                              >
                                #{tg}
                              </span>
                            ))}
                          </div>
                          <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                            {formatClock(note.createdAt, config.lang, today)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {review.personal.notes.length > NOTES_PREVIEW_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setShowAllNotes((v) => !v)}
                    className="w-full py-1.5 rounded-[8px] text-[12px] font-medium hover:bg-[var(--bg-subtle)] ap-ease"
                    style={{ color: 'var(--accent)' }}
                  >
                    {showAllNotes
                      ? t.revCollapseList
                      : t.revExpandAll(review.personal.notes.length)}
                  </button>
                )}
              </>
            )}
          </div>
        </section>

        {/* Section 3: Pipeline & Distribution Analytics */}
        <section className="space-y-3.5">
          <h2
            className="text-[11px] font-semibold uppercase tracking-[0.06em]"
            style={{ color: 'var(--text-3)' }}
          >
            {t.reviewFlowSec}
          </h2>

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
                l: t.revDoneLabel,
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
                          className="h-full rounded-full ap-ease ap-progress-bar"
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
                    const proj = e.projectId !== '__none' ? projectMap.get(e.projectId) : null;
                    const colorMeta = proj ? getProjectColorMeta(proj) : null;
                    return (
                      <div key={e.projectId} className="flex items-center gap-3 text-[12.5px]">
                        <span
                          className="w-[116px] shrink-0 inline-flex items-center gap-1.5 truncate"
                          style={{ color: 'var(--text-2)' }}
                        >
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: colorMeta ? colorMeta.dot : 'var(--text-4)' }}
                          />
                          <span className="truncate">{e.name || t.noProject}</span>
                        </span>
                        <div
                          className="flex-1 h-2 rounded-full overflow-hidden"
                          style={{ background: 'var(--bg-subtle)' }}
                        >
                          <div
                            className="h-full rounded-full ap-ease ap-progress-bar"
                            style={{
                              width: `${Math.max(pct, 6)}%`,
                              background: colorMeta ? colorMeta.dot : 'var(--text-4)',
                            }}
                          />
                        </div>
                        <span className="w-16 text-right font-semibold shrink-0">
                          {e.count}
                          <span
                            className="ml-1 font-normal text-[11px]"
                            style={{ color: 'var(--text-3)' }}
                          >
                            {e.share}%
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Section 4: Current Blockers & Pending Confirmations */}
        <section className="space-y-3.5">
          <div className="flex items-center justify-between">
            <h2
              className="text-[11px] font-semibold uppercase tracking-[0.06em]"
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
                {review.blockers.confirmTasks.map((k) => {
                  const proj = k.projectId ? projectMap.get(k.projectId) : null;
                  const projColor = proj ? getProjectColorMeta(proj) : null;
                  return (
                    <div
                      key={`cfm-${k.id}`}
                      className="py-3 first:pt-0 last:pb-0 flex items-start gap-2.5"
                    >
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
                        {proj && projColor && (
                          <span
                            className="ap-pill"
                            style={{ background: projColor.soft, color: projColor.dot }}
                          >
                            {proj.name}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {review.blockers.overdueTasks.map((k) => {
                  const od = -dayDiff(today, k.due);
                  const proj = k.projectId ? projectMap.get(k.projectId) : null;
                  const projColor = proj ? getProjectColorMeta(proj) : null;
                  return (
                    <div
                      key={k.id}
                      className="py-3 first:pt-0 last:pb-0 flex items-start gap-2.5"
                    >
                      <AlertTriangle
                        className="w-4 h-4 shrink-0 mt-0.5"
                        style={{ color: 'var(--status-orange)' }}
                      />
                      <div className="text-[13.5px] flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{k.title}</span>
                        {proj && projColor && (
                          <span
                            className="ap-pill"
                            style={{ background: projColor.soft, color: projColor.dot }}
                          >
                            {proj.name}
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
    </div>
  );
}
