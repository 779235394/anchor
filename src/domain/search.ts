import {
  isActive,
  type Attachment,
  type ViewKey,
  type WorkspaceData,
} from './types';
import { markdownToPlainText } from './markdown';

export interface SearchHit {
  id: string;
  kind: 'task' | 'project' | 'note';
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

/** Cross-module instant search across Tasks, Projects, Notes, and Attachments. */
export function searchWorkspace(data: WorkspaceData, rawQuery: string, limit = 30): SearchHit[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];

  const hits: SearchHit[] = [];
  const projects = data.projects.filter(isActive);
  const projMap = new Map(projects.map((p) => [p.id, p.name]));

  for (const t of data.tasks.filter(isActive)) {
    const attHit = findMatchingAttachment(t.attachments, q);
    const projName = t.projectId ? projMap.get(t.projectId) || '' : '';
    const scheduleLabel =
      t.startDate && t.due && t.startDate !== t.due
        ? `${t.startDate} → ${t.due}`
        : t.due || t.startDate || '';
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
        subtitle: [scheduleLabel, projName].filter(Boolean).join(' · '),
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

  return hits.slice(0, limit);
}
