import {
  isActive,
  type Attachment,
  type ViewKey,
  type WorkspaceData,
} from './types';
import { markdownToPlainText } from './markdown';

export interface SearchHit {
  id: string;
  kind: 'task' | 'project' | 'note' | 'assignment' | 'member' | 'daily';
  view: ViewKey;
  entityId: string;
  title: string;
  subtitle: string;
  matchedAttachment?: string;
}

function findMatchingAttachment(atts: Attachment[] | undefined, q: string): string | undefined {
  if (!atts || !atts.length) return undefined;
  const hit = atts.find(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      (a.url && a.url.toLowerCase().includes(q)),
  );
  return hit ? hit.name : undefined;
}

/** Cross-module instant search across Tasks, Projects, Notes, Assignments, Members, Daily, and Attachments. */
export function searchWorkspace(data: WorkspaceData, rawQuery: string, limit = 30): SearchHit[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];

  const hits: SearchHit[] = [];
  const projects = data.projects.filter(isActive);
  const members = data.members.filter(isActive);
  const projMap = new Map(projects.map((p) => [p.id, p.name]));
  const memberMap = new Map(members.map((m) => [m.id, m.name]));

  for (const t of data.tasks.filter(isActive)) {
    const attHit = findMatchingAttachment(t.attachments, q);
    const projName = t.projectId ? projMap.get(t.projectId) || '' : '';
    if (
      t.title.toLowerCase().includes(q) ||
      t.note.toLowerCase().includes(q) ||
      projName.toLowerCase().includes(q) ||
      attHit
    ) {
      hits.push({
        id: `task:${t.id}`,
        kind: 'task',
        view: 'tasks',
        entityId: t.id,
        title: t.title,
        subtitle: [t.due || '', projName].filter(Boolean).join(' · '),
        matchedAttachment: attHit,
      });
    }
  }

  for (const p of projects) {
    if (
      p.name.toLowerCase().includes(q) ||
      p.stage.toLowerCase().includes(q) ||
      p.next.toLowerCase().includes(q) ||
      p.blocker.toLowerCase().includes(q)
    ) {
      hits.push({
        id: `project:${p.id}`,
        kind: 'project',
        view: 'projects',
        entityId: p.id,
        title: p.name,
        subtitle: p.blocker || p.stage || p.next,
      });
    }
  }

  for (const a of data.assignments.filter(isActive)) {
    const attHit = findMatchingAttachment(a.attachments, q);
    const owner = memberMap.get(a.ownerId) || '';
    const proj = a.projectId ? projMap.get(a.projectId) || '' : '';
    if (
      a.title.toLowerCase().includes(q) ||
      a.desc.toLowerCase().includes(q) ||
      owner.toLowerCase().includes(q) ||
      proj.toLowerCase().includes(q) ||
      attHit
    ) {
      hits.push({
        id: `assignment:${a.id}`,
        kind: 'assignment',
        view: 'assignments',
        entityId: a.id,
        title: a.title,
        subtitle: [owner, proj].filter(Boolean).join(' · '),
        matchedAttachment: attHit,
      });
    }
  }

  for (const n of data.notes.filter(isActive)) {
    const attHit = findMatchingAttachment(n.attachments, q);
    const tagStr = n.tags.join(' ');
    const plain = markdownToPlainText(n.text);
    if (
      n.text.toLowerCase().includes(q) ||
      plain.toLowerCase().includes(q) ||
      tagStr.toLowerCase().includes(q) ||
      attHit
    ) {
      const firstLine = plain.split(/\r?\n/)[0] || plain || n.text;
      hits.push({
        id: `note:${n.id}`,
        kind: 'note',
        view: 'notes',
        entityId: n.id,
        title: firstLine.slice(0, 80),
        subtitle: n.tags.map((x) => `#${x}`).join(' '),
        matchedAttachment: attHit,
      });
    }
  }

  for (const m of members) {
    if (
      m.name.toLowerCase().includes(q) ||
      m.role.toLowerCase().includes(q) ||
      m.note.toLowerCase().includes(q)
    ) {
      hits.push({
        id: `member:${m.id}`,
        kind: 'member',
        view: 'members',
        entityId: m.id,
        title: m.name,
        subtitle: [m.role, m.note].filter(Boolean).join(' · '),
      });
    }
  }

  for (const d of data.daily.filter(isActive)) {
    const owner = memberMap.get(d.ownerId) || '';
    if (d.title.toLowerCase().includes(q) || owner.toLowerCase().includes(q)) {
      hits.push({
        id: `daily:${d.id}`,
        kind: 'daily',
        view: 'daily',
        entityId: d.id,
        title: d.title,
        subtitle: [d.date, owner].filter(Boolean).join(' · '),
      });
    }
  }

  return hits.slice(0, limit);
}
