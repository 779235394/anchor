import { describe, expect, it } from 'vitest';
import { searchWorkspace } from '../search';
import { isNewerVersion } from '../semver';
import { createEmptyWorkspace } from '../merge';

describe('global workspace search & semver', () => {
  it('searches across tasks, projects, notes and attachment names/URLs', () => {
    const ws = createEmptyWorkspace('2026-11-21');
    ws.projects.push({
      id: 'p1',
      name: 'Payment Gateway',
      color: 'teal',
      createdAt: 1000,
      updatedAt: 1000,
    });
    ws.tasks.push({
      id: 't1',
      title: 'Prepare architecture slides',
      note: '',
      prio: 1,
      status: 'doing',
      due: '2026-11-21',
      done: false,
      doneAt: null,
      projectId: 'p1',
      rolls: 0,
      carriedDate: null,
      attachments: [
        {
          id: 'att1',
          kind: 'file',
          name: 'Q4-budget-sheet.xlsx',
          relPath: 'attachments/att1.xlsx',
          createdAt: 1000,
        },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    });
    ws.notes.push({
      id: 'n1',
      text: 'Remember to automate Gitee sync',
      tags: ['git'],
      attachments: [],
      createdAt: 1000,
      updatedAt: 1000,
    });

    expect(searchWorkspace(ws, 'budget-sheet')[0]).toMatchObject({
      kind: 'task',
      entityId: 't1',
      matchedAttachment: 'Q4-budget-sheet.xlsx',
    });
    expect(searchWorkspace(ws, 'Payment')[0]).toMatchObject({
      kind: 'task',
      entityId: 't1',
    });
    expect(searchWorkspace(ws, 'Payment').some((h) => h.kind === 'project' && h.entityId === 'p1')).toBe(
      true,
    );
    expect(searchWorkspace(ws, 'gitee')[0]).toMatchObject({
      kind: 'note',
      entityId: 'n1',
    });
    expect(searchWorkspace(ws, '')).toEqual([]);
  });

  it('compares semantic versions accurately', () => {
    expect(isNewerVersion('v0.6.0', '0.5.0')).toBe(true);
    expect(isNewerVersion('v1.0.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('v0.6.0', '0.6.0')).toBe(false);
    expect(isNewerVersion('v0.2.9', '0.3.0')).toBe(false);
  });
});
