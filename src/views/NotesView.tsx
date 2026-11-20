import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Lightbulb,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { isActive, type Attachment, type Note } from '@/domain/types';
import { formatClock, todayStr } from '@/domain/date';
import { getDict } from '@/i18n';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/Dialogs';
import { AttachmentPanel } from '@/components/AttachmentPanel';

export function NotesView() {
  const {
    config,
    data,
    addNote,
    updateNote,
    deleteNote,
    convertNoteToTask,
    addAttachment,
    removeAttachment,
  } = useWorkbenchStore();
  const t = getDict(config.lang);
  const today = todayStr();

  const [text, setText] = useState('');
  const [tags, setTags] = useState('');
  const [draftAttachments, setDraftAttachments] = useState<Attachment[]>([]);
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editTags, setEditTags] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const activeNotes = useMemo(
    () =>
      data.notes
        .filter(isActive)
        .sort((a, b) => b.createdAt - a.createdAt),
    [data.notes],
  );

  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of activeNotes) {
      for (const tg of n.tags) {
        map.set(tg, (map.get(tg) || 0) + 1);
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [activeNotes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return activeNotes.filter((n) => {
      if (tagFilter && !n.tags.includes(tagFilter)) return false;
      if (!q) return true;
      return (
        n.text.toLowerCase().includes(q) ||
        n.tags.some((tg) => tg.toLowerCase().includes(q))
      );
    });
  }, [activeNotes, tagFilter, query]);

  const submitNew = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!text.trim() && draftAttachments.length === 0) return;
    addNote(text.trim() || (draftAttachments[0]?.name ?? ''), tags, draftAttachments);
    setText('');
    setTags('');
    setDraftAttachments([]);
  };

  const startEdit = (n: Note) => {
    setEditingId(n.id);
    setEditText(n.text);
    setEditTags(n.tags.join(', '));
  };

  const saveEdit = () => {
    if (!editingId || !editText.trim()) return;
    updateNote(editingId, editText, editTags);
    setEditingId(null);
  };

  return (
    <div className="h-full overflow-y-auto px-8 py-7">
      <div className="max-w-[960px] mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-semibold tracking-[-0.025em] leading-tight">
              {t.notesTitle}
            </h1>
            <p className="text-[13px] mt-1" style={{ color: 'var(--text-2)' }}>
              {t.notesSub(activeNotes.length, tagCounts.length)}
            </p>
          </div>
          <div className="relative w-[240px]">
            <Search
              className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--text-3)' }}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.noteSearchPh}
              className="ap-input w-full pl-8 py-1.5 text-[13px]"
            />
          </div>
        </div>

        {/* Capture Card */}
        <form onSubmit={submitNew} className="ap-card p-4 space-y-3">
          <textarea
            id="quick-capture-input"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                submitNew();
              }
            }}
            placeholder={t.notePh}
            maxLength={1500}
            className="w-full bg-transparent border-0 outline-none resize-none text-[14px] leading-relaxed"
            style={{ color: 'var(--text-1)' }}
          />
          <AttachmentPanel
            compact
            attachments={draftAttachments}
            onAdd={(att) => setDraftAttachments((prev) => [...prev, att])}
            onRemove={(attId) =>
              setDraftAttachments((prev) => prev.filter((a) => a.id !== attId))
            }
          />
          <div
            className="flex flex-wrap items-center gap-2.5 pt-2.5"
            style={{ borderTop: '1px solid var(--hairline-soft)' }}
          >
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t.noteTagsPh}
              maxLength={120}
              className="ap-input flex-1 min-w-[200px] py-1.5 text-[13px]"
            />
            <button type="submit" className="ap-btn ap-btn-primary ap-btn-sm">
              <Plus className="w-3.5 h-3.5" />
              {t.noteSave}
            </button>
          </div>
        </form>

        {/* Tag Filter Chips */}
        {tagCounts.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setTagFilter('')}
              className="ap-pill ap-ease"
              style={{
                background: !tagFilter ? 'var(--accent)' : 'var(--bg-subtle)',
                color: !tagFilter ? '#fff' : 'var(--text-2)',
              }}
            >
              {t.all} {activeNotes.length}
            </button>
            {tagCounts.map(([tag, cnt]) => {
              const on = tagFilter === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setTagFilter(on ? '' : tag)}
                  className="ap-pill ap-ease"
                  style={{
                    background: on ? 'var(--accent)' : 'var(--bg-subtle)',
                    color: on ? '#fff' : 'var(--text-2)',
                  }}
                >
                  #{tag} {cnt}
                </button>
              );
            })}
          </div>
        )}

        {/* Notes Grid */}
        {filtered.length === 0 ? (
          <div className="ap-card">
            <EmptyState
              icon={<Lightbulb className="w-8 h-8" strokeWidth={1.5} />}
              title={t.emptyNotes}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filtered.map((note) => {
              const isEditing = editingId === note.id;
              return (
                <div
                  key={note.id}
                  className="group ap-card p-4 flex flex-col justify-between gap-3 ap-ease"
                >
                  {isEditing ? (
                    <div className="space-y-2.5">
                      <textarea
                        rows={4}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="ap-input w-full resize-none text-[13.5px] leading-relaxed"
                        autoFocus
                      />
                      <input
                        type="text"
                        value={editTags}
                        onChange={(e) => setEditTags(e.target.value)}
                        placeholder={t.noteTagsPh}
                        className="ap-input w-full py-1.5 text-[12.5px]"
                      />
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="ap-btn ap-btn-sm"
                        >
                          <X className="w-3.5 h-3.5" />
                          {t.cancel}
                        </button>
                        <button
                          type="button"
                          onClick={saveEdit}
                          className="ap-btn ap-btn-primary ap-btn-sm"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {t.save}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p
                        onClick={() => startEdit(note)}
                        className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words cursor-text"
                        style={{ color: 'var(--text-1)' }}
                      >
                        {note.text}
                      </p>

                      <AttachmentPanel
                        compact
                        attachments={note.attachments || []}
                        onAdd={(att) => addAttachment('note', note.id, att)}
                        onRemove={(attId) => removeAttachment('note', note.id, attId)}
                      />

                      <div className="space-y-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {note.tags.map((tg) => (
                            <button
                              key={tg}
                              type="button"
                              onClick={() => setTagFilter(tagFilter === tg ? '' : tg)}
                              className="ap-pill"
                              style={{
                                background: 'var(--accent-soft)',
                                color: 'var(--accent)',
                              }}
                            >
                              #{tg}
                            </button>
                          ))}
                        </div>

                        <div
                          className="flex items-center justify-between gap-2 pt-2.5"
                          style={{ borderTop: '1px solid var(--hairline-soft)' }}
                        >
                          <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                            {formatClock(note.createdAt, config.lang, today)}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => convertNoteToTask(note.id)}
                              title={t.convertToTask}
                              className="ap-btn ap-btn-sm py-1 px-2 text-[11.5px]"
                            >
                              <ArrowUpRight className="w-3.5 h-3.5" />
                              {t.convertToTask}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteId(note.id)}
                              title={t.delete}
                              className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center opacity-0 group-hover:opacity-100 ap-ease hover:bg-[var(--status-red-soft)]"
                              style={{ color: 'var(--text-3)' }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteId}
        title={t.delete}
        body={config.lang === 'zh' ? '确定删除这条灵感？' : 'Delete this note?'}
        confirmLabel={t.delete}
        cancelLabel={t.cancel}
        danger
        onConfirm={() => {
          if (deleteId) deleteNote(deleteId);
          setDeleteId(null);
        }}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
