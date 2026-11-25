import { describe, expect, it } from 'vitest';
import {
  computeReview,
  computeWeeklyReview,
  generateReviewMarkdown,
  generateWeeklyMarkdown,
  resolveReviewDocTarget,
  resolveReviewPeriod,
} from '../review';
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
      share: 100,
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

  it('supports day, month, year, and custom ranges (auto-normalizing reversed bounds) with notes in Markdown', () => {
    const ws = createEmptyWorkspace('2026-11-25');
    const octTs = new Date(2026, 9, 15, 10, 0).getTime(); // 2026-10-15
    const nov25Ts = new Date(2026, 10, 25, 16, 20).getTime(); // 2026-11-25

    ws.projects.push({
      id: 'p1',
      name: 'Anchor',
      color: 'teal',
      createdAt: octTs,
      updatedAt: nov25Ts,
    });
    ws.tasks.push(
      {
        id: 't-oct',
        title: 'Oct milestone',
        note: '',
        prio: 2,
        status: 'done',
        due: '2026-10-15',
        done: true,
        doneAt: octTs,
        projectId: 'p1',
        rolls: 0,
        carriedDate: null,
        attachments: [],
        createdAt: octTs,
        updatedAt: octTs,
      },
      {
        id: 't-nov',
        title: 'Ship multi-range review',
        note: '',
        prio: 1,
        status: 'done',
        due: '2026-11-25',
        done: true,
        doneAt: nov25Ts,
        projectId: 'p1',
        rolls: 0,
        carriedDate: null,
        attachments: [],
        createdAt: nov25Ts,
        updatedAt: nov25Ts,
      },
    );
    ws.notes.push({
      id: 'n1',
      text: '总结 **多维度复盘** 的设计亮点',
      tags: ['复盘', '产品'],
      attachments: [],
      createdAt: nov25Ts,
      updatedAt: nov25Ts,
    });

    // Day review (with Knowledge Base docs included & auto-saved review docs excluded)
    const docs = [
      {
        relPath: '工作/多维度复盘设计.md',
        name: '多维度复盘设计.md',
        isDir: false,
        updatedAt: nov25Ts,
        size: 120,
      },
      {
        relPath: '复盘/日复盘/2026-11-25.md',
        name: '2026-11-25.md',
        isDir: false,
        updatedAt: nov25Ts,
        size: 200,
      },
      {
        relPath: '工作/旧方案.md',
        name: '旧方案.md',
        isDir: false,
        updatedAt: octTs,
        size: 80,
      },
    ];

    const dayPeriod = resolveReviewPeriod({ granularity: 'day', today: '2026-11-25', lang: 'zh' });
    expect(dayPeriod.periodKey).toBe('2026-11-25');
    const dayRev = computeReview(ws, dayPeriod, '2026-11-25', docs);
    expect(dayRev.personal.doneCount).toBe(1);
    expect(dayRev.personal.createdTasks.length).toBe(1);
    expect(dayRev.personal.docsCount).toBe(1);
    expect(dayRev.personal.docs[0].relPath).toBe('工作/多维度复盘设计.md');
    expect(dayRev.personal.notesCount).toBe(1);
    const dayMd = generateReviewMarkdown(dayRev, ws, '2026-11-25', 'zh');
    expect(dayMd).toContain('# 日复盘报告（2026-11-25）');
    expect(dayMd).toContain('## 二、项目精力归集');
    expect(dayMd).toContain('## 四、本周期新建待办（1）');
    expect(dayMd).toContain('## 五、知识库文档记录（1）');
    expect(dayMd).toContain('**多维度复盘设计**');
    expect(dayMd).toContain('## 六、周期灵感记录（1）');
    expect(dayMd).toContain('总结 多维度复盘 的设计亮点');
    expect(dayMd).not.toContain('效率最高的一天');
    expect(dayMd).not.toMatch(/^- \[[ x]\]/m);

    // Month review
    const monthPeriod = resolveReviewPeriod({
      granularity: 'month',
      today: '2026-11-25',
      offset: 0,
      lang: 'zh',
    });
    expect(monthPeriod.periodKey).toBe('2026-11');
    expect(computeReview(ws, monthPeriod, '2026-11-25').personal.doneCount).toBe(1);

    // Year review captures both Oct and Nov
    const yearPeriod = resolveReviewPeriod({
      granularity: 'year',
      today: '2026-11-25',
      offset: 0,
      lang: 'en',
    });
    expect(yearPeriod.periodKey).toBe('2026');
    const yearRev = computeReview(ws, yearPeriod, '2026-11-25');
    expect(yearRev.personal.doneCount).toBe(2);
    expect(generateReviewMarkdown(yearRev, ws, '2026-11-25', 'en')).toContain(
      '# Yearly Review (2026: 2026-01-01 — 2026-12-31)',
    );

    // Custom reversed bounds auto-swap cleanly
    const customPeriod = resolveReviewPeriod({
      granularity: 'custom',
      today: '2026-11-25',
      customStart: '2026-11-25',
      customEnd: '2026-10-01',
      lang: 'zh',
    });
    expect(customPeriod.startDate).toBe('2026-10-01');
    expect(customPeriod.endDate).toBe('2026-11-25');
    expect(customPeriod.periodKey).toBe('2026-10-01_to_2026-11-25');
    expect(computeReview(ws, customPeriod, '2026-11-25').personal.doneCount).toBe(2);

    // Knowledge Base subfolder classification per review granularity
    expect(resolveReviewDocTarget(dayPeriod, 'zh')).toEqual({
      folderRelPath: '复盘/日复盘',
      baseTitle: '2026-11-25',
    });
    expect(resolveReviewDocTarget(monthPeriod, 'zh')).toEqual({
      folderRelPath: '复盘/月复盘',
      baseTitle: '2026-11',
    });
    expect(resolveReviewDocTarget(yearPeriod, 'en')).toEqual({
      folderRelPath: 'Reviews/Yearly',
      baseTitle: '2026',
    });
    expect(resolveReviewDocTarget(customPeriod, 'zh')).toEqual({
      folderRelPath: '复盘/自定义复盘',
      baseTitle: '2026-10-01_to_2026-11-25',
    });
  });
});
