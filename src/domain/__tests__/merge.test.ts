import { describe, expect, it } from 'vitest';
import {
  createEmptyWorkspace,
  mergeEntityArrays,
  mergeWorkspaces,
  removeMemberFromWorkspace,
  removeProjectFromWorkspace,
} from '../merge';
import { isActive, TOMBSTONE_TTL_MS, type Task } from '../types';

function mkTask(id: string, title: string, updatedAt: number, deletedAt: number | null = null): Task {
  return {
    id,
    title,
    note: '',
    prio: 2,
    due: '2026-11-20',
    done: false,
    doneAt: null,
    projectId: '',
    rolls: 0,
    carriedDate: null,
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
      status: 'blocked',
      stage: '',
      next: '',
      blocker: 'API',
      createdAt: 1000,
      updatedAt: 1000,
    });
    ws.tasks.push({ ...mkTask('t1', 'Task 1', 1000), projectId: 'p1' });
    ws.assignments.push({
      id: 'a1',
      title: 'Assign 1',
      desc: '',
      ownerId: '',
      projectId: 'p1',
      dueAt: '2026-11-21T18:00',
      status: 'doing',
      doneAt: null,
      createdAt: 1000,
      updatedAt: 1000,
    });

    const kept = removeProjectFromWorkspace(ws, 'p1', 'keep', 2000);
    expect(kept.projects.filter(isActive)).toHaveLength(0);
    expect(kept.tasks.filter(isActive)[0].projectId).toBe('');
    expect(kept.assignments.filter(isActive)[0].projectId).toBe('');

    const wiped = removeProjectFromWorkspace(ws, 'p1', 'deleteAll', 2000);
    expect(wiped.tasks.filter(isActive)).toHaveLength(0);
    expect(wiped.assignments.filter(isActive)).toHaveLength(0);
  });

  it('unlinks assignments and daily items when removing a member', () => {
    const ws = createEmptyWorkspace('2026-11-20');
    ws.members.push({
      id: 'm1',
      name: 'Alice',
      role: '前端开发',
      note: '',
      createdAt: 1000,
      updatedAt: 1000,
    });
    ws.assignments.push({
      id: 'a1',
      title: 'UI polish',
      desc: '',
      ownerId: 'm1',
      projectId: '',
      dueAt: '2026-11-21T18:00',
      status: 'todo',
      doneAt: null,
      createdAt: 1000,
      updatedAt: 1000,
    });
    ws.daily.push({
      id: 'd1',
      date: '2026-11-20',
      title: 'Ship PR',
      ownerId: 'm1',
      done: false,
      doneAt: null,
      carriedFromId: null,
      carriedToDate: null,
      carryCount: 0,
      createdAt: 1000,
      updatedAt: 1000,
    });

    const after = removeMemberFromWorkspace(ws, 'm1', 3000);
    expect(after.members.filter(isActive)).toHaveLength(0);
    expect(after.assignments[0].ownerId).toBe('');
    expect(after.daily[0].ownerId).toBe('');

    // Merging keeps integrity normalized
    const normalized = mergeWorkspaces(after, createEmptyWorkspace('2026-11-20'), 4000);
    expect(normalized.assignments[0].ownerId).toBe('');
  });
});
