import {
  isActive,
  type Assignment,
  type Lang,
  type Priority,
  type Project,
  type Task,
  type WorkspaceData,
} from './types';
import { dayDiff, formatDate, isoWeekKey, shiftDate, weekStart } from './date';

export interface ProjectEffortItem {
  projectId: string;
  name: string;
  count: number;
}

export interface ReviewSnapshot {
  weekStart: string;
  weekEnd: string;
  weekKey: string;
  personal: {
    doneCount: number;
    createdCount: number;
    completionRate: number;
    notesCount: number;
    bestDay: { date: string; count: number } | null;
    prioDist: Record<Priority, number>;
    p1Share: number;
    effortByProject: ProjectEffortItem[];
    doneTasks: Task[];
  };
  team: {
    dailyTotal: number;
    dailyDone: number;
    dailyCarried: number;
    dailyRate: number;
    assignmentsDoneWeek: number;
    assignmentsBlockedNow: number;
    assignmentsOverdueNow: number;
  };
  blockers: {
    blockedProjects: Project[];
    overdueTasks: Task[];
    blockedAssignments: Assignment[];
    overdueAssignments: Assignment[];
    totalCount: number;
  };
}

export function computeWeeklyReview(
  data: WorkspaceData,
  today: string,
  weekOffset = 0,
  nowTs: number = Date.now(),
): ReviewSnapshot {
  const ws = weekStart(today, weekOffset);
  const we = shiftDate(ws, 6);
  const workEnd = shiftDate(ws, 4);
  const weekKey = isoWeekKey(ws);

  const inWeek = (ts: number | null | undefined): boolean => {
    if (!ts) return false;
    const d = formatDate(new Date(ts));
    return d >= ws && d <= we;
  };

  const activeTasks = data.tasks.filter(isActive);
  const activeProjects = data.projects.filter(isActive);
  const activeNotes = data.notes.filter(isActive);
  const activeAssignments = data.assignments.filter(isActive);
  const activeDaily = data.daily.filter(isActive);

  const projNameMap = new Map(activeProjects.map((p) => [p.id, p.name]));

  // Personal metrics (strictly by `doneAt`, fixing original bug!)
  const doneTasks = activeTasks.filter((t) => t.done && inWeek(t.doneAt));
  const createdCount = activeTasks.filter((t) => inWeek(t.createdAt)).length;
  const notesCount = activeNotes.filter((n) => inWeek(n.createdAt)).length;

  const prioDist: Record<Priority, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const dayCounts = new Map<string, number>();
  const projCounts = new Map<string, number>();

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
    }));

  const completionRate =
    doneTasks.length === 0
      ? 0
      : createdCount === 0
        ? 100
        : Math.round((doneTasks.length / Math.max(createdCount, doneTasks.length)) * 100);

  const p1Share = doneTasks.length ? Math.round((prioDist[1] / doneTasks.length) * 100) : 0;

  // Team metrics
  const weekDaily = activeDaily.filter((d) => d.date >= ws && d.date <= workEnd);
  const dailyTotal = weekDaily.length;
  const dailyDone = weekDaily.filter((d) => d.done).length;
  const dailyCarried = weekDaily.filter((d) => d.carryCount > 0).length;
  const dailyRate = dailyTotal ? Math.round((dailyDone / dailyTotal) * 100) : 0;

  const assignmentsDoneWeek = activeAssignments.filter(
    (a) => a.status === 'done' && inWeek(a.doneAt),
  ).length;
  const blockedAssignments = activeAssignments.filter((a) => a.status === 'blocked');
  const overdueAssignments = activeAssignments.filter(
    (a) => a.status !== 'done' && a.dueAt && new Date(a.dueAt).getTime() < nowTs,
  );

  // Unified Blockers
  const blockedProjects = activeProjects.filter((p) => p.status === 'blocked');
  const overdueTasks = activeTasks
    .filter((t) => !t.done && t.due && t.due < today)
    .sort((a, b) => (a.due > b.due ? 1 : -1) || a.prio - b.prio);

  const uniqueAssignRisks = new Set([
    ...blockedAssignments.map((a) => a.id),
    ...overdueAssignments.map((a) => a.id),
  ]);

  return {
    weekStart: ws,
    weekEnd: we,
    weekKey,
    personal: {
      doneCount: doneTasks.length,
      createdCount,
      completionRate,
      notesCount,
      bestDay,
      prioDist,
      p1Share,
      effortByProject,
      doneTasks,
    },
    team: {
      dailyTotal,
      dailyDone,
      dailyCarried,
      dailyRate,
      assignmentsDoneWeek,
      assignmentsBlockedNow: blockedAssignments.length,
      assignmentsOverdueNow: overdueAssignments.length,
    },
    blockers: {
      blockedProjects,
      overdueTasks,
      blockedAssignments,
      overdueAssignments,
      totalCount: blockedProjects.length + overdueTasks.length + uniqueAssignRisks.size,
    },
  };
}

export function generateWeeklyMarkdown(
  review: ReviewSnapshot,
  data: WorkspaceData,
  today: string,
  lang: Lang,
): string {
  const activeProjects = data.projects.filter(isActive);
  const activeMembers = data.members.filter(isActive);
  const projName = (id: string) => activeProjects.find((p) => p.id === id)?.name || '';
  const memberName = (id: string) =>
    activeMembers.find((m) => m.id === id)?.name || (lang === 'zh' ? '未指派' : 'Unassigned');

  if (lang === 'en') {
    const lines: string[] = [
      `# Weekly Review (${review.weekKey}: ${review.weekStart} — ${review.weekEnd})`,
      '',
      '## 1. Personal Productivity',
      `- Tasks completed: **${review.personal.doneCount}** (created: ${review.personal.createdCount}, completion rate: ${review.personal.completionRate}%)`,
      `- Quick notes captured: **${review.personal.notesCount}**`,
      `- Priority mix: P1 ${review.personal.prioDist[1]} / P2 ${review.personal.prioDist[2]} / P3 ${review.personal.prioDist[3]} / P4 ${review.personal.prioDist[4]} (P1 share ${review.personal.p1Share}%)`,
    ];
    if (review.personal.bestDay) {
      lines.push(
        `- Most productive day: **${review.personal.bestDay.date}** (${review.personal.bestDay.count} tasks)`,
      );
    }
    if (review.personal.doneTasks.length) {
      lines.push('', '### Completed Tasks');
      for (const t of review.personal.doneTasks) {
        const pn = t.projectId ? ` [${projName(t.projectId)}]` : '';
        lines.push(`- [x] (P${t.prio}) ${t.title}${pn}`);
      }
    }

    lines.push(
      '',
      '## 2. Team Delivery',
      `- Daily standup items: **${review.team.dailyDone}/${review.team.dailyTotal}** (${review.team.dailyRate}%, carried over: ${review.team.dailyCarried})`,
      `- Assignments completed this week: **${review.team.assignmentsDoneWeek}**`,
      `- Active team risks: **${review.team.assignmentsBlockedNow}** blocked, **${review.team.assignmentsOverdueNow}** overdue`,
      '',
      `## 3. Blocker & Risk Summary (${review.blockers.totalCount})`,
    );

    if (review.blockers.totalCount === 0) {
      lines.push('- No blockers or overdue items.');
    } else {
      for (const p of review.blockers.blockedProjects) {
        lines.push(`- **[Project Blocked] ${p.name}**: ${p.blocker || 'No reason noted'} → Next: ${p.next || 'TBD'}`);
      }
      for (const t of review.blockers.overdueTasks) {
        const od = -dayDiff(today, t.due);
        const rolls = t.rolls ? ` (postponed ${t.rolls}×)` : '';
        lines.push(`- **[Task Overdue ${od}d] ${t.title}**${rolls}`);
      }
      for (const a of review.blockers.blockedAssignments) {
        lines.push(`- **[Assignment Blocked] ${a.title}** (${memberName(a.ownerId)})`);
      }
    }
    return lines.join('\n') + '\n';
  }

  const lines: string[] = [
    `# 每周复盘报告（${review.weekKey}：${review.weekStart} — ${review.weekEnd}）`,
    '',
    '## 一、个人效能概览',
    `- 完成待办：**${review.personal.doneCount}** 件（新建 ${review.personal.createdCount} 件，完成率 ${review.personal.completionRate}%）`,
    `- 记下灵感：**${review.personal.notesCount}** 条`,
    `- 优先级分布：P1 ${review.personal.prioDist[1]} 件 / P2 ${review.personal.prioDist[2]} 件 / P3 ${review.personal.prioDist[3]} 件 / P4 ${review.personal.prioDist[4]} 件（P1 占比 ${review.personal.p1Share}%）`,
  ];
  if (review.personal.bestDay) {
    lines.push(
      `- 效率最高的一天：**${review.personal.bestDay.date}**（完成 ${review.personal.bestDay.count} 件）`,
    );
  }
  if (review.personal.doneTasks.length) {
    lines.push('', '### 本周已完成任务');
    for (const t of review.personal.doneTasks) {
      const pn = t.projectId ? ` [${projName(t.projectId)}]` : '';
      lines.push(`- [x] (P${t.prio}) ${t.title}${pn}`);
    }
  }

  lines.push(
    '',
    '## 二、团队交付概览',
    `- 小组每日事项：**${review.team.dailyDone}/${review.team.dailyTotal}** 完成（完成率 ${review.team.dailyRate}%，承接项 ${review.team.dailyCarried} 条）`,
    `- 任务分配本周交付：**${review.team.assignmentsDoneWeek}** 项`,
    `- 团队当前风险：**${review.team.assignmentsBlockedNow}** 项阻塞，**${review.team.assignmentsOverdueNow}** 项逾期`,
    '',
    `## 三、卡点与风险汇总（共 ${review.blockers.totalCount} 项）`,
  );

  if (review.blockers.totalCount === 0) {
    lines.push('- 本周没有阻塞或逾期卡点，推进顺畅。');
  } else {
    for (const p of review.blockers.blockedProjects) {
      lines.push(`- **【项目卡住】${p.name}**：${p.blocker || '未填写原因'}（下一步：${p.next || '待明确'}）`);
    }
    for (const t of review.blockers.overdueTasks) {
      const od = -dayDiff(today, t.due);
      const rolls = t.rolls ? `（已顺延 ${t.rolls} 次）` : '';
      lines.push(`- **【个人待办逾期 ${od} 天】${t.title}**${rolls}`);
    }
    for (const a of review.blockers.blockedAssignments) {
      lines.push(`- **【团队派活阻塞】${a.title}**（负责人：${memberName(a.ownerId)}）`);
    }
  }

  return lines.join('\n') + '\n';
}
