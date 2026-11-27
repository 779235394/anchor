import { useMemo, useRef, useState } from 'react';
import {
  BookMarked,
  ImagePlus,
  Loader2,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type { Attachment, Lang, Note } from '@/domain/types';
import {
  buildConsolidatedNotesMarkdown,
  resolveUniqueDocRelPath,
  suggestConsolidatedDocTitle,
  type DocEntry,
} from '@/domain/docs';
import { markdownToHtml } from '@/domain/markdown';
import { attachmentRelPathToMobileUrl } from '@/domain/mobileSync';
import { todayStr } from '@/domain/date';
import { mobileApi } from './api';

interface MobileNotesTabProps {
  lang: Lang;
  notes: Note[];
  docsTree: DocEntry[];
  onNoteSaved: (note: Note) => void;
  onNoteDeleted: (note: Note) => void;
  onRefreshDocsTree: () => Promise<void>;
  onOpenDocInKnowledge: (relPath: string) => void;
  onPreviewImage: (url: string) => void;
  onToast: (msg: string, tone?: 'ok' | 'err') => void;
}

function formatNoteTime(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${m}-${day} ${hh}:${mm}`;
}

export function MobileNotesTab({
  lang,
  notes,
  docsTree,
  onNoteSaved,
  onNoteDeleted,
  onRefreshDocsTree,
  onOpenDocInKnowledge,
  onPreviewImage,
  onToast,
}: MobileNotesTabProps) {
  const zh = lang !== 'en';
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');

  // Editor sheet state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [draftAttachments, setDraftAttachments] = useState<Attachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of notes) {
      for (const tg of n.tags || []) {
        counts.set(tg, (counts.get(tg) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
  }, [notes]);

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes
      .filter((n) => {
        if (selectedTag && !(n.tags || []).includes(selectedTag)) return false;
        if (q) {
          const hay = `${n.text}\n${(n.tags || []).join(' ')}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [notes, selectedTag, query]);

  const openNew = () => {
    setEditingNote(null);
    setDraftText('');
    setDraftTags(selectedTag ? `#${selectedTag}` : '');
    setDraftAttachments([]);
    setEditorOpen(true);
  };

  const openEdit = (note: Note) => {
    setEditingNote(note);
    setDraftText(note.text);
    setDraftTags((note.tags || []).map((t) => `#${t}`).join(' '));
    setDraftAttachments(note.attachments || []);
    setEditorOpen(true);
  };

  const parseTagList = (raw: string): string[] => {
    const parts = raw
      .split(/[,，;；\s]+/)
      .map((s) => s.replace(/^#/, '').trim())
      .filter(Boolean);
    return [...new Set(parts)].slice(0, 6);
  };

  const handleSave = async () => {
    const tags = parseTagList(draftTags);
    if (!draftText.trim() && draftAttachments.length === 0) {
      onToast(zh ? '写点灵感内容或传张图吧' : 'Enter note text or add a photo', 'err');
      return;
    }
    setSaving(true);
    try {
      const saved = editingNote
        ? await mobileApi.updateNote(editingNote.id, {
            text: draftText,
            tags,
            attachments: draftAttachments,
          })
        : await mobileApi.createNote({
            text: draftText,
            tags,
            attachments: draftAttachments,
          });
      onNoteSaved(saved);
      setEditorOpen(false);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (note: Note) => {
    if (!window.confirm(zh ? '确认删除这条灵感？' : 'Delete this note?')) return;
    try {
      const deleted = await mobileApi.deleteNote(note.id);
      onNoteDeleted(deleted);
      if (editingNote?.id === note.id) setEditorOpen(false);
      onToast(zh ? '灵感已删除' : 'Note deleted', 'ok');
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const att = await mobileApi.uploadImage(file);
      setDraftAttachments((prev) => [...prev, att]);
      onToast(zh ? '图片已上传' : 'Photo uploaded', 'ok');
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleConsolidateToDoc = async (note: Note) => {
    const today = todayStr();
    const suggested = suggestConsolidatedDocTitle([note], today, lang);
    const { relPath } = resolveUniqueDocRelPath(
      docsTree.filter((e) => !e.isDir).map((e) => e.relPath),
      zh ? '灵感沉淀' : 'Notes',
      suggested,
    );
    const md = buildConsolidatedNotesMarkdown([note], {
      title: suggested,
      targetDocRelPath: relPath,
      today,
      lang,
    });
    try {
      await mobileApi.writeDocFile({ relPath, content: md });
      await onRefreshDocsTree();
      onToast(zh ? `已沉淀至知识库：${relPath}` : `Saved to Docs: ${relPath}`, 'ok');
      onOpenDocInKnowledge(relPath);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Search + Tag Bar */}
      <div className="px-4 pt-2.5 pb-2 space-y-2 shrink-0">
        <div className="relative">
          <Search
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-3)' }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={zh ? '搜索灵感与标签…' : 'Search notes & tags…'}
            className="ap-input w-full pl-9 pr-8 py-2 text-[13.5px]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-3)' }}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {allTags.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setSelectedTag('')}
              className="px-2.5 py-1 rounded-full text-[12px] font-medium shrink-0"
              style={{
                background: selectedTag === '' ? 'var(--accent)' : 'var(--bg-subtle)',
                color: selectedTag === '' ? '#ffffff' : 'var(--text-2)',
              }}
            >
              {zh ? '全部' : 'All'}
            </button>
            {allTags.map((tg) => {
              const active = selectedTag === tg;
              return (
                <button
                  key={tg}
                  type="button"
                  onClick={() => setSelectedTag(active ? '' : tg)}
                  className="px-2.5 py-1 rounded-full text-[12px] font-medium shrink-0"
                  style={{
                    background: active ? 'var(--accent)' : 'var(--bg-subtle)',
                    color: active ? '#ffffff' : 'var(--text-2)',
                  }}
                >
                  #{tg}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Cards Stream */}
      <div className="flex-1 overflow-y-auto m-scroll px-4 pb-24 space-y-2.5">
        {filteredNotes.length === 0 ? (
          <div className="py-16 text-center text-[13.5px]" style={{ color: 'var(--text-3)' }}>
            {zh ? '暂无灵感记录，点右下角 + 随时记一笔' : 'No notes yet — tap + to capture a thought'}
          </div>
        ) : (
          filteredNotes.map((note) => {
            const html = markdownToHtml(note.text || '', {
              resolveImageSrc: (src) => attachmentRelPathToMobileUrl(src) ?? src,
            });
            const imgs = (note.attachments || [])
              .filter((a) => a.kind === 'image' && a.relPath)
              .map((a) => ({
                id: a.id,
                name: a.name,
                url: attachmentRelPathToMobileUrl(a.relPath!) || '',
              }))
              .filter((a) => !!a.url);

            return (
              <div
                key={note.id}
                onClick={() => openEdit(note)}
                className="ap-card p-3.5 space-y-2.5"
              >
                {note.text.trim() && (
                  <div
                    className="m-md-prose text-[14.5px]"
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                )}

                {imgs.length > 0 && (
                  <div className="grid grid-cols-3 gap-1.5">
                    {imgs.map((img) => (
                      <img
                        key={img.id}
                        src={img.url}
                        alt={img.name}
                        onClick={(e) => {
                          e.stopPropagation();
                          onPreviewImage(img.url);
                        }}
                        className="w-full aspect-square object-cover rounded-[9px]"
                      />
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-1 min-w-0">
                    <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                      {formatNoteTime(note.createdAt)}
                    </span>
                    {(note.tags || []).map((tg) => (
                      <span
                        key={tg}
                        className="px-1.5 py-0.5 rounded-[6px] text-[11px] font-medium"
                        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                      >
                        #{tg}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleConsolidateToDoc(note);
                    }}
                    className="px-2 py-1 rounded-[8px] text-[11px] font-medium inline-flex items-center gap-1 shrink-0"
                    style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
                    title={zh ? '沉淀到知识库' : 'Save to Docs'}
                  >
                    <BookMarked className="w-3 h-3" />
                    {zh ? '存知识库' : 'To Doc'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* FAB */}
      <button
        type="button"
        onClick={openNew}
        className="ap-btn-primary fixed right-5 bottom-[84px] z-30 w-13 h-13 rounded-full inline-flex items-center justify-center"
        style={{
          boxShadow: '0 6px 20px color-mix(in srgb, var(--accent) 40%, transparent)',
        }}
        aria-label="New note"
      >
        <Plus className="w-6 h-6" />
      </button>

      {/* Editor Sheet */}
      {editorOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          style={{ background: 'var(--backdrop-mask)', backdropFilter: 'blur(8px)' }}
          onClick={() => setEditorOpen(false)}
        >
          <div
            className="w-full max-h-[90vh] rounded-t-[20px] flex flex-col overflow-hidden ap-glass-modal"
            style={{ borderBottom: 'none', borderLeft: 'none', borderRight: 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="px-4 py-3 flex items-center justify-between shrink-0"
              style={{ borderBottom: '1px solid var(--hairline-soft)' }}
            >
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="px-2 py-1 text-[14px]"
                style={{ color: 'var(--text-2)' }}
              >
                {zh ? '取消' : 'Cancel'}
              </button>
              <span className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>
                {editingNote ? (zh ? '编辑灵感' : 'Edit Note') : zh ? '记一条灵感' : 'New Note'}
              </span>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="ap-btn-primary px-3.5 py-1.5 rounded-[10px] text-[13.5px] font-semibold inline-flex items-center gap-1"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {zh ? '保存' : 'Save'}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto m-scroll p-4 space-y-3.5 m-safe-bottom">
              <textarea
                rows={6}
                autoFocus
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder={zh ? '随手写下想法、摘录或会议片段（支持 Markdown）…' : 'Capture an idea or excerpt…'}
                className="ap-input w-full text-[15px] leading-relaxed resize-y"
              />

              <div className="space-y-1.5">
                <div
                  className="text-[12px] font-medium inline-flex items-center gap-1"
                  style={{ color: 'var(--text-3)' }}
                >
                  <Tag className="w-3.5 h-3.5" />
                  {zh ? '标签（空格分隔，最多 6 个）' : 'Tags (space separated, max 6)'}
                </div>
                <input
                  type="text"
                  value={draftTags}
                  onChange={(e) => setDraftTags(e.target.value)}
                  placeholder={zh ? '如：#产品 #想法' : 'e.g. #idea #product'}
                  className="ap-input w-full text-[13.5px]"
                />
                {allTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {allTags.slice(0, 10).map((tg) => (
                      <button
                        key={tg}
                        type="button"
                        onClick={() => {
                          const cur = parseTagList(draftTags);
                          if (!cur.includes(tg)) {
                            setDraftTags([...cur, tg].map((x) => `#${x}`).join(' '));
                          }
                        }}
                        className="px-2 py-0.5 rounded-full text-[11.5px]"
                        style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
                      >
                        +#{tg}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium" style={{ color: 'var(--text-3)' }}>
                    {zh ? `图片（${draftAttachments.length}）` : `Photos (${draftAttachments.length})`}
                  </span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void handleUpload(e.target.files?.[0])}
                  />
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                    className="px-2.5 py-1 rounded-[8px] text-[12px] font-medium inline-flex items-center gap-1.5"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    {uploading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="w-3.5 h-3.5" />
                    )}
                    {zh ? '拍照 / 选图' : 'Add Photo'}
                  </button>
                </div>

                {draftAttachments.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {draftAttachments.map((att) => {
                      const imgUrl = att.relPath ? attachmentRelPathToMobileUrl(att.relPath) : null;
                      return (
                        <div
                          key={att.id}
                          className="relative aspect-square rounded-[10px] overflow-hidden"
                          style={{ background: 'var(--bg-subtle)' }}
                        >
                          {imgUrl && (
                            <img
                              src={imgUrl}
                              alt={att.name}
                              onClick={() => onPreviewImage(imgUrl)}
                              className="w-full h-full object-cover"
                            />
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setDraftAttachments((prev) => prev.filter((x) => x.id !== att.id))
                            }
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white inline-flex items-center justify-center"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {editingNote && (
                <button
                  type="button"
                  onClick={() => void handleDelete(editingNote)}
                  className="w-full py-2.5 rounded-[12px] text-[13.5px] font-medium inline-flex items-center justify-center gap-1.5"
                  style={{ background: 'var(--status-red-soft)', color: 'var(--status-red)' }}
                >
                  <Trash2 className="w-4 h-4" />
                  {zh ? '删除灵感' : 'Delete Note'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
