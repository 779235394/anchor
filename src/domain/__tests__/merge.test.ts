import { describe, expect, it } from 'vitest';
import {
  createEmptyWorkspace,
  mergeEntityArrays,
  mergeWorkspaces,
  removeProjectFromWorkspace,
} from '../merge';
import { isActive, TOMBSTONE_TTL_MS, type Task } from '../types';

function mkTask(id: string, title: string, updatedAt: number, deletedAt: number | null = null): Task {
  return {
    id,
    title,
    note: '',
    prio: 2,
    status: 'todo',
    due: '2026-11-20',
    done: false,
    doneAt: null,
    projectId: '',
    rolls: 0,
    carriedDate: null,
    attachments: [],
    createdAt: 1000,
    updatedAt,
    deletedAt,
  };
}

describe('workspace merge & cascade rules', () => {
  it('merges by id + updatedAt and respects tombstones without resurrecting deletes', () => {
    const now = 100_000;
    const local = [
      mkTask('a', 'Local newer title', 5000),
      mkTask('b', 'Local stale', 2000),
      mkTask('c', 'Deleted locally', 6000, 6000),
    ];
    const remote = [
      mkTask('a', 'Remote older', 3000),
      mkTask('b', 'Remote newer', 4000),
      mkTask('c', 'Still alive remotely', 3000, null),
      mkTask('d', 'Expired tombstone', 1000, now - TOMBSTONE_TTL_MS - 1),
    ];

    const merged = mergeEntityArrays(local, remote, now);
    expect(merged.find((x) => x.id === 'a')?.title).toBe('Local newer title');
    expect(merged.find((x) => x.id === 'b')?.title).toBe('Remote newer');
    expect(merged.find((x) => x.id === 'c')?.deletedAt).toBe(6000);
    expect(merged.find((x) => x.id === 'd')).toBeUndefined();
  });

  it('supports both keep (unlink) and deleteAll cascades when removing a project', () => {
    const ws = createEmptyWorkspace('2026-11-20');
    ws.projects.push({
      id: 'p1',
      name: 'Alpha',
      color: 'blue',
      createdAt: 1000,
      updatedAt: 1000,
    });
    ws.tasks.push({ ...mkTask('t1', 'Task 1', 1000), projectId: 'p1' });

    const kept = removeProjectFromWorkspace(ws, 'p1', 'keep', 2000);
    expect(kept.projects.filter(isActive)).toHaveLength(0);
    expect(kept.tasks.filter(isActive)[0].projectId).toBe('');

    const wiped = removeProjectFromWorkspace(ws, 'p1', 'deleteAll', 2000);
    expect(wiped.tasks.filter(isActive)).toHaveLength(0);
  });

  it('strips legacy project fields and assigns a stable default color', () => {
    const ws = createEmptyWorkspace('2026-11-23');
    ws.projects.push({
      id: 'p_legacy',
      name: 'Old Project',
      status: 'blocked',
      stage: 'Draft',
      next: 'Ship',
      blocker: 'API',
      createdAt: 1000,
      updatedAt: 1000,
    } as unknown as (typeof ws.projects)[number]);

    const merged = mergeWorkspaces(ws, createEmptyWorkspace('2026-11-23'), 3000);
    const proj = merged.projects[0] as unknown as Record<string, unknown>;
    expect(proj.name).toBe('Old Project');
    expect(typeof proj.color).toBe('string');
    expect('status' in proj).toBe(false);
    expect('stage' in proj).toBe(false);
    expect('next' in proj).toBe(false);
    expect('blocker' in proj).toBe(false);
  });

  it('normalizes legacy records missing status/attachments and syncs status with done', () => {
    const ws = createEmptyWorkspace('2026-11-20');
    // Simulate legacy v0.5 task missing status & attachments
    const legacyDone = { ...mkTask('t_legacy_done', 'Old done task', 1000), done: true } as Record<string, unknown>;
    delete legacyDone.attachments;
    delete legacyDone.status;
    ws.tasks.push(legacyDone as unknown as Task);

    const reversedRange = {
      ...mkTask('t_range', 'Swapped dates', 1500),
      status: 'confirm' as const,
      startDate: '2026-11-25',
      due: '2026-11-21',
      startTime: '09:30',
      endTime: '11:00',
    };
    ws.tasks.push(reversedRange);

    ws.tasks.push({
      ...mkTask('t_rich', 'Task with docs', 2000),
      attachments: [
        { id: 'a1', kind: 'link', name: 'Spec', url: 'https://example.com', createdAt: 2000 },
        { id: 'a2', kind: 'image', name: 'shot.png', relPath: 'attachments/a2.png', size: 1200, createdAt: 2000 },
      ],
    });

    const merged = mergeWorkspaces(ws, createEmptyWorkspace('2026-11-20'), 3000);
    const doneNorm = merged.tasks.find((t) => t.id === 't_legacy_done')!;
    expect(doneNorm.attachments).toEqual([]);
    expect(doneNorm.status).toBe('done');
    expect(doneNorm.done).toBe(true);

    const rangeNorm = merged.tasks.find((t) => t.id === 't_range')!;
    expect(rangeNorm.status).toBe('confirm');
    expect(rangeNorm.startDate).toBe('2026-11-21');
    expect(rangeNorm.due).toBe('2026-11-25');
    expect(rangeNorm.startTime).toBe('09:30');
    expect(rangeNorm.endTime).toBe('11:00');

    expect(merged.tasks.find((t) => t.id === 't_rich')?.attachments).toHaveLength(2);
  });
});
