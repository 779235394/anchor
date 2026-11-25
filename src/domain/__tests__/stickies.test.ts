import { describe, expect, it } from 'vitest';
import {
  createStickyNote,
  filterAndSortStickies,
  getStickyChecklistStats,
  getStickyDisplayTitle,
  isStickyEmpty,
  normalizeSticky,
} from '../stickies';
import { createEmptyWorkspace, mergeWorkspaces } from '../merge';
import { searchWorkspace } from '../search';

describe('stickies domain logic', () => {
  it('defaults pinned=true and autoOpen=false when creating a sticky note', () => {
    const s = createStickyNote({ title: 'API key' }, 1000);
    expect(s.id.startsWith('stk-')).toBe(true);
    expect(s.color).toBe('yellow');
    expect(s.pinned).toBe(true);
    expect(s.autoOpen).toBe(false);
    expect(s.createdAt).toBe(1000);
  });

  it('normalizes legacy or partial sticky payloads safely', () => {
    const s = normalizeSticky({ id: 'stk-1', color: 'invalid' as never });
    expect(s.color).toBe('yellow');
    expect(s.pinned).toBe(true);
    expect(s.autoOpen).toBe(false);
    expect(s.title).toBe('');
    expect(s.content).toBe('');
  });

  it('extracts fallback display title from first content line and counts checklists', () => {
    const s = createStickyNote({
      title: '',
      content: '- [x] Done item\n- [ ] Pending item\n- [X] Second done',
    });
    expect(getStickyDisplayTitle(s, 'Untitled')).toContain('Done item');
    expect(getStickyChecklistStats(s.content)).toEqual({ done: 2, total: 3 });

    const empty = createStickyNote({ title: '', content: '' });
    expect(getStickyDisplayTitle(empty, 'Untitled')).toBe('Untitled');
  });

  it('filters by status (open / autoOpen), color, and search query, sorted by updatedAt desc', () => {
    const a = createStickyNote({ title: 'Deploy steps', color: 'blue', autoOpen: true }, 100);
    const b = createStickyNote({ title: 'Lunch', color: 'yellow', autoOpen: false }, 300);
    const c = createStickyNote({ title: 'Deleted', color: 'blue', autoOpen: true }, 500);
    c.deletedAt = 500;

    const openIds = new Set([b.id]);

    expect(
      filterAndSortStickies([a, b, c], { query: '', status: 'all', color: '', openIds }).map(
        (x) => x.id,
      ),
    ).toEqual([b.id, a.id]);

    expect(
      filterAndSortStickies([a, b, c], { query: '', status: 'open', color: '', openIds }).map(
        (x) => x.id,
      ),
    ).toEqual([b.id]);

    expect(
      filterAndSortStickies([a, b, c], { query: '', status: 'autoOpen', color: '', openIds }).map(
        (x) => x.id,
      ),
    ).toEqual([a.id]);

    expect(
      filterAndSortStickies([a, b, c], { query: 'deploy', status: 'all', color: 'blue', openIds }).map(
        (x) => x.id,
      ),
    ).toEqual([a.id]);
  });

  it('merges stickies via LWW and indexes stickies in Spotlight search', () => {
    const local = createEmptyWorkspace('2026-11-25');
    const remote = createEmptyWorkspace('2026-11-25');

    const sLocal = createStickyNote({ title: 'Local newer', content: 'ssh prod-box' }, 200);
    const sRemoteOld = { ...sLocal, title: 'Remote older', updatedAt: 100 };
    const sRemoteOnly = createStickyNote({ title: 'Remote sticky', content: 'hello' }, 150);

    local.stickies = [sLocal];
    remote.stickies = [sRemoteOld, sRemoteOnly];

    const merged = mergeWorkspaces(local, remote, 300);
    expect(merged.stickies).toHaveLength(2);
    expect(merged.stickies.find((x) => x.id === sLocal.id)?.title).toBe('Local newer');

    const hits = searchWorkspace(merged, 'prod-box');
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('sticky');
    expect(hits[0].entityId).toBe(sLocal.id);
  });

  it('identifies and hides empty stickies from list and Spotlight search', () => {
    const empty = createStickyNote({ title: '   ', content: '\n  ' }, 400);
    const nonEmpty = createStickyNote({ title: '', content: 'Remember milk' }, 300);
    expect(isStickyEmpty(empty)).toBe(true);
    expect(isStickyEmpty(nonEmpty)).toBe(false);

    const visible = filterAndSortStickies([empty, nonEmpty], {
      query: '',
      status: 'all',
      color: '',
      openIds: new Set([empty.id, nonEmpty.id]),
    });
    expect(visible.map((x) => x.id)).toEqual([nonEmpty.id]);
  });
});
