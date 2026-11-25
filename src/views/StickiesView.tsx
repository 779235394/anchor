import { useMemo, useState } from 'react';
import {
  Check,
  CheckSquare,
  ExternalLink,
  Layers,
  Minimize2,
  Pencil,
  Pin,
  Plus,
  Search,
  StickyNote as StickyNoteIcon,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { isActive, type StickyColor, type StickyNote } from '@/domain/types';
import {
  createStickyNote,
  filterAndSortStickies,
  getStickyChecklistStats,
  getStickyPreviewText,
  isStickyEmpty,
  STICKY_COLORS,
  type StickyStatusFilter,
} from '@/domain/stickies';
import { getDict } from '@/i18n';
import { isTauriRuntime } from '@/services/storage';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/Dialogs';
import { RichTextEditor } from '@/components/RichTextEditor';

function formatStickyTime(ts: number, lang: 'zh' | 'en'): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return lang === 'zh' ? `${mm}月${dd}日 ${hh}:${mi}` : `${mm}/${dd} ${hh}:${mi}`;
}

export function StickiesView() {
  const {
    config,
    data,
    openStickyIds,
    openNewDraftSticky,
    addSticky,
    updateSticky,
    deleteSticky,
    openStickyWindow,
    closeStickyWindow,
    closeAllStickyWindows,
    toggleStickyPinned,
    toggleStickyAutoOpen,
  } = useWorkbenchStore();

  const t = getDict(config.lang);
  const desktop = isTauriRuntime();

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StickyStatusFilter>('all');
  const [colorFilter, setColorFilter] = useState<StickyColor | ''>('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editingStickyId, setEditingStickyId] = useState<string | null>(null);
  const [draftSticky, setDraftSticky] = useState<StickyNote | null>(null);

  const openIdSet = useMemo(() => new Set(openStickyIds), [openStickyIds]);
  const activeStickies = useMemo(
    () => (data.stickies || []).filter((s) => isActive(s) && !isStickyEmpty(s)),
    [data.stickies],
  );
  const openActiveCount = useMemo(
    () => activeStickies.filter((s) => openIdSet.has(s.id)).length,
    [activeStickies, openIdSet],
  );

  const filtered = useMemo(
    () =>
      filterAndSortStickies(activeStickies, {
        query,
        status: statusFilter,
        color: colorFilter,
        openIds: openIdSet,
      }),
    [activeStickies, query, statusFilter, colorFilter, openIdSet],
  );

  const editingSticky = useMemo(
    () => draftSticky ?? activeStickies.find((s) => s.id === editingStickyId) ?? null,
    [draftSticky, activeStickies, editingStickyId],
  );

  const handleCreateSticky = async () => {
    const color = colorFilter || 'yellow';
    if (desktop) {
      await openNewDraftSticky(color);
      return;
    }
    setDraftSticky(createStickyNote({ color, pinned: true, autoOpen: false }));
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Page Header */}
      <header
        className="shrink-0 px-7 pt-6 pb-4 flex items-end justify-between gap-4"
        style={{ borderBottom: '1px solid var(--hairline-soft)' }}
      >
        <div className="min-w-0">
          <h1
            className="text-[22px] font-semibold tracking-[-0.02em]"
            style={{ color: 'var(--text-1)' }}
          >
            {t.stickiesTitle}
          </h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            {t.stickiesSub(activeStickies.length, openActiveCount)}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {desktop && openActiveCount > 0 && (
            <button
              type="button"
              onClick={() => void closeAllStickyWindows()}
              className="ap-btn text-[12.5px]"
            >
              <Layers className="w-3.5 h-3.5" />
              {t.stickiesCloseAllBtn}
            </button>
          )}
          <button
            id="sticky-new-btn"
            type="button"
            onClick={() => void handleCreateSticky()}
            title={
              config.stickyShortcutEnabled && config.stickyShortcut
                ? `${t.stickiesNewBtn} (${config.stickyShortcut})`
                : t.stickiesNewBtn
            }
            className="ap-btn ap-btn-primary text-[13px]"
          >
            <Plus className="w-4 h-4" />
            {t.stickiesNewBtn}
          </button>
        </div>
      </header>

      {/* Scrollable Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-5 space-y-5">
        {!desktop && (
          <div
            className="px-3.5 py-2.5 rounded-[10px] text-[12.5px]"
            style={{
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
            }}
          >
            {t.stickyBrowserHint}
          </div>
        )}

        {/* Filter Bar */}
        {activeStickies.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-[340px]">
              <Search
                className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--text-3)' }}
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.stickiesSearchPh}
                className="ap-input w-full pl-8 pr-7 py-1.5 text-[13px]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:opacity-75"
                  style={{ color: 'var(--text-3)' }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Status Segmented Control */}
            <div
              className="inline-flex items-center p-0.5 rounded-[9px]"
              style={{ background: 'var(--bg-subtle)' }}
            >
              {(
                [
                  { key: 'all', label: t.stickiesFilterAll },
                  ...(desktop ? [{ key: 'open', label: t.stickiesFilterOpen }] : []),
                  { key: 'autoOpen', label: t.stickiesFilterAutoOpen },
                ] as Array<{ key: StickyStatusFilter; label: string }>
              ).map((seg) => {
                const active = statusFilter === seg.key;
                return (
                  <button
                    key={seg.key}
                    type="button"
                    onClick={() => setStatusFilter(seg.key)}
                    className="px-2.5 py-1 rounded-[7px] text-[12px] font-medium ap-ease"
                    style={{
                      background: active ? 'var(--seg-active-bg)' : 'transparent',
                      color: active ? 'var(--text-1)' : 'var(--text-2)',
                      boxShadow: active ? 'var(--seg-active-shadow)' : 'none',
                    }}
                  >
                    {seg.label}
                  </button>
                );
              })}
            </div>

            {/* Color Filter Dots */}
            <div className="flex items-center gap-1.5 ml-auto">
              {STICKY_COLORS.map((c) => {
                const active = colorFilter === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColorFilter(active ? '' : c)}
                    title={c}
                    className="w-5 h-5 rounded-full inline-flex items-center justify-center ap-ease hover:scale-110"
                    style={{
                      background: `var(--sticky-${c}-dot)`,
                      boxShadow: active ? '0 0 0 2px var(--bg-canvas), 0 0 0 3.5px var(--text-1)' : 'none',
                      opacity: colorFilter && !active ? 0.45 : 1,
                    }}
                  >
                    {active && <Check className="w-3 h-3 text-white" strokeWidth={2.8} />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty / No Match / Card Grid */}
        {activeStickies.length === 0 ? (
          <EmptyState
            icon={<StickyNoteIcon className="w-8 h-8" />}
            title={t.stickiesEmptyTitle}
            action={
              <div className="flex flex-col items-center gap-3 max-w-[380px]">
                <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                  {t.stickiesEmptyDesc}
                </p>
                <button
                  type="button"
                  onClick={() => void handleCreateSticky()}
                  className="ap-btn ap-btn-primary text-[13px]"
                >
                  <Plus className="w-4 h-4" />
                  {t.stickiesNewBtn}
                </button>
              </div>
            }
          />
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-[13.5px]" style={{ color: 'var(--text-3)' }}>
            {t.stickiesNoMatch}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-6">
            {filtered.map((sticky) => (
              <StickyHistoryCard
                key={sticky.id}
                sticky={sticky}
                isOpen={openIdSet.has(sticky.id)}
                desktop={desktop}
                lang={config.lang}
                onOpen={() => {
                  if (desktop) {
                    void openStickyWindow(sticky.id);
                  } else {
                    setEditingStickyId(sticky.id);
                  }
                }}
                onCloseWindow={() => void closeStickyWindow(sticky.id)}
                onTogglePin={() => void toggleStickyPinned(sticky.id)}
                onToggleAutoOpen={() => void toggleStickyAutoOpen(sticky.id)}
                onChangeColor={(color) => void updateSticky(sticky.id, { color })}
                onInlineEdit={() => setEditingStickyId(sticky.id)}
                onDelete={() => setDeleteId(sticky.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Inline Editor Modal (works in both browser preview and desktop quick edit) */}
      {editingSticky && (
        <StickyInlineEditModal
          sticky={editingSticky}
          desktop={desktop}
          lang={config.lang}
          onUpdate={(patch) => {
            if (draftSticky) {
              setDraftSticky({ ...draftSticky, ...patch });
            } else {
              void updateSticky(editingSticky.id, patch);
            }
          }}
          onCommit={(content) => {
            const merged = { ...editingSticky, title: '', content };
            if (isStickyEmpty(merged)) {
              if (!draftSticky) {
                void deleteSticky(editingSticky.id);
              }
            } else if (draftSticky) {
              void addSticky({
                title: '',
                content,
                color: merged.color,
                pinned: merged.pinned,
                autoOpen: merged.autoOpen,
                openWindow: false,
              });
            } else if (editingSticky.title !== '' || content !== editingSticky.content) {
              void updateSticky(editingSticky.id, { title: '', content });
            }
            setDraftSticky(null);
            setEditingStickyId(null);
          }}
          onOpenDesktop={() => {
            void openStickyWindow(editingSticky.id);
            setDraftSticky(null);
            setEditingStickyId(null);
          }}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteId}
        title={t.stickyDeleteTitle}
        body={t.stickyDeleteMsg}
        confirmLabel={t.stickyDeleteConfirm}
        cancelLabel={t.cancel}
        danger
        onConfirm={() => {
          if (deleteId) {
            void deleteSticky(deleteId);
            if (editingStickyId === deleteId) setEditingStickyId(null);
          }
          setDeleteId(null);
        }}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}

interface StickyHistoryCardProps {
  sticky: StickyNote;
  isOpen: boolean;
  desktop: boolean;
  lang: 'zh' | 'en';
  onOpen: () => void;
  onCloseWindow: () => void;
  onTogglePin: () => void;
  onToggleAutoOpen: () => void;
  onChangeColor: (color: StickyColor) => void;
  onInlineEdit: () => void;
  onDelete: () => void;
}

function StickyHistoryCard({
  sticky,
  isOpen,
  desktop,
  lang,
  onOpen,
  onCloseWindow,
  onTogglePin,
  onToggleAutoOpen,
  onChangeColor,
  onInlineEdit,
  onDelete,
}: StickyHistoryCardProps) {
  const t = getDict(lang);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const preview = getStickyPreviewText(sticky);
  const checklist = getStickyChecklistStats(sticky.content);

  const bg = `var(--sticky-${sticky.color}-bg)`;
  const bar = `var(--sticky-${sticky.color}-bar)`;
  const border = `var(--sticky-${sticky.color}-border)`;
  const accent = `var(--sticky-${sticky.color}-accent)`;

  return (
    <div
      className="rounded-[14px] flex flex-col overflow-hidden ap-ease group relative hover:-translate-y-[1px]"
      style={{
        background: bg,
        border: `1px solid ${border}`,
        boxShadow: 'var(--shadow-card)',
        minHeight: 204,
      }}
      onMouseLeave={() => setPaletteOpen(false)}
    >
      {/* Card Top Accent Strip */}
      <div
        className="px-3 py-2 flex items-center justify-between gap-2 shrink-0"
        style={{
          background: bar,
          borderBottom: `1px solid ${border}`,
        }}
      >
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {isOpen && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full text-[10.5px] font-semibold"
              style={{
                background: 'var(--status-green-soft)',
                color: 'var(--status-green)',
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: 'var(--status-green)' }}
              />
              {t.stickyBadgeOpen}
            </span>
          )}
          {sticky.pinned && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-full text-[10.5px] font-medium"
              style={{
                background: 'color-mix(in srgb, currentColor 11%, transparent)',
                color: accent,
              }}
            >
              <Pin className="w-2.5 h-2.5" fill="currentColor" />
              {t.stickyBadgePinned}
            </span>
          )}
          {sticky.autoOpen && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-full text-[10.5px] font-medium"
              style={{
                background: 'var(--status-orange-soft)',
                color: 'var(--status-orange)',
              }}
            >
              <Zap className="w-2.5 h-2.5" />
              {t.stickyBadgeAutoOpen}
            </span>
          )}
        </div>

        {/* Color Swatch Popover Trigger */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPaletteOpen((v) => !v);
            }}
            title={t.stickyColorTip}
            className="w-4 h-4 rounded-full inline-block ap-ease hover:scale-110"
            style={{
              background: `var(--sticky-${sticky.color}-dot)`,
              boxShadow: '0 0 0 1.5px rgba(255,255,255,0.7)',
            }}
          />
          {paletteOpen && (
            <div
              className="absolute right-0 top-6 z-20 p-1.5 rounded-[9px] flex items-center gap-1.5"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--hairline)',
                boxShadow: 'var(--shadow-modal)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {STICKY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    onChangeColor(c);
                    setPaletteOpen(false);
                  }}
                  className="w-4 h-4 rounded-full inline-flex items-center justify-center hover:scale-110 ap-ease"
                  style={{ background: `var(--sticky-${c}-dot)` }}
                >
                  {sticky.color === c && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Card Clickable Body (opens inline preview/editor; desktop popup is triggered explicitly via footer button) */}
      <button
        type="button"
        onClick={onInlineEdit}
        className="flex-1 px-3.5 pt-3 pb-2.5 text-left flex flex-col gap-1.5 min-h-[112px] overflow-hidden"
      >
        <div
          className="text-[13.5px] leading-[1.6] whitespace-pre-wrap line-clamp-5 overflow-hidden text-ellipsis break-words"
          style={{ color: 'var(--text-1)' }}
        >
          {preview}
        </div>
        {checklist.total > 0 && (
          <div
            className="mt-auto pt-1 inline-flex items-center gap-1 text-[11px] font-medium"
            style={{ color: accent }}
          >
            <CheckSquare className="w-3 h-3" />
            {checklist.done}/{checklist.total}
          </div>
        )}
      </button>

      {/* Card Footer Controls */}
      <div
        className="px-3 py-2 flex items-center justify-between gap-2 shrink-0"
        style={{
          borderTop: `1px solid color-mix(in srgb, ${border} 65%, transparent)`,
        }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {desktop ? (
            isOpen ? (
              <>
                <button
                  type="button"
                  onClick={onOpen}
                  className="px-2 py-1 rounded-[7px] text-[11.5px] font-medium inline-flex items-center gap-1 ap-ease"
                  style={{
                    background: 'color-mix(in srgb, currentColor 12%, transparent)',
                    color: accent,
                  }}
                >
                  <ExternalLink className="w-3 h-3" />
                  {t.stickyFocusDesktop}
                </button>
                <button
                  type="button"
                  onClick={onCloseWindow}
                  className="px-2 py-1 rounded-[7px] text-[11.5px] font-medium inline-flex items-center gap-1 ap-ease hover:bg-black/6 dark:hover:bg-white/10"
                  style={{ color: 'var(--text-2)' }}
                >
                  <Minimize2 className="w-3 h-3" />
                  {t.stickyCloseDesktop}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onOpen}
                className="px-2.5 py-1 rounded-[7px] text-[11.5px] font-medium inline-flex items-center gap-1 ap-ease"
                style={{
                  background: 'color-mix(in srgb, currentColor 12%, transparent)',
                  color: accent,
                }}
              >
                <ExternalLink className="w-3 h-3" />
                {t.stickyOpenDesktop}
              </button>
            )
          ) : (
            <span className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
              {formatStickyTime(sticky.updatedAt, lang)}
            </span>
          )}
        </div>

        {/* Per-sticky Quick Toggles */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onTogglePin}
            title={sticky.pinned ? t.stickyPinOnTip : t.stickyPinOffTip}
            className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center ap-ease hover:bg-black/6 dark:hover:bg-white/10"
            style={{ color: sticky.pinned ? accent : 'var(--text-3)' }}
          >
            <Pin className="w-3.5 h-3.5" fill={sticky.pinned ? 'currentColor' : 'none'} />
          </button>

          <button
            type="button"
            onClick={onToggleAutoOpen}
            title={t.stickyAutoOpenTip}
            className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center ap-ease hover:bg-black/6 dark:hover:bg-white/10"
            style={{ color: sticky.autoOpen ? 'var(--status-orange)' : 'var(--text-3)' }}
          >
            <Zap className="w-3.5 h-3.5" fill={sticky.autoOpen ? 'currentColor' : 'none'} />
          </button>

          <button
            type="button"
            onClick={onInlineEdit}
            title={t.edit}
            className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center ap-ease hover:bg-black/6 dark:hover:bg-white/10"
            style={{ color: 'var(--text-3)' }}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onDelete}
            title={t.delete}
            className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center ap-ease hover:bg-[var(--status-red-soft)]"
            style={{ color: 'var(--text-3)' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Subtle timestamp sub-row in desktop mode */}
      {desktop && (
        <div
          className="px-3 pb-1.5 text-[10.5px]"
          style={{ color: 'var(--text-3)' }}
        >
          {formatStickyTime(sticky.updatedAt, lang)}
        </div>
      )}
    </div>
  );
}

interface StickyInlineEditModalProps {
  sticky: StickyNote;
  desktop: boolean;
  lang: 'zh' | 'en';
  onUpdate: (patch: Partial<Pick<StickyNote, 'title' | 'content' | 'color' | 'pinned' | 'autoOpen'>>) => void;
  onCommit: (content: string) => void;
  onOpenDesktop: () => void;
}

function StickyInlineEditModal({
  sticky,
  desktop,
  lang,
  onUpdate,
  onCommit,
  onOpenDesktop,
}: StickyInlineEditModalProps) {
  const t = getDict(lang);
  const initialContent = [sticky.title.trim(), sticky.content].filter(Boolean).join('\n');
  const [content, setContent] = useState(initialContent);

  const bg = `var(--sticky-${sticky.color}-bg)`;
  const bar = `var(--sticky-${sticky.color}-bar)`;
  const border = `var(--sticky-${sticky.color}-border)`;
  const accent = `var(--sticky-${sticky.color}-accent)`;

  const handleSaveAndClose = () => {
    onCommit(content);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--backdrop-mask)', backdropFilter: 'blur(5px)' }}
      onClick={handleSaveAndClose}
    >
      <div
        className="w-full max-w-[460px] rounded-[16px] overflow-hidden flex flex-col"
        style={{
          background: bg,
          border: `1px solid ${border}`,
          boxShadow: 'var(--shadow-modal)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-4 py-2.5 flex items-center justify-between gap-2"
          style={{
            background: bar,
            borderBottom: `1px solid ${border}`,
          }}
        >
          <div className="flex items-center gap-1.5">
            {STICKY_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onUpdate({ color: c })}
                className="w-4 h-4 rounded-full inline-flex items-center justify-center ap-ease hover:scale-110"
                style={{
                  background: `var(--sticky-${c}-dot)`,
                  boxShadow:
                    sticky.color === c ? '0 0 0 2px var(--bg-elevated), 0 0 0 3.5px var(--text-1)' : 'none',
                }}
              />
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onUpdate({ pinned: !sticky.pinned })}
              title={sticky.pinned ? t.stickyPinOnTip : t.stickyPinOffTip}
              className="px-2 py-1 rounded-[7px] text-[11.5px] font-medium inline-flex items-center gap-1 ap-ease"
              style={{
                background: sticky.pinned ? 'color-mix(in srgb, currentColor 12%, transparent)' : 'transparent',
                color: sticky.pinned ? accent : 'var(--text-3)',
              }}
            >
              <Pin className="w-3 h-3" fill={sticky.pinned ? 'currentColor' : 'none'} />
              {t.stickyBadgePinned}
            </button>
            <button
              type="button"
              onClick={() => onUpdate({ autoOpen: !sticky.autoOpen })}
              title={t.stickyAutoOpenTip}
              className="px-2 py-1 rounded-[7px] text-[11.5px] font-medium inline-flex items-center gap-1 ap-ease"
              style={{
                background: sticky.autoOpen ? 'var(--status-orange-soft)' : 'transparent',
                color: sticky.autoOpen ? 'var(--status-orange)' : 'var(--text-3)',
              }}
            >
              <Zap className="w-3 h-3" fill={sticky.autoOpen ? 'currentColor' : 'none'} />
              {t.stickyBadgeAutoOpen}
            </button>
            <button
              type="button"
              onClick={handleSaveAndClose}
              className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center hover:bg-black/8 dark:hover:bg-white/10"
              style={{ color: 'var(--text-2)' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 flex flex-col gap-2 max-h-[65vh] overflow-y-auto ap-sticky-editor">
          <RichTextEditor
            value={content}
            onChange={setContent}
            placeholder={t.stickyBodyPh}
            minHeight={200}
            maxHeight={420}
            variant="plain"
            showToolbar={false}
            autoFocus
          />
        </div>

        <div
          className="px-4 py-2.5 flex items-center justify-between gap-2"
          style={{ borderTop: `1px solid ${border}` }}
        >
          {desktop ? (
            <button
              type="button"
              onClick={() => {
                if (sticky.title !== '' || content !== sticky.content) {
                  onUpdate({ title: '', content });
                }
                onOpenDesktop();
              }}
              className="ap-btn text-[12px]"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {t.stickyOpenDesktop}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={handleSaveAndClose}
            className="ap-btn ap-btn-primary text-[12.5px]"
          >
            {t.save}
          </button>
        </div>
      </div>
    </div>
  );
}
