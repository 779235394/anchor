import { useMemo, useState } from 'react';
import {
  CalendarCheck2,
  Check,
  ChevronLeft,
  ChevronRight,
  Coffee,
  FastForward,
  Plus,
  Trash2,
} from 'lucide-react';
import { isActive, type DailyItem } from '@/domain/types';
import {
  formatClock,
  isWeekend,
  shiftDate,
  todayStr,
  weekdayLabel,
  weekStart,
} from '@/domain/date';
import { formatRole, getDict } from '@/i18n';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { CircularCheck } from '@/components/CircularCheck';
import { SegmentedControl } from '@/components/SegmentedControl';
import { InspectorDrawer } from '@/components/InspectorDrawer';
import { EmptyState } from '@/components/EmptyState';

export function DailyView() {
  const {
    config,
    data,
    inspector,
    openInspector,
    setView,
    addDaily,
    updateDaily,
    toggleDaily,
    deleteDaily,
  } = useWorkbenchStore();

  const t = getDict(config.lang);
  const today = todayStr();
  const weekend = isWeekend(today);

  const [tab, setTab] = useState<'today' | 'week'>('today');
  const [openOnly, setOpenOnly] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [quickTitle, setQuickTitle] = useState('');
  const [ownerId, setOwnerId] = useState('');

  const activeMembers = useMemo(
    () =>
      data.members
        .filter(isActive)
        .sort((a, b) => a.createdAt - b.createdAt),
    [data.members],
  );
  const activeDaily = useMemo(() => data.daily.filter(isActive), [data.daily]);

  const effectiveOwner = ownerId || activeMembers[0]?.id || '';

  const todayItems = useMemo(
    () => activeDaily.filter((d) => d.date === today),
    [activeDaily, today],
  );
  const todayStats = useMemo(
    () => ({
      total: todayItems.length,
      done: todayItems.filter((d) => d.done).length,
      carry: todayItems.filter((d) => d.carryCount > 0).length,
    }),
    [todayItems],
  );

  const selectedDaily =
    inspector?.kind === 'daily'
      ? activeDaily.find((d) => d.id === inspector.id) || null
      : null;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (weekend || !quickTitle.trim()) return;
    addDaily(quickTitle, effectiveOwner, today);
    setQuickTitle('');
  };

  // Grouped for Today view
  const todayGroups = useMemo(() => {
    const memberIds = new Set(activeMembers.map((m) => m.id));
    const groups: Array<{ id: string; name: string; role: string; items: DailyItem[] }> = [];
    for (const m of activeMembers) {
      const items = todayItems.filter((d) => d.ownerId === m.id);
      if (items.length) {
        groups.push({
          id: m.id,
          name: m.name,
          role: formatRole(m.role, config.lang),
          items,
        });
      }
    }
    const unowned = todayItems.filter((d) => !d.ownerId || !memberIds.has(d.ownerId));
    if (unowned.length) {
      groups.push({ id: '__none', name: t.unassigned, role: '', items: unowned });
    }
    return groups;
  }, [activeMembers, todayItems, config.lang, t.unassigned]);

  // Weekly matrix data (Mon–Fri)
  const ws = weekStart(today, weekOffset);
  const workDays = useMemo(() => [0, 1, 2, 3, 4].map((i) => shiftDate(ws, i)), [ws]);
  const weWork = workDays[4];

  const weekItems = useMemo(
    () => activeDaily.filter((d) => d.date >= ws && d.date <= weWork),
    [activeDaily, ws, weWork],
  );
  const weekStats = useMemo(() => {
    const total = weekItems.length;
    const done = weekItems.filter((d) => d.done).length;
    const carry = weekItems.filter((d) => d.carryCount > 0).length;
    const rate = total ? Math.round((done / total) * 100) : 0;
    return { total, done, carry, open: total - done, rate };
  }, [weekItems]);

  return (
    <div className="flex h-full min-w-0">
      <div className="flex-1 min-w-0 overflow-y-auto px-8 py-7">
        <div className="max-w-[960px] mx-auto space-y-5">
          {/* Header */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[24px] font-semibold tracking-[-0.025em] leading-tight">
                {t.dailyTitle}
              </h1>
              <p className="text-[13px] mt-1" style={{ color: 'var(--text-2)' }}>
                {tab === 'today'
                  ? weekend
                    ? t.dailyWeekendTitle
                    : t.dailySub(todayStats.total, todayStats.done, todayStats.carry)
                  : `${ws.replace(/-/g, '/')} — ${weWork.replace(/-/g, '/')} · ${t.dailyWeekMatrixHint}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <SegmentedControl<'today' | 'week'>
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'today', label: t.dailyTabToday },
                  { value: 'week', label: t.dailyTabWeek },
                ]}
              />
              {tab === 'week' && (
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
              )}
            </div>
          </div>

          {tab === 'today' ? (
            weekend ? (
              <div className="ap-card p-8 flex items-start gap-4">
                <Coffee className="w-7 h-7 shrink-0" style={{ color: 'var(--accent)' }} />
                <div>
                  <h2 className="text-[16px] font-semibold">{t.dailyWeekendTitle}</h2>
                  <p className="text-[13.5px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-2)' }}>
                    {t.dailyWeekendDesc}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {todayStats.carry > 0 && (
                  <div
                    className="px-4 py-3 rounded-[12px] flex items-center gap-2.5 text-[13px]"
                    style={{
                      background: 'var(--status-orange-soft)',
                      color: 'var(--status-orange)',
                    }}
                  >
                    <FastForward className="w-4 h-4 shrink-0" />
                    <span className="font-medium">{t.dailyCarryBanner(todayStats.carry)}</span>
                  </div>
                )}

                {/* Quick Capture */}
                <form
                  onSubmit={handleAdd}
                  className="ap-card px-3.5 py-2.5 flex flex-wrap items-center gap-2.5"
                >
                  <input
                    id="quick-capture-input"
                    type="text"
                    value={quickTitle}
                    onChange={(e) => setQuickTitle(e.target.value)}
                    placeholder={t.dailyQuickPh}
                    maxLength={120}
                    className="flex-1 min-w-[200px] bg-transparent border-0 outline-none text-[14px]"
                  />
                  <select
                    value={effectiveOwner}
                    onChange={(e) => setOwnerId(e.target.value)}
                    className="ap-input py-1.5 text-[12.5px] w-[170px]"
                  >
                    {activeMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} · {formatRole(m.role, config.lang)}
                      </option>
                    ))}
                    <option value="">{t.unassigned}</option>
                  </select>
                  <button type="submit" className="ap-btn ap-btn-primary ap-btn-sm">
                    <Plus className="w-3.5 h-3.5" />
                    {t.add}
                  </button>
                </form>

                {activeMembers.length === 0 && (
                  <div className="ap-card p-5 flex items-center justify-between gap-4">
                    <span className="text-[13.5px]" style={{ color: 'var(--text-2)' }}>
                      {t.dailyNoMembers}
                    </span>
                    <button
                      type="button"
                      onClick={() => setView('members')}
                      className="ap-btn ap-btn-primary ap-btn-sm"
                    >
                      {t.goMembers}
                    </button>
                  </div>
                )}

                {/* Today List Grouped by Member */}
                <div className="ap-card overflow-hidden">
                  <div
                    className="px-4 py-3 flex items-center justify-between"
                    style={{ borderBottom: '1px solid var(--hairline-soft)' }}
                  >
                    <span className="text-[13px] font-semibold">
                      {t.dailyTabToday} ({todayStats.done}/{todayStats.total})
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpenOnly((v) => !v)}
                      className="ap-pill ap-ease"
                      style={{
                        background: openOnly ? 'var(--accent)' : 'var(--bg-subtle)',
                        color: openOnly ? '#fff' : 'var(--text-2)',
                      }}
                    >
                      {t.dailyOpenOnly}
                    </button>
                  </div>

                  {todayGroups.length === 0 ? (
                    <EmptyState
                      icon={<CalendarCheck2 className="w-8 h-8" strokeWidth={1.5} />}
                      title={t.dailyEmpty}
                    />
                  ) : (
                    <div className="ap-divide">
                      {todayGroups.map((g) => {
                        const visible = openOnly ? g.items.filter((x) => !x.done) : g.items;
                        if (!visible.length) return null;
                        const gDone = g.items.filter((x) => x.done).length;
                        return (
                          <div key={g.id} className="px-4 py-3 space-y-1">
                            <div className="flex items-center justify-between pb-1.5">
                              <div className="flex items-center gap-2">
                                <span className="text-[13.5px] font-semibold">{g.name}</span>
                                {g.role && (
                                  <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                                    {g.role}
                                  </span>
                                )}
                              </div>
                              <span
                                className="ap-pill"
                                style={{
                                  background:
                                    gDone === g.items.length
                                      ? 'var(--status-green-soft)'
                                      : 'var(--bg-subtle)',
                                  color:
                                    gDone === g.items.length
                                      ? 'var(--status-green)'
                                      : 'var(--text-3)',
                                }}
                              >
                                {gDone}/{g.items.length}
                              </span>
                            </div>

                            {visible.map((item) => {
                              const sel = selectedDaily?.id === item.id;
                              return (
                                <div
                                  key={item.id}
                                  onClick={() => openInspector({ kind: 'daily', id: item.id })}
                                  className="flex items-center gap-3 px-2.5 py-2 -mx-2.5 rounded-[9px] cursor-pointer ap-ease"
                                  style={{
                                    background: sel ? 'var(--accent-soft)' : 'transparent',
                                  }}
                                >
                                  <CircularCheck
                                    checked={item.done}
                                    color="var(--accent)"
                                    size={19}
                                    onChange={() => toggleDaily(item.id)}
                                  />
                                  <span
                                    className="flex-1 text-[13.5px] break-words"
                                    style={{
                                      color: item.done ? 'var(--text-3)' : 'var(--text-1)',
                                      textDecoration: item.done ? 'line-through' : 'none',
                                    }}
                                  >
                                    {item.title}
                                  </span>
                                  {item.carryCount > 0 && (
                                    <span
                                      className="ap-pill"
                                      style={{
                                        background: 'var(--status-orange-soft)',
                                        color: 'var(--status-orange)',
                                      }}
                                    >
                                      {t.dailyCarryBadge(item.carryCount)}
                                    </span>
                                  )}
                                  {item.done && item.doneAt && (
                                    <span
                                      className="text-[11.5px]"
                                      style={{ color: 'var(--text-3)' }}
                                    >
                                      {formatClock(item.doneAt, config.lang, today)}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )
          ) : (
            /* Weekly Summary Matrix */
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { n: weekStats.total, l: t.statTotal },
                  { n: weekStats.done, l: t.done },
                  { n: `${weekStats.rate}%`, l: t.revRate },
                  { n: weekStats.carry, l: t.revDailyCarry },
                  { n: weekStats.open, l: t.statOpen, red: weekStats.open > 0 },
                ].map((k) => (
                  <div key={k.l} className="ap-card px-4 py-3.5">
                    <div
                      className="text-[24px] font-semibold tracking-[-0.03em] leading-none"
                      style={{ color: k.red ? 'var(--status-red)' : 'var(--text-1)' }}
                    >
                      {k.n}
                    </div>
                    <div className="text-[12px] mt-1.5" style={{ color: 'var(--text-3)' }}>
                      {k.l}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeMembers.map((m) => {
                  const mItems = weekItems.filter((x) => x.ownerId === m.id);
                  const mDone = mItems.filter((x) => x.done).length;
                  return (
                    <div key={m.id} className="ap-card overflow-hidden">
                      <div
                        className="px-4 py-3 flex items-center justify-between"
                        style={{ borderBottom: '1px solid var(--hairline-soft)' }}
                      >
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-7 h-7 rounded-[8px] flex items-center justify-center text-white text-[12px] font-semibold"
                            style={{ background: 'var(--accent)' }}
                          >
                            {m.name.slice(0, 1)}
                          </div>
                          <div>
                            <div className="text-[13.5px] font-semibold leading-tight">
                              {m.name}
                            </div>
                            <div className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                              {formatRole(m.role, config.lang)}
                            </div>
                          </div>
                        </div>
                        <span
                          className="ap-pill"
                          style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
                        >
                          {mDone}/{mItems.length}
                        </span>
                      </div>

                      <div className="px-4 py-2 ap-divide">
                        {workDays.map((day) => {
                          const dArr = mItems.filter((x) => x.date === day);
                          return (
                            <div key={day} className="py-2 flex gap-3 text-[12.5px]">
                              <div className="w-[52px] shrink-0" style={{ color: 'var(--text-3)' }}>
                                <div className="font-semibold">
                                  {weekdayLabel(day, config.lang)}
                                </div>
                                <div className="text-[11px]">{day.slice(5).replace('-', '/')}</div>
                              </div>
                              <div className="flex-1 min-w-0 space-y-1">
                                {dArr.length === 0 ? (
                                  <span style={{ color: 'var(--text-4)' }}>—</span>
                                ) : (
                                  dArr.map((x) => (
                                    <div
                                      key={x.id}
                                      className="flex items-start gap-1.5 leading-snug"
                                      style={{
                                        color: x.done ? 'var(--text-3)' : 'var(--text-1)',
                                        textDecoration: x.done ? 'line-through' : 'none',
                                      }}
                                    >
                                      {x.done && (
                                        <Check
                                          className="w-3.5 h-3.5 mt-0.5 shrink-0"
                                          style={{ color: 'var(--status-green)' }}
                                        />
                                      )}
                                      <span className="flex-1 break-words">{x.title}</span>
                                      {x.carryCount > 0 && (
                                        <span
                                          className="text-[10.5px] px-1.5 rounded-full shrink-0"
                                          style={{
                                            background: 'var(--status-orange-soft)',
                                            color: 'var(--status-orange)',
                                          }}
                                        >
                                          {config.lang === 'zh' ? '承接' : 'Carried'}
                                        </span>
                                      )}
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right Daily Inspector */}
      {selectedDaily && (
        <InspectorDrawer
          title={t.inspector}
          onClose={() => openInspector(null)}
          footer={
            <button
              type="button"
              onClick={() => deleteDaily(selectedDaily.id)}
              className="ap-btn ap-btn-danger w-full"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t.delete}
            </button>
          }
        >
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.taskTitleLabel}
            </label>
            <textarea
              rows={3}
              value={selectedDaily.title}
              onChange={(e) => updateDaily(selectedDaily.id, { title: e.target.value })}
              className="ap-input w-full resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.assignOwnerLabel}
            </label>
            <select
              value={selectedDaily.ownerId}
              onChange={(e) => updateDaily(selectedDaily.id, { ownerId: e.target.value })}
              className="ap-input w-full"
            >
              <option value="">{t.unassigned}</option>
              {activeMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {formatRole(m.role, config.lang)}
                </option>
              ))}
            </select>
          </div>
        </InspectorDrawer>
      )}
    </div>
  );
}
