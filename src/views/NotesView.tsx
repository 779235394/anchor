import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  CheckSquare,
  Lightbulb,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { isActive, type Attachment, type Note } from '@/domain/types';
import { toggleMarkdownTaskItem } from '@/domain/markdown';
import { formatClock, todayStr } from '@/domain/date';
import { getDict } from '@/i18n';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/Dialogs';
import { ConsolidateNotesModal } from '@/components/ConsolidateNotesModal';
import { AttachmentPanel } from '@/components/AttachmentPanel';
import { RichTextEditor } from '@/components/RichTextEditor';
import { RichTextView } from '@/components/RichTextView';

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
    openDoc,
    pushToast,
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
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [consolidateTargets, setConsolidateTargets] = useState<Note[] | null>(null);

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

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedNotes = useMemo(
    () => activeNotes.filter((n) => selectedIdSet.has(n.id)),
    [activeNotes, selectedIdSet],
  );

  const toggleSelectNote = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const toggleBatchMode = () => {
    setBatchMode((prev) => {
      if (prev) setSelectedIds([]);
      else setEditingId(null);
      return !prev;
    });
  };

  useEffect(() => {
    if (!batchMode || consolidateTargets) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBatchMode(false);
        setSelectedIds([]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [batchMode, consolidateTargets]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div data-tauri-drag-region="deep" className="h-7 shrink-0" />
      <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-7">
        <div className="max-w-[960px] mx-auto space-y-5">
          {/* Header */}
          <div
            data-tauri-drag-region="deep"
            className="flex flex-wrap items-end justify-between gap-3 select-none"
          >
          <div>
            <h1 className="text-[24px] font-semibold tracking-[-0.025em] leading-tight">
              {t.notesTitle}
            </h1>
            <p className="text-[13px] mt-1" style={{ color: 'var(--text-2)' }}>
              {t.notesSub(activeNotes.length, tagCounts.length)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {activeNotes.length > 0 && (
              <button
                type="button"
                onClick={toggleBatchMode}
                className={`ap-btn ap-btn-sm ${batchMode ? 'ap-btn-primary' : ''}`}
              >
                <CheckSquare className="w-3.5 h-3.5" />
                {batchMode ? t.noteCancelSelect : t.noteBatchSelect}
              </button>
            )}
            <div className="relative w-[220px]">
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
        </div>

        {/* Capture Card */}
        <form onSubmit={submitNew} className="ap-card p-4 space-y-3">
          <RichTextEditor
            id="quick-capture-input"
            value={text}
            onChange={setText}
            placeholder={t.notePh}
            minHeight={74}
            maxHeight={220}
            submitOnEnter
            onSubmit={() => submitNew()}
            onAddAttachment={(att) => setDraftAttachments((prev) => [...prev, att])}
            dropPriority={3}
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
              const isEditing = !batchMode && editingId === note.id;
              const isSelected = batchMode && selectedIdSet.has(note.id);
              return (
                <div
                  key={note.id}
                  onClick={(e) => {
                    if (!batchMode) return;
                    const target = e.target as HTMLElement | null;
                    if (target?.closest('button, a, input, textarea')) return;
                    toggleSelectNote(note.id);
                  }}
                  className={`group ap-card p-4 flex flex-col justify-between gap-3 ap-ease ${
                    batchMode ? 'cursor-pointer select-none' : ''
                  }`}
                  style={
                    isSelected
                      ? {
                          borderColor: 'var(--accent)',
                          boxShadow: '0 0 0 2px var(--accent-soft), var(--shadow-card)',
                        }
                      : undefined
                  }
                >
                  {isEditing ? (
                    <div className="space-y-2.5">
                      <RichTextEditor
                        variant="input"
                        value={editText}
                        onChange={setEditText}
                        placeholder={t.richInspectorPh}
                        minHeight={96}
                        maxHeight={240}
                        autoFocus
                        onSubmit={saveEdit}
                        dropPriority={6}
                        onAddAttachment={(att) => addAttachment('note', note.id, att)}
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
                      <div className="flex items-start gap-2.5">
                        {batchMode && (
                          <button
                            type="button"
                            onClick={() => toggleSelectNote(note.id)}
                            aria-label="Select note"
                            className="mt-0.5 w-4 h-4 rounded-[4.5px] shrink-0 inline-flex items-center justify-center ap-ease"
                            style={{
                              border: `1.5px solid ${isSelected ? 'var(--accent)' : 'var(--text-3)'}`,
                              background: isSelected ? 'var(--accent)' : 'transparent',
                              color: '#ffffff',
                            }}
                          >
                            {isSelected && <Check className="w-3 h-3" strokeWidth={2.6} />}
                          </button>
                        )}
                        <div
                          onClick={() => {
                            if (!batchMode) startEdit(note);
                          }}
                          className={`flex-1 min-w-0 ${batchMode ? 'cursor-pointer' : 'cursor-text'}`}
                        >
                          <RichTextView
                            markdown={note.text}
                            onToggleTaskItem={(idx) => {
                              if (batchMode) return;
                              const updated = toggleMarkdownTaskItem(note.text, idx);
                              if (updated !== note.text) {
                                updateNote(note.id, updated, note.tags.join(', '));
                              }
                            }}
                          />
                        </div>
                      </div>

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
                          {!batchMode && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setConsolidateTargets([note])}
                                title={t.noteConsolidateSingle}
                                className="ap-btn ap-btn-sm py-1 px-2 text-[11.5px]"
                              >
                                <BookOpen className="w-3.5 h-3.5" />
                                {t.noteConsolidateSingle}
                              </button>
                              <button
                                type="button"
                                onClick={() => convertNoteToTask(note.id)}
                                title={t.convertToTask}
                                className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle-hover)]"
                                style={{ color: 'var(--text-2)' }}
                              >
                                <ArrowUpRight className="w-3.5 h-3.5" />
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
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Sticky Multi-Select Action Bar */}
        {batchMode && (
          <div className="sticky bottom-3 z-20 pt-2">
            <div
              className="px-4 py-2.5 rounded-[14px] flex flex-wrap items-center justify-between gap-3"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--hairline)',
                boxShadow: 'var(--shadow-modal)',
                backdropFilter: 'blur(14px)',
              }}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                  {t.noteSelectedCount(selectedNotes.length)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const filteredIds = filtered.map((n) => n.id);
                    const allSelected =
                      filteredIds.length > 0 && filteredIds.every((id) => selectedIdSet.has(id));
                    if (allSelected) {
                      setSelectedIds((prev) => prev.filter((id) => !filteredIds.includes(id)));
                    } else {
                      setSelectedIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
                    }
                  }}
                  className="text-[12px] font-medium px-2 py-1 rounded-[7px] hover:bg-[var(--bg-subtle-hover)]"
                  style={{ color: 'var(--accent)' }}
                >
                  {t.noteSelectAllFiltered}
                </button>
                {selectedNotes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedIds([])}
                    className="text-[12px] font-medium px-2 py-1 rounded-[7px] hover:bg-[var(--bg-subtle-hover)]"
                    style={{ color: 'var(--text-3)' }}
                  >
                    {t.noteClearSelection}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setBatchMode(false);
                    setSelectedIds([]);
                  }}
                  className="ap-btn ap-btn-sm"
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  disabled={selectedNotes.length === 0}
                  onClick={() => setConsolidateTargets(selectedNotes)}
                  className="ap-btn ap-btn-primary ap-btn-sm disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  {t.noteConsolidateBtn}
                </button>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>

      <ConsolidateNotesModal
        notes={consolidateTargets}
        onClose={() => setConsolidateTargets(null)}
        onSuccess={(createdRelPath) => {
          setConsolidateTargets(null);
          setBatchMode(false);
          setSelectedIds([]);
          pushToast(t.noteConsolidatedToast(createdRelPath), 'ok', {
            label: t.noteOpenInKb,
            onClick: () => openDoc(createdRelPath),
          });
        }}
      />

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
