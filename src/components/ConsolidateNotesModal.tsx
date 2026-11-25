import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, Check, FolderPlus, X } from 'lucide-react';
import type { Note } from '@/domain/types';
import { todayStr } from '@/domain/date';
import {
  buildConsolidatedNotesMarkdown,
  getBaseName,
  normalizeDocRelPath,
  resolveUniqueDocRelPath,
  suggestConsolidatedDocTitle,
  type ConsolidateNotesOrder,
  type ConsolidateNotesStyle,
  type DocEntry,
} from '@/domain/docs';
import { getDict } from '@/i18n';
import { storageApi } from '@/services/storage';
import { useWorkbenchStore } from '@/store/workbenchStore';

interface ConsolidateNotesModalProps {
  notes: Note[] | null;
  onClose: () => void;
  onSuccess: (createdRelPath: string, removedOrigin: boolean) => void;
}

export function ConsolidateNotesModal({
  notes,
  onClose,
  onSuccess,
}: ConsolidateNotesModalProps) {
  const { config, deleteNote, pushToast } = useWorkbenchStore();
  const t = getDict(config.lang);
  const today = todayStr();

  const [entries, setEntries] = useState<DocEntry[]>([]);
  const [title, setTitle] = useState('');
  const [targetDir, setTargetDir] = useState('');
  const [creatingDir, setCreatingDir] = useState(false);
  const [newDirName, setNewDirName] = useState('');
  const [order, setOrder] = useState<ConsolidateNotesOrder>('asc');
  const [style, setStyle] = useState<ConsolidateNotesStyle>('dated_sections');
  const [removeOrigin, setRemoveOrigin] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const open = !!notes && notes.length > 0;
  const isMulti = (notes?.length ?? 0) > 1;

  useEffect(() => {
    if (!notes || notes.length === 0) return;
    setTitle(suggestConsolidatedDocTitle(notes, today, config.lang));
    setTargetDir('');
    setCreatingDir(false);
    setNewDirName('');
    setOrder('asc');
    setStyle('dated_sections');
    setRemoveOrigin(false);
    setSubmitting(false);

    let cancelled = false;
    void storageApi
      .listDocsTree()
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [notes, today, config.lang]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  const folderPaths = useMemo(
    () =>
      entries
        .filter((e) => e.isDir)
        .map((e) => e.relPath)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })),
    [entries],
  );

  const existingFilePaths = useMemo(
    () => entries.filter((e) => !e.isDir).map((e) => e.relPath),
    [entries],
  );

  const resolvedPath = useMemo(
    () => resolveUniqueDocRelPath(existingFilePaths, targetDir, title),
    [existingFilePaths, targetDir, title],
  );

  const summaryStats = useMemo(() => {
    if (!notes) return { tags: [] as string[], attachments: 0 };
    const tagSet = new Set<string>();
    let attachments = 0;
    for (const n of notes) {
      for (const tg of n.tags || []) {
        if (tg.trim()) tagSet.add(tg.trim());
      }
      attachments += (n.attachments || []).length;
    }
    return { tags: [...tagSet], attachments };
  }, [notes]);

  if (!open || !notes) return null;

  const handleCreateFolder = async () => {
    const clean = normalizeDocRelPath(newDirName);
    if (!clean) return;
    try {
      const created = await storageApi.createDocFolder(clean);
      const list = await storageApi.listDocsTree();
      setEntries(list);
      setTargetDir(created.relPath);
      setNewDirName('');
      setCreatingDir(false);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  const handleSubmit = async () => {
    if (submitting || !notes.length) return;
    setSubmitting(true);
    try {
      const md = buildConsolidatedNotesMarkdown(notes, {
        title: title.trim() || suggestConsolidatedDocTitle(notes, today, config.lang),
        targetDocRelPath: resolvedPath.relPath,
        today,
        lang: config.lang,
        order,
        style,
      });
      await storageApi.writeDocFile(resolvedPath.relPath, md);
      if (removeOrigin) {
        for (const n of notes) {
          deleteNote(n.id);
        }
      }
      onSuccess(resolvedPath.relPath, removeOrigin);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'err');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--backdrop-mask)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[500px] rounded-[16px] p-6 space-y-4"
        style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void handleSubmit();
          }
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
            <h3 className="text-[16px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
              {isMulti ? t.noteConsolidateTitleMulti(notes.length) : t.noteConsolidateTitleSingle}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center hover:bg-[var(--bg-subtle-hover)]"
            style={{ color: 'var(--text-3)' }}
            aria-label={t.cancel}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Title */}
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
            {t.noteConsolidateDocTitle}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.kbDocNamePh}
            autoFocus
            className="ap-input w-full py-2 text-[13.5px]"
          />
          <div className="text-[11.5px] font-mono truncate" style={{ color: 'var(--text-3)' }}>
            docs/{resolvedPath.relPath}
          </div>
          {resolvedPath.renamedFromConflict && (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-[12px]"
              style={{
                background: 'var(--status-orange-soft)',
                color: 'var(--status-orange)',
              }}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                {t.noteConsolidateConflictHint(getBaseName(resolvedPath.relPath))}
              </span>
            </div>
          )}
        </div>

        {/* Target Folder */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              {t.noteConsolidateTargetDir}
            </label>
            <button
              type="button"
              onClick={() => setCreatingDir((v) => !v)}
              className="inline-flex items-center gap-1 text-[12px] font-medium hover:opacity-80"
              style={{ color: 'var(--accent)' }}
            >
              <FolderPlus className="w-3.5 h-3.5" />
              {t.noteConsolidateNewDir}
            </button>
          </div>
          <select
            value={targetDir}
            onChange={(e) => setTargetDir(e.target.value)}
            className="ap-input w-full py-2 text-[13px]"
          >
            <option value="">/ ({t.kbRootDir})</option>
            {folderPaths.map((dir) => (
              <option key={dir} value={dir}>
                /{dir}
              </option>
            ))}
          </select>

          {creatingDir && (
            <div className="flex items-center gap-1.5 pt-1">
              <input
                type="text"
                value={newDirName}
                onChange={(e) => setNewDirName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleCreateFolder();
                  }
                }}
                placeholder={t.noteConsolidateNewDirPh}
                className="ap-input flex-1 py-1.5 text-[12.5px]"
              />
              <button
                type="button"
                onClick={() => void handleCreateFolder()}
                className="ap-btn ap-btn-primary ap-btn-sm"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Multi-note Merge Options */}
        {isMulti && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
                {t.noteConsolidateOrder}
              </label>
              <select
                value={order}
                onChange={(e) => setOrder(e.target.value as ConsolidateNotesOrder)}
                className="ap-input w-full py-1.5 text-[12.5px]"
              >
                <option value="asc">{t.noteConsolidateOrderAsc}</option>
                <option value="desc">{t.noteConsolidateOrderDesc}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
                {t.noteConsolidateStyle}
              </label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value as ConsolidateNotesStyle)}
                className="ap-input w-full py-1.5 text-[12.5px]"
              >
                <option value="dated_sections">{t.noteConsolidateStyleDated}</option>
                <option value="compact_divider">{t.noteConsolidateStyleCompact}</option>
              </select>
            </div>
          </div>
        )}

        {/* Summary */}
        <div
          className="px-3 py-2.5 rounded-[10px] space-y-1.5"
          style={{ background: 'var(--bg-subtle)' }}
        >
          <div className="text-[12px]" style={{ color: 'var(--text-2)' }}>
            {t.noteConsolidateSummary(
              notes.length,
              summaryStats.tags.length,
              summaryStats.attachments,
            )}
          </div>
          {summaryStats.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {summaryStats.tags.slice(0, 12).map((tg) => (
                <span
                  key={tg}
                  className="ap-pill text-[11px]"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  #{tg}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Remove original notes option */}
        <label className="flex items-center gap-2 text-[13px] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={removeOrigin}
            onChange={(e) => setRemoveOrigin(e.target.checked)}
            className="w-4 h-4 rounded accent-[var(--accent)]"
          />
          <span style={{ color: 'var(--text-2)' }}>{t.noteConsolidateRemoveOrigin}</span>
        </label>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="ap-btn" disabled={submitting}>
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="ap-btn ap-btn-primary"
          >
            <BookOpen className="w-3.5 h-3.5" />
            {t.noteConsolidateSubmit}
          </button>
        </div>
      </div>
    </div>
  );
}
