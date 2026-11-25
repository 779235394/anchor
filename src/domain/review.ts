import {
  isActive,
  type Lang,
  type Note,
  type Priority,
  type Task,
  type TaskStatus,
  type WorkspaceData,
} from './types';
import {
  dayDiff,
  formatDate,
  isoWeekKey,
  parseLocalDate,
  shiftDate,
  shiftMonth,
  shiftYear,
  weekStart,
  weekdayLabel,
} from './date';
import { getBaseName, getParentRelPath, stripMdExtension, type DocEntry } from './docs';
import { markdownToPlainText } from './markdown';

export type ReviewGranularity = 'day' | 'week' | 'month' | 'year' | 'custom';

export interface ReviewPeriod {
  granularity: ReviewGranularity;
  startDate: string;
  endDate: string;
  periodKey: string;
  label: string;
  daySpan: number;
}

export interface ProjectEffortItem {
  projectId: string;
  name: string;
  count: number;
  share: number;
}

export interface ReviewSnapshot {
  period: ReviewPeriod;
  /** Backwards-compatible aliases pointing to `period.startDate / endDate / periodKey`. */
  weekStart: string;
  weekEnd: string;
  weekKey: string;
  personal: {
    doneCount: number;
    createdCount: number;
    completionRate: number;
    notesCount: number;
    docsCount: number;
    bestDay: { date: string; count: number } | null;
    prioDist: Record<Priority, number>;
    p1Share: number;
    effortByProject: ProjectEffortItem[];
    doneTasks: Task[];
    createdTasks: Task[];
    notes: Note[];
    docs: DocEntry[];
    flowCounts: Record<TaskStatus, number>;
  };
  blockers: {
    overdueTasks: Task[];
    confirmTasks: Task[];
    totalCount: number;
  };
}

function isValidYmd(raw: string | undefined): raw is string {
  return !!raw && /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

function isGeneratedReviewDoc(relPath: string): boolean {
  return relPath.startsWith('复盘/') || relPath.startsWith('Reviews/');
}

export function resolveReviewPeriod(params: {
  granularity: ReviewGranularity;
  today: string;
  offset?: number;
  customStart?: string;
  customEnd?: string;
  lang?: Lang;
}): ReviewPeriod {
  const { granularity, today, offset = 0, customStart, customEnd, lang = 'zh' } = params;
  const zh = lang !== 'en';

  if (granularity === 'day') {
    const d = shiftDate(today, offset);
    return {
      granularity,
      startDate: d,
      endDate: d,
      periodKey: d,
      label: `${d.replace(/-/g, '/')} · ${weekdayLabel(d, lang)}`,
      daySpan: 1,
    };
  }

  if (granularity === 'month') {
    const { start, end } = shiftMonth(today, offset);
    const parsed = parseLocalDate(start);
    const y = parsed.getFullYear();
    const m = parsed.getMonth() + 1;
    const mm = String(m).padStart(2, '0');
    return {
      granularity,
      startDate: start,
      endDate: end,
      periodKey: `${y}-${mm}`,
      label: zh ? `${y}年${m}月` : `${y}-${mm}`,
      daySpan: dayDiff(start, end) + 1,
    };
  }

  if (granularity === 'year') {
    const { start, end } = shiftYear(today, offset);
    const y = start.slice(0, 4);
    return {
      granularity,
      startDate: start,
      endDate: end,
      periodKey: y,
      label: zh ? `${y}年` : y,
      daySpan: dayDiff(start, end) + 1,
    };
  }

  if (granularity === 'custom') {
    let s = isValidYmd(customStart) ? customStart : shiftDate(today, -6);
    let e = isValidYmd(customEnd) ? customEnd : today;
    if (s > e) {
      [s, e] = [e, s];
    }
    return {
      granularity,
      startDate: s,
      endDate: e,
      periodKey: s === e ? s : `${s}_to_${e}`,
      label: zh ? '自定义范围' : 'Custom Range',
      daySpan: dayDiff(s, e) + 1,
    };
  }

  // Default: ISO natural week (Mon-Sun)
  const ws = weekStart(today, offset);
  const we = shiftDate(ws, 6);
  const wk = isoWeekKey(ws);
  return {
    granularity: 'week',
    startDate: ws,
    endDate: we,
    periodKey: wk,
    label: wk,
    daySpan: 7,
  };
}

export function computeReview(
  data: WorkspaceData,
  period: ReviewPeriod,
  today: string,
  docEntries: DocEntry[] = [],
): ReviewSnapshot {
  const { startDate, endDate, periodKey } = period;

  const inRange = (ts: number | null | undefined): boolean => {
    if (!ts) return false;
    const d = formatDate(new Date(ts));
    return d >= startDate && d <= endDate;
  };

  const activeTasks = data.tasks.filter(isActive);
  const activeProjects = data.projects.filter(isActive);
  const activeNotes = data.notes.filter(isActive);

  const projNameMap = new Map(activeProjects.map((p) => [p.id, p.name]));

  // Personal metrics (strictly by `doneAt` / `createdAt` / `updatedAt` within [startDate, endDate])
  const doneTasks = activeTasks
    .filter((t) => (t.done || t.status === 'done') && inRange(t.doneAt))
    .sort((a, b) => (b.doneAt || b.updatedAt) - (a.doneAt || a.updatedAt));
  const createdTasks = activeTasks
    .filter((t) => inRange(t.createdAt))
    .sort((a, b) => b.createdAt - a.createdAt);
  const notes = activeNotes
    .filter((n) => inRange(n.createdAt))
    .sort((a, b) => b.createdAt - a.createdAt);
  const docs = docEntries
    .filter((e) => !e.isDir && !isGeneratedReviewDoc(e.relPath) && inRange(e.updatedAt))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const prioDist: Record<Priority, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const flowCounts: Record<TaskStatus, number> = {
    todo: 0,
    doing: 0,
    confirm: 0,
    done: doneTasks.length,
  };
  const dayCounts = new Map<string, number>();
  const projCounts = new Map<string, number>();

  for (const t of activeTasks) {
    const st: TaskStatus = t.status || (t.done ? 'done' : 'todo');
    if (st !== 'done') {
      flowCounts[st] += 1;
    }
  }

  for (const t of doneTasks) {
    prioDist[t.prio] = (prioDist[t.prio] || 0) + 1;
    if (t.doneAt) {
      const d = formatDate(new Date(t.doneAt));
      dayCounts.set(d, (dayCounts.get(d) || 0) + 1);
    }
    const key = t.projectId && projNameMap.has(t.projectId) ? t.projectId : '__none';
    projCounts.set(key, (projCounts.get(key) || 0) + 1);
  }

  let bestDay: { date: string; count: number } | null = null;
  for (const [date, count] of dayCounts.entries()) {
    if (!bestDay || count > bestDay.count || (count === bestDay.count && date > bestDay.date)) {
      bestDay = { date, count };
    }
  }

  const effortByProject: ProjectEffortItem[] = [...projCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([projectId, count]) => ({
      projectId,
      name: projectId === '__none' ? '' : projNameMap.get(projectId) || '',
      count,
      share: doneTasks.length ? Math.round((count / doneTasks.length) * 100) : 0,
    }));

  const completionRate =
    doneTasks.length === 0
      ? 0
      : createdTasks.length === 0
        ? 100
        : Math.round((doneTasks.length / Math.max(createdTasks.length, doneTasks.length)) * 100);

  const p1Share = doneTasks.length ? Math.round((prioDist[1] / doneTasks.length) * 100) : 0;

  // Current real-time follow-ups & overdue risks
  const overdueTasks = activeTasks
    .filter((t) => !t.done && t.status !== 'done' && t.due && t.due < today)
    .sort((a, b) => (a.due > b.due ? 1 : -1) || a.prio - b.prio);
  const confirmTasks = activeTasks
    .filter((t) => t.status === 'confirm' && !t.done)
    .sort((a, b) => a.prio - b.prio || b.updatedAt - a.updatedAt);

  return {
    period,
    weekStart: startDate,
    weekEnd: endDate,
    weekKey: periodKey,
    personal: {
      doneCount: doneTasks.length,
      createdCount: createdTasks.length,
      completionRate,
      notesCount: notes.length,
      docsCount: docs.length,
      bestDay,
      prioDist,
      p1Share,
      effortByProject,
      doneTasks,
      createdTasks,
      notes,
      docs,
      flowCounts,
    },
    blockers: {
      overdueTasks,
      confirmTasks,
      totalCount: overdueTasks.length + confirmTasks.length,
    },
  };
}

export function computeWeeklyReview(
  data: WorkspaceData,
  today: string,
  weekOffset = 0,
  docEntries: DocEntry[] = [],
): ReviewSnapshot {
  const period = resolveReviewPeriod({ granularity: 'week', today, offset: weekOffset });
  return computeReview(data, period, today, docEntries);
}

function formatMdTimestamp(ts: number, dayOnly = false): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  if (dayOnly) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusTag(status: TaskStatus, lang: Lang): string {
  if (lang === 'en') {
    if (status === 'doing') return 'In Progress';
    if (status === 'confirm') return 'Pending Confirm';
    if (status === 'done') return 'Done';
    return 'Todo';
  }
  if (status === 'doing') return '进行中';
  if (status === 'confirm') return '待确认';
  if (status === 'done') return '已完成';
  return '待办';
}

function formatReportHeading(period: ReviewPeriod, lang: Lang): string {
  const { granularity, startDate, endDate, label, daySpan } = period;
  if (lang === 'en') {
    if (granularity === 'day') return `# Daily Review (${startDate})`;
    if (granularity === 'week') return `# Weekly Review (${label}: ${startDate} — ${endDate})`;
    if (granularity === 'month') return `# Monthly Review (${label}: ${startDate} — ${endDate})`;
    if (granularity === 'year') return `# Yearly Review (${label}: ${startDate} — ${endDate})`;
    return `# Review Report (${startDate} — ${endDate}, ${daySpan}d)`;
  }
  if (granularity === 'day') return `# 日复盘报告（${startDate}）`;
  if (granularity === 'week') return `# 周复盘报告（${label}：${startDate} — ${endDate}）`;
  if (granularity === 'month') return `# 月复盘报告（${label}：${startDate} — ${endDate}）`;
  if (granularity === 'year') return `# 年复盘报告（${label}：${startDate} — ${endDate}）`;
  return `# 复盘报告（${startDate} — ${endDate}，共 ${daySpan} 天）`;
}

export function generateReviewMarkdown(
  review: ReviewSnapshot,
  data: WorkspaceData,
  today: string,
  lang: Lang,
): string {
  const activeProjects = data.projects.filter(isActive);
  const projName = (id: string) => activeProjects.find((p) => p.id === id)?.name || '';
  const notesAsc = [...review.personal.notes].sort((a, b) => a.createdAt - b.createdAt);
  const isSingleDay = review.period.daySpan === 1;

  if (lang === 'en') {
    const lines: string[] = [
      formatReportHeading(review.period, 'en'),
      '',
      '## 1. Productivity Overview',
      `- Tasks completed: **${review.personal.doneCount}** (created: ${review.personal.createdCount}, completion rate: ${review.personal.completionRate}%)`,
      `- Knowledge Base docs updated: **${review.personal.docsCount}**`,
      `- Quick notes captured: **${review.personal.notesCount}**`,
      `- Current pipeline: Todo ${review.personal.flowCounts.todo} / In Progress ${review.personal.flowCounts.doing} / Pending Confirm ${review.personal.flowCounts.confirm}`,
      `- Priority mix: P1 ${review.personal.prioDist[1]} / P2 ${review.personal.prioDist[2]} / P3 ${review.personal.prioDist[3]} / P4 ${review.personal.prioDist[4]} (P1 share ${review.personal.p1Share}%)`,
    ];
    if (!isSingleDay && review.personal.bestDay) {
      lines.push(
        `- Most productive day: **${review.personal.bestDay.date}** (${review.personal.bestDay.count} tasks)`,
      );
    }

    if (review.personal.effortByProject.length > 0) {
      lines.push('', '## 2. Effort by Project');
      for (const item of review.personal.effortByProject) {
        const label = item.name || 'Uncategorized';
        lines.push(`- **${label}**: ${item.count} (${item.share}%)`);
      }
    }

    lines.push('', `## 3. Completed Tasks (${review.personal.doneTasks.length})`);
    if (review.personal.doneTasks.length === 0) {
      lines.push('- None');
    } else {
      for (const t of review.personal.doneTasks) {
        const pn = t.projectId && projName(t.projectId) ? ` [${projName(t.projectId)}]` : '';
        const dt = t.doneAt ? ` (${formatMdTimestamp(t.doneAt, isSingleDay)})` : '';
        lines.push(`- **(P${t.prio})** ${t.title}${pn}${dt}`);
      }
    }

    if (review.personal.createdTasks.length > 0) {
      lines.push('', `## 4. Newly Created Tasks (${review.personal.createdTasks.length})`);
      for (const t of review.personal.createdTasks) {
        const st: TaskStatus = t.status || (t.done ? 'done' : 'todo');
        const pn = t.projectId && projName(t.projectId) ? ` [${projName(t.projectId)}]` : '';
        lines.push(`- **[${statusTag(st, 'en')}]** (P${t.prio}) ${t.title}${pn}`);
      }
    }

    if (review.personal.docs.length > 0) {
      lines.push('', `## 5. Knowledge Base Docs (${review.personal.docs.length})`);
      for (const d of review.personal.docs) {
        const title = stripMdExtension(getBaseName(d.relPath));
        const parent = getParentRelPath(d.relPath);
        const dirHint = parent ? ` · \`${parent}\`` : '';
        const ts = formatMdTimestamp(d.updatedAt, isSingleDay);
        lines.push(`- **${title}**${dirHint} (${ts})`);
      }
    }

    if (notesAsc.length > 0) {
      lines.push('', `## 6. Notes Captured (${notesAsc.length})`);
      for (const n of notesAsc) {
        const plain = markdownToPlainText(n.text).replace(/\s+/g, ' ').trim();
        if (!plain) continue;
        const ts = formatMdTimestamp(n.createdAt, isSingleDay);
        const tags = n.tags.length ? ` ${n.tags.map((tg) => `\`#${tg}\``).join(' ')}` : '';
        lines.push(`- **${ts}**${tags}: ${plain}`);
      }
    }

    lines.push('', `## 7. Current Follow-ups & Overdue (${review.blockers.totalCount})`);
    if (review.blockers.totalCount === 0) {
      lines.push('- No pending confirmations or overdue items.');
    } else {
      for (const t of review.blockers.confirmTasks) {
        lines.push(`- **[Pending Confirm] ${t.title}**`);
      }
      for (const t of review.blockers.overdueTasks) {
        const od = -dayDiff(today, t.due);
        const rolls = t.rolls ? ` (postponed ${t.rolls}×)` : '';
        lines.push(`- **[Overdue ${od}d] ${t.title}**${rolls}`);
      }
    }
    return lines.join('\n') + '\n';
  }

  const lines: string[] = [
    formatReportHeading(review.period, 'zh'),
    '',
    '## 一、推进概览',
    `- 完成待办：**${review.personal.doneCount}** 件（新建 ${review.personal.createdCount} 件，完成率 ${review.personal.completionRate}%）`,
    `- 知识库记录：**${review.personal.docsCount}** 篇`,
    `- 记下灵感：**${review.personal.notesCount}** 条`,
    `- 当前流转状态：待办 ${review.personal.flowCounts.todo} 件 / 进行中 ${review.personal.flowCounts.doing} 件 / 待确认 ${review.personal.flowCounts.confirm} 件`,
    `- 优先级分布：P1 ${review.personal.prioDist[1]} 件 / P2 ${review.personal.prioDist[2]} 件 / P3 ${review.personal.prioDist[3]} 件 / P4 ${review.personal.prioDist[4]} 件（P1 占比 ${review.personal.p1Share}%）`,
  ];
  if (!isSingleDay && review.personal.bestDay) {
    lines.push(
      `- 效率最高的一天：**${review.personal.bestDay.date}**（完成 ${review.personal.bestDay.count} 件）`,
    );
  }

  if (review.personal.effortByProject.length > 0) {
    lines.push('', '## 二、项目精力归集');
    for (const item of review.personal.effortByProject) {
      const label = item.name || '未归类';
      lines.push(`- **${label}**：${item.count} 件（${item.share}%）`);
    }
  }

  lines.push('', `## 三、已完成待办（${review.personal.doneTasks.length}）`);
  if (review.personal.doneTasks.length === 0) {
    lines.push('- 暂无');
  } else {
    for (const t of review.personal.doneTasks) {
      const pn = t.projectId && projName(t.projectId) ? ` [${projName(t.projectId)}]` : '';
      const dt = t.doneAt ? `（${formatMdTimestamp(t.doneAt, isSingleDay)}）` : '';
      lines.push(`- **(P${t.prio})** ${t.title}${pn}${dt}`);
    }
  }

  if (review.personal.createdTasks.length > 0) {
    lines.push('', `## 四、本周期新建待办（${review.personal.createdTasks.length}）`);
    for (const t of review.personal.createdTasks) {
      const st: TaskStatus = t.status || (t.done ? 'done' : 'todo');
      const pn = t.projectId && projName(t.projectId) ? ` [${projName(t.projectId)}]` : '';
      lines.push(`- **【${statusTag(st, 'zh')}】** (P${t.prio}) ${t.title}${pn}`);
    }
  }

  if (review.personal.docs.length > 0) {
    lines.push('', `## 五、知识库文档记录（${review.personal.docs.length}）`);
    for (const d of review.personal.docs) {
      const title = stripMdExtension(getBaseName(d.relPath));
      const parent = getParentRelPath(d.relPath);
      const dirHint = parent ? ` · \`${parent}\`` : '';
      const ts = formatMdTimestamp(d.updatedAt, isSingleDay);
      lines.push(`- **${title}**${dirHint}（${ts}）`);
    }
  }

  if (notesAsc.length > 0) {
    lines.push('', `## 六、周期灵感记录（${notesAsc.length}）`);
    for (const n of notesAsc) {
      const plain = markdownToPlainText(n.text).replace(/\s+/g, ' ').trim();
      if (!plain) continue;
      const ts = formatMdTimestamp(n.createdAt, isSingleDay);
      const tags = n.tags.length ? ` ${n.tags.map((tg) => `\`#${tg}\``).join(' ')}` : '';
      lines.push(`- **${ts}**${tags}：${plain}`);
    }
  }

  lines.push('', `## 七、当前待跟进与逾期汇总（共 ${review.blockers.totalCount} 项）`);
  if (review.blockers.totalCount === 0) {
    lines.push('- 当前没有待确认或逾期事项，推进顺畅。');
  } else {
    for (const t of review.blockers.confirmTasks) {
      lines.push(`- **【待确认】${t.title}**`);
    }
    for (const t of review.blockers.overdueTasks) {
      const od = -dayDiff(today, t.due);
      const rolls = t.rolls ? `（已顺延 ${t.rolls} 次）` : '';
      lines.push(`- **【待办逾期 ${od} 天】${t.title}**${rolls}`);
    }
  }

  return lines.join('\n') + '\n';
}

export function resolveReviewDocTarget(
  period: ReviewPeriod,
  lang: Lang,
): { folderRelPath: string; baseTitle: string } {
  if (lang === 'en') {
    const subMap: Record<ReviewGranularity, string> = {
      day: 'Daily',
      week: 'Weekly',
      month: 'Monthly',
      year: 'Yearly',
      custom: 'Custom',
    };
    return {
      folderRelPath: `Reviews/${subMap[period.granularity]}`,
      baseTitle: period.periodKey,
    };
  }

  const subMap: Record<ReviewGranularity, string> = {
    day: '日复盘',
    week: '周复盘',
    month: '月复盘',
    year: '年复盘',
    custom: '自定义复盘',
  };
  return {
    folderRelPath: `复盘/${subMap[period.granularity]}`,
    baseTitle: period.periodKey,
  };
}

export function generateWeeklyMarkdown(
  review: ReviewSnapshot,
  data: WorkspaceData,
  today: string,
  lang: Lang,
): string {
  return generateReviewMarkdown(review, data, today, lang);
}
