import { describe, expect, it } from 'vitest';
import { computeWeeklyReview, generateWeeklyMarkdown } from '../review';
import { createEmptyWorkspace } from '../merge';

describe('dual-dimension weekly review', () => {
  it('counts completed tasks strictly by doneAt (not createdAt) and aggregates team + blockers', () => {
    const ws = createEmptyWorkspace('2026-11-20'); // Friday, W47: 2026-11-16 .. 2026-11-22
    const lastWeekTs = new Date(2026, 10, 10, 10, 0).getTime(); // 2026-11-10
    const thisWeekThuTs = new Date(2026, 10, 19, 15, 0).getTime(); // 2026-11-19
    const thisWeekFriTs = new Date(2026, 10, 20, 11, 0).getTime(); // 2026-11-20

    ws.projects.push({
      id: 'p1',
      name: 'Growth Plan',
      status: 'blocked',
      stage: 'Draft',
      next: 'Sign off',
      blocker: 'Missing channel data',
      createdAt: lastWeekTs,
      updatedAt: thisWeekThuTs,
    });
    ws.members.push({
      id: 'm1',
      name: 'Li Ming',
      role: '后端组长',
      note: '',
      createdAt: lastWeekTs,
      updatedAt: lastWeekTs,
    });
    // Task created last week, finished this week -> MUST count in this week's review!
    ws.tasks.push({
      id: 't1',
      title: 'Finish conclusion page',
      note: '',
      prio: 1,
      due: '2026-11-19',
      done: true,
      doneAt: thisWeekThuTs,
      projectId: 'p1',
      rolls: 0,
      carriedDate: null,
      createdAt: lastWeekTs,
      updatedAt: thisWeekThuTs,
    });
    // Overdue task
    ws.tasks.push({
      id: 't2',
      title: 'Reply vendor',
      note: '',
      prio: 3,
      due: '2026-11-18',
      done: false,
      doneAt: null,
      projectId: '',
      rolls: 2,
      carriedDate: '2026-11-20',
      createdAt: lastWeekTs,
      updatedAt: thisWeekFriTs,
    });
    ws.daily.push(
      {
        id: 'd1',
        date: '2026-11-19',
        title: 'API load test',
        ownerId: 'm1',
        done: true,
        doneAt: thisWeekThuTs,
        carriedFromId: null,
        carriedToDate: null,
        carryCount: 0,
        createdAt: thisWeekThuTs,
        updatedAt: thisWeekThuTs,
      },
      {
        id: 'd2',
        date: '2026-11-20',
        title: 'Fix cache bug',
        ownerId: 'm1',
        done: false,
        doneAt: null,
        carriedFromId: null,
        carriedToDate: null,
        carryCount: 1,
        createdAt: thisWeekFriTs,
        updatedAt: thisWeekFriTs,
      },
    );
    ws.assignments.push({
      id: 'a1',
      title: 'Refactor order API',
      desc: '',
      ownerId: 'm1',
      projectId: 'p1',
      dueAt: '2026-11-19T18:00',
      status: 'blocked',
      doneAt: null,
      createdAt: lastWeekTs,
      updatedAt: thisWeekThuTs,
    });

    const rev = computeWeeklyReview(ws, '2026-11-20', 0, thisWeekFriTs);
    expect(rev.weekKey).toBe('2026-W47');
    expect(rev.personal.doneCount).toBe(1);
    expect(rev.personal.p1Share).toBe(100);
    expect(rev.personal.effortByProject[0]).toEqual({
      projectId: 'p1',
      name: 'Growth Plan',
      count: 1,
    });
    expect(rev.team.dailyTotal).toBe(2);
    expect(rev.team.dailyDone).toBe(1);
    expect(rev.team.dailyRate).toBe(50);
    expect(rev.team.dailyCarried).toBe(1);
    expect(rev.team.assignmentsBlockedNow).toBe(1);
    expect(rev.blockers.totalCount).toBe(3); // 1 blocked project + 1 overdue task + 1 blocked/overdue assignment

    const mdZh = generateWeeklyMarkdown(rev, ws, '2026-11-20', 'zh');
    expect(mdZh).toContain('2026-W47');
    expect(mdZh).toContain('Growth Plan');
    expect(mdZh).toContain('【项目卡住】');
    expect(mdZh).toContain('【团队派活阻塞】');

    const mdEn = generateWeeklyMarkdown(rev, ws, '2026-11-20', 'en');
    expect(mdEn).toContain('# Weekly Review (2026-W47');
    expect(mdEn).toContain('[Project Blocked] Growth Plan');
  });
});
