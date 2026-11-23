import { describe, expect, it } from 'vitest';
import { computeWeeklyReview, generateWeeklyMarkdown } from '../review';
import { createEmptyWorkspace } from '../merge';

describe('personal weekly review', () => {
  it('counts completed tasks strictly by doneAt and summarizes pipeline + blockers without team data', () => {
    const ws = createEmptyWorkspace('2026-11-20'); // Friday, W47: 2026-11-16 .. 2026-11-22
    const lastWeekTs = new Date(2026, 10, 10, 10, 0).getTime(); // 2026-11-10
    const thisWeekThuTs = new Date(2026, 10, 19, 15, 0).getTime(); // 2026-11-19
    const thisWeekFriTs = new Date(2026, 10, 20, 11, 0).getTime(); // 2026-11-20

    ws.projects.push({
      id: 'p1',
      name: 'Growth Plan',
      color: 'indigo',
      createdAt: lastWeekTs,
      updatedAt: thisWeekThuTs,
    });
    // Task created last week, finished this week -> MUST count in this week's review!
    ws.tasks.push({
      id: 't1',
      title: 'Finish conclusion page',
      note: '',
      prio: 1,
      status: 'done',
      due: '2026-11-19',
      done: true,
      doneAt: thisWeekThuTs,
      projectId: 'p1',
      rolls: 0,
      carriedDate: null,
      attachments: [],
      createdAt: lastWeekTs,
      updatedAt: thisWeekThuTs,
    });
    // Overdue task
    ws.tasks.push({
      id: 't2',
      title: 'Reply vendor',
      note: '',
      prio: 3,
      status: 'doing',
      due: '2026-11-18',
      done: false,
      doneAt: null,
      projectId: '',
      rolls: 2,
      carriedDate: '2026-11-20',
      attachments: [],
      createdAt: lastWeekTs,
      updatedAt: thisWeekFriTs,
    });
    // Pending confirmation task
    ws.tasks.push({
      id: 't3',
      title: 'Confirm release notes',
      note: '',
      prio: 2,
      status: 'confirm',
      due: '2026-11-21',
      done: false,
      doneAt: null,
      projectId: 'p1',
      rolls: 0,
      carriedDate: null,
      attachments: [],
      createdAt: thisWeekThuTs,
      updatedAt: thisWeekFriTs,
    });

    const rev = computeWeeklyReview(ws, '2026-11-20', 0);
    expect(rev.weekKey).toBe('2026-W47');
    expect(rev.personal.doneCount).toBe(1);
    expect(rev.personal.p1Share).toBe(100);
    expect(rev.personal.flowCounts).toEqual({
      todo: 0,
      doing: 1,
      confirm: 1,
      done: 1,
    });
    expect(rev.personal.effortByProject[0]).toEqual({
      projectId: 'p1',
      name: 'Growth Plan',
      count: 1,
    });
    expect(rev.blockers.totalCount).toBe(2); // 1 overdue task + 1 confirm task

    const mdZh = generateWeeklyMarkdown(rev, ws, '2026-11-20', 'zh');
    expect(mdZh).toContain('2026-W47');
    expect(mdZh).toContain('Growth Plan');
    expect(mdZh).toContain('【待确认】');
    expect(mdZh).not.toContain('团队');

    const mdEn = generateWeeklyMarkdown(rev, ws, '2026-11-20', 'en');
    expect(mdEn).toContain('# Weekly Review (2026-W47');
    expect(mdEn).toContain('[Pending Confirm] Confirm release notes');
    expect(mdEn).not.toContain('Team');
  });
});
