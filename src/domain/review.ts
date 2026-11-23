import {
  isActive,
  type Lang,
  type Priority,
  type Task,
  type TaskStatus,
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
    flowCounts: Record<TaskStatus, number>;
  };
  blockers: {
    overdueTasks: Task[];
    confirmTasks: Task[];
    totalCount: number;
  };
}

export function computeWeeklyReview(
  data: WorkspaceData,
  today: string,
  weekOffset = 0,
): ReviewSnapshot {
  const ws = weekStart(today, weekOffset);
  const we = shiftDate(ws, 6);
  const weekKey = isoWeekKey(ws);

  const inWeek = (ts: number | null | undefined): boolean => {
    if (!ts) return false;
    const d = formatDate(new Date(ts));
    return d >= ws && d <= we;
  };

  const activeTasks = data.tasks.filter(isActive);
  const activeProjects = data.projects.filter(isActive);
  const activeNotes = data.notes.filter(isActive);

  const projNameMap = new Map(activeProjects.map((p) => [p.id, p.name]));

  // Personal metrics (strictly by `doneAt`)
  const doneTasks = activeTasks.filter((t) => (t.done || t.status === 'done') && inWeek(t.doneAt));
  const createdCount = activeTasks.filter((t) => inWeek(t.createdAt)).length;
  const notesCount = activeNotes.filter((n) => inWeek(n.createdAt)).length;

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
    }));

  const completionRate =
    doneTasks.length === 0
      ? 0
      : createdCount === 0
        ? 100
        : Math.round((doneTasks.length / Math.max(createdCount, doneTasks.length)) * 100);

  const p1Share = doneTasks.length ? Math.round((prioDist[1] / doneTasks.length) * 100) : 0;

  // Personal follow-ups & overdue risks
  const overdueTasks = activeTasks
    .filter((t) => !t.done && t.status !== 'done' && t.due && t.due < today)
    .sort((a, b) => (a.due > b.due ? 1 : -1) || a.prio - b.prio);
  const confirmTasks = activeTasks
    .filter((t) => t.status === 'confirm' && !t.done)
    .sort((a, b) => a.prio - b.prio || b.updatedAt - a.updatedAt);

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
      flowCounts,
    },
    blockers: {
      overdueTasks,
      confirmTasks,
      totalCount: overdueTasks.length + confirmTasks.length,
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
  const projName = (id: string) => activeProjects.find((p) => p.id === id)?.name || '';

  if (lang === 'en') {
    const lines: string[] = [
      `# Weekly Review (${review.weekKey}: ${review.weekStart} — ${review.weekEnd})`,
      '',
      '## 1. Productivity Overview',
      `- Tasks completed: **${review.personal.doneCount}** (created: ${review.personal.createdCount}, completion rate: ${review.personal.completionRate}%)`,
      `- Quick notes captured: **${review.personal.notesCount}**`,
      `- Current pipeline: Todo ${review.personal.flowCounts.todo} / In Progress ${review.personal.flowCounts.doing} / Pending Confirm ${review.personal.flowCounts.confirm}`,
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

    lines.push('', `## 2. Attention & Follow-ups (${review.blockers.totalCount})`);
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
    `# 每周复盘报告（${review.weekKey}：${review.weekStart} — ${review.weekEnd}）`,
    '',
    '## 一、个人推进概览',
    `- 完成待办：**${review.personal.doneCount}** 件（新建 ${review.personal.createdCount} 件，完成率 ${review.personal.completionRate}%）`,
    `- 记下灵感：**${review.personal.notesCount}** 条`,
    `- 当前流转状态：待办 ${review.personal.flowCounts.todo} 件 / 进行中 ${review.personal.flowCounts.doing} 件 / 待确认 ${review.personal.flowCounts.confirm} 件`,
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

  lines.push('', `## 二、待跟进与逾期汇总（共 ${review.blockers.totalCount} 项）`);
  if (review.blockers.totalCount === 0) {
    lines.push('- 本周没有待确认或逾期事项，推进顺畅。');
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
