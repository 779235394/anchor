import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckSquare,
  ExternalLink,
  MoreHorizontal,
  Palette,
  Pin,
  Plus,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { isActive, type AppConfig, type StickyColor, type StickyNote } from '@/domain/types';
import {
  getStickyChecklistStats,
  isStickyEmpty,
  normalizeSticky,
  STICKY_COLORS,
  STICKY_OPACITY_PRESETS,
} from '@/domain/stickies';
import { getDict } from '@/i18n';
import { isMacPlatform, isTauriRuntime, storageApi } from '@/services/storage';
import { RichTextEditor, type RichTextEditorHandle } from '@/components/RichTextEditor';

interface StickyNoteWindowProps {
  stickyId: string;
  draft?: boolean;
  initialColor?: StickyColor;
}

function stickyCssVars(color: StickyColor) {
  return {
    bg: `var(--sticky-${color}-bg)`,
    bar: `var(--sticky-${color}-bar)`,
    border: `var(--sticky-${color}-border)`,
    dot: `var(--sticky-${color}-dot)`,
    accent: `var(--sticky-${color}-accent)`,
  };
}

export function StickyNoteWindow({
  stickyId,
  draft = false,
  initialColor = 'yellow',
}: StickyNoteWindowProps) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [sticky, setSticky] = useState<StickyNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [opacity, setOpacity] = useState(1);
  const [saving, setSaving] = useState(false);

  const [colorOpen, setColorOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const stickyRef = useRef<StickyNote | null>(null);
  const contentRef = useRef<string>('');
  const dirtyRef = useRef(false);
  const persistedRef = useRef(!draft);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyEditorRef = useRef<RichTextEditorHandle | null>(null);

  stickyRef.current = sticky;
  contentRef.current = content;

  const lang = config?.lang ?? 'zh';
  const t = getDict(lang);
  const modKey = isMacPlatform() ? '⌘' : 'Ctrl+';

  // Ensure WKWebView / WebView2 root canvas stays 100% transparent behind rounded corners
  useEffect(() => {
    document.documentElement.classList.add('ap-sticky-root');
    return () => {
      document.documentElement.classList.remove('ap-sticky-root');
    };
  }, []);

  const applyTheme = useCallback((cfg: AppConfig) => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const resolved = cfg.theme === 'system' ? (mq.matches ? 'dark' : 'light') : cfg.theme;
    root.dataset.theme = resolved;
    root.dataset.accent = cfg.accent;
    root.lang = cfg.lang === 'en' ? 'en' : 'zh-CN';
  }, []);

  const persistNow = useCallback(async (override?: Partial<StickyNote>) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const base = stickyRef.current;
    if (!base) return;
    const next: StickyNote = {
      ...base,
      title: '',
      content: contentRef.current,
      ...override,
      updatedAt: Date.now(),
    };
    stickyRef.current = next;
    setSticky(next);
    dirtyRef.current = false;

    const empty = isStickyEmpty(next);
    const isDeleting = !!next.deletedAt;

    // Never persist a brand-new empty draft until the user writes actual content
    if (!isDeleting && empty && !persistedRef.current) {
      setSaving(false);
      return;
    }

    setSaving(true);
    try {
      await storageApi.upsertSticky(next);
      persistedRef.current = true;
    } finally {
      setSaving(false);
    }
  }, []);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    setSaving(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persistNow();
    }, 300);
  }, [persistNow]);

  // Hydrate config, sticky data, bounds, and live event listener
  useEffect(() => {
    let active = true;
    let unlistenStickies: (() => void) | null = null;

    const boot = async () => {
      try {
        const [cfg, loaded, bounds] = await Promise.all([
          storageApi.getAppConfig(),
          storageApi.loadWorkspace(),
          storageApi.getStickyBounds(stickyId),
        ]);
        if (!active) return;
        setConfig(cfg);
        applyTheme(cfg);
        if (bounds && typeof bounds.opacity === 'number') {
          setOpacity(bounds.opacity);
        }
        const found = (loaded.data.stickies || []).find((s) => s.id === stickyId && isActive(s));
        if (found) {
          const norm = normalizeSticky(found);
          const mergedContent = [norm.title.trim(), norm.content].filter(Boolean).join('\n');
          persistedRef.current = true;
          setSticky({ ...norm, title: '', content: mergedContent });
          setContent(mergedContent);
          setTimeout(() => {
            if (!mergedContent) {
              bodyEditorRef.current?.focus();
            }
          }, 60);
        } else if (draft) {
          const now = Date.now();
          const localDraft: StickyNote = {
            id: stickyId,
            title: '',
            content: '',
            color: initialColor,
            pinned: true,
            autoOpen: false,
            createdAt: now,
            updatedAt: now,
          };
          persistedRef.current = false;
          setSticky(localDraft);
          setContent('');
          setTimeout(() => {
            bodyEditorRef.current?.focus();
          }, 60);
        } else {
          setSticky(null);
        }
      } finally {
        if (active) setLoading(false);
      }

      unlistenStickies = await storageApi.onStickiesChanged((incoming) => {
        if (!active || incoming.id !== stickyId) return;
        const norm = normalizeSticky(incoming);
        if (!isActive(norm)) {
          setSticky(null);
          return;
        }
        const cur = stickyRef.current;
        if (cur && (norm.updatedAt || 0) < (cur.updatedAt || 0)) return;
        const mergedContent = [norm.title.trim(), norm.content].filter(Boolean).join('\n');
        setSticky({ ...norm, title: '', content: mergedContent });
        if (!dirtyRef.current) {
          setContent(mergedContent);
        }
      });
    };

    void boot();

    return () => {
      active = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (unlistenStickies) unlistenStickies();
    };
  }, [stickyId, draft, initialColor, applyTheme]);

  // Listen for OS theme changes when in system mode
  useEffect(() => {
    if (!config || config.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme(config);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [config, applyTheme]);

  const handleCloseWindow = useCallback(async () => {
    const emptyNow = isStickyEmpty({ title: '', content: contentRef.current });
    if (dirtyRef.current && (!emptyNow || persistedRef.current)) {
      await persistNow();
    }
    await storageApi.closeStickyWindow(stickyId);
  }, [persistNow, stickyId]);

  const handleCreateSibling = useCallback(async () => {
    const emptyNow = isStickyEmpty({ title: '', content: contentRef.current });
    if (dirtyRef.current && (!emptyNow || persistedRef.current)) {
      await persistNow();
    }
    await storageApi.openNewDraftSticky(stickyRef.current?.color ?? 'yellow', stickyId);
  }, [persistNow, stickyId]);

  const handleTogglePin = useCallback(async () => {
    const cur = stickyRef.current;
    if (!cur) return;
    const nextPinned = !cur.pinned;
    await persistNow({ pinned: nextPinned });
    await storageApi.setStickyPinned(stickyId, nextPinned);
  }, [persistNow, stickyId]);

  const handleSelectColor = useCallback(
    async (color: StickyColor) => {
      setColorOpen(false);
      await persistNow({ color });
    },
    [persistNow],
  );

  const handleToggleAutoOpen = useCallback(async () => {
    const cur = stickyRef.current;
    if (!cur) return;
    await persistNow({ autoOpen: !cur.autoOpen });
  }, [persistNow]);

  // Flush pending edits on blur / unload & handle in-window sticky shortcuts
  useEffect(() => {
    const onBlur = () => {
      if (dirtyRef.current) void persistNow();
    };
    const onUnload = () => {
      if (dirtyRef.current) void persistNow();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setColorOpen(false);
        setMenuOpen(false);
        setConfirmDelete(false);
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const lower = e.key.toLowerCase();
      if (lower === 'w') {
        e.preventDefault();
        void handleCloseWindow();
        return;
      }
      if (lower === 'n') {
        e.preventDefault();
        void handleCreateSibling();
        return;
      }
      if (lower === 'p') {
        e.preventDefault();
        void handleTogglePin();
        return;
      }
      if (e.shiftKey && lower === 'a') {
        e.preventDefault();
        void handleToggleAutoOpen();
        return;
      }
      if (!e.shiftKey && !e.altKey) {
        const idx = Number(e.key) - 1;
        if (idx >= 0 && idx < STICKY_COLORS.length) {
          e.preventDefault();
          void handleSelectColor(STICKY_COLORS[idx]);
        }
      }
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [
    persistNow,
    handleCloseWindow,
    handleCreateSibling,
    handleTogglePin,
    handleToggleAutoOpen,
    handleSelectColor,
  ]);

  const handleSetOpacity = async (val: number) => {
    setOpacity(val);
    await storageApi.setStickyOpacity(stickyId, val);
  };

  const handleDelete = async () => {
    const cur = stickyRef.current;
    if (!cur) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    dirtyRef.current = false;
    if (!persistedRef.current) {
      await storageApi.closeStickyWindow(stickyId);
      return;
    }
    const now = Date.now();
    await storageApi.upsertSticky({
      ...cur,
      deletedAt: now,
      updatedAt: now,
    });
  };

  const checklistStats = useMemo(() => getStickyChecklistStats(content), [content]);

  if (loading) {
    return (
      <div
        className="h-full w-full rounded-[14px] flex items-center justify-center text-[12.5px]"
        style={{ background: 'var(--sticky-yellow-bg)', color: 'var(--text-3)' }}
      >
        …
      </div>
    );
  }

  if (!sticky) {
    return (
      <div
        className="h-full w-full rounded-[14px] flex flex-col items-center justify-center gap-3 p-4 text-center"
        style={{ background: 'var(--bg-elevated)', color: 'var(--text-3)' }}
      >
        <div className="text-[13px]">{t.stickyNotFound}</div>
        <button
          type="button"
          onClick={() => void storageApi.closeStickyWindow(stickyId)}
          className="ap-btn text-[12px]"
        >
          {t.close}
        </button>
      </div>
    );
  }

  const vars = stickyCssVars(sticky.color);
  // On macOS, native NSPanel alphaValue controls window translucency; on Windows/web fallback to root opacity.
  const cssOpacity = isTauriRuntime() && isMacPlatform() ? 1 : opacity;

  return (
    <div
      className="h-full w-full rounded-[14px] flex flex-col overflow-hidden select-none relative"
      style={{
        background: vars.bg,
        boxShadow: `inset 0 0 0 1px ${vars.border}, inset 0 1px 0 var(--sticky-specular)`,
        opacity: cssOpacity,
      }}
      onClick={() => {
        if (colorOpen) setColorOpen(false);
        if (menuOpen) {
          setMenuOpen(false);
          setConfirmDelete(false);
        }
      }}
    >
      {/* Top 34px Draggable Bar */}
      <header
        data-tauri-drag-region="deep"
        className="h-[34px] shrink-0 px-1.5 flex items-center justify-between gap-1"
        style={{
          background: vars.bar,
          borderBottom: `1px solid ${vars.border}`,
        }}
      >
        {/* Left: New Sticky */}
        <button
          type="button"
          data-tauri-drag-region="false"
          onClick={(e) => {
            e.stopPropagation();
            void handleCreateSibling();
          }}
          title={`${t.stickyNewWindowTip} (${modKey}N)`}
          className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle-hover)]"
          style={{ color: 'var(--text-2)' }}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>

        {/* Center drag spacer */}
        <div className="flex-1 h-full cursor-move" />

        {/* Right Controls */}
        <div
          data-tauri-drag-region="false"
          className="flex items-center gap-0.5 relative"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Independent Cross-Fullscreen Pin Toggle */}
          <button
            type="button"
            onClick={() => void handleTogglePin()}
            title={`${sticky.pinned ? t.stickyPinOnTip : t.stickyPinOffTip} (${modKey}P)`}
            className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center ap-ease"
            style={{
              background: sticky.pinned ? 'color-mix(in srgb, currentColor 14%, transparent)' : 'transparent',
              color: sticky.pinned ? vars.accent : 'var(--text-3)',
            }}
          >
            <Pin
              className="w-3.5 h-3.5"
              style={{
                transform: sticky.pinned ? 'rotate(0deg)' : 'rotate(45deg)',
                transition: 'transform 160ms ease',
              }}
              fill={sticky.pinned ? 'currentColor' : 'none'}
            />
          </button>

          {/* Color Picker */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setColorOpen((v) => !v);
                setMenuOpen(false);
                setConfirmDelete(false);
              }}
              title={t.stickyColorTip}
              className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle-hover)]"
              style={{ color: 'var(--text-2)' }}
            >
              <Palette className="w-3.5 h-3.5" />
            </button>

            {colorOpen && (
              <div
                className="absolute right-0 top-[30px] z-30 p-2 rounded-[10px] ap-glass-float flex items-center gap-1.5"
              >
                {STICKY_COLORS.map((c) => {
                  const selected = sticky.color === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => void handleSelectColor(c)}
                      className="w-5 h-5 rounded-full inline-flex items-center justify-center ap-ease hover:scale-110"
                      style={{
                        background: `var(--sticky-${c}-dot)`,
                        boxShadow: selected ? '0 0 0 2px var(--bg-elevated), 0 0 0 3.5px var(--text-1)' : 'none',
                      }}
                    >
                      {selected && <Check className="w-3 h-3 text-white drop-shadow" strokeWidth={2.6} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* More Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setMenuOpen((v) => !v);
                setColorOpen(false);
                setConfirmDelete(false);
              }}
              className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle-hover)]"
              style={{ color: 'var(--text-2)' }}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 top-[30px] z-30 w-[212px] p-1.5 rounded-[10px] ap-glass-float space-y-1 text-[12.5px]"
                style={{
                  color: 'var(--text-1)',
                }}
              >
                {/* Auto-open on startup switch */}
                <button
                  type="button"
                  onClick={() => void handleToggleAutoOpen()}
                  title={t.stickyAutoOpenTip}
                  className="w-full px-2.5 py-1.5 rounded-[7px] flex items-center justify-between gap-2 ap-ease hover:bg-[var(--bg-subtle)]"
                >
                  <span className="inline-flex items-center gap-1.5 truncate">
                    <Zap
                      className="w-3.5 h-3.5 shrink-0"
                      style={{ color: sticky.autoOpen ? 'var(--status-orange)' : 'var(--text-3)' }}
                    />
                    <span className="truncate">{t.stickyAutoOpenLabel}</span>
                  </span>
                  <span
                    className="w-7 h-4 rounded-full p-[2px] inline-flex items-center ap-ease shrink-0"
                    style={{
                      background: sticky.autoOpen ? 'var(--accent)' : 'var(--bg-subtle-hover)',
                      justifyContent: sticky.autoOpen ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <span className="w-3 h-3 rounded-full bg-white shadow-sm" />
                  </span>
                </button>

                {/* Opacity presets */}
                <div className="px-2.5 py-1.5 space-y-1.5">
                  <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                    {t.stickyOpacityLabel}
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {STICKY_OPACITY_PRESETS.map((preset) => {
                      const activePreset = Math.abs(opacity - preset) < 0.03;
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => void handleSetOpacity(preset)}
                          className="py-1 rounded-[6px] text-[11px] font-medium ap-ease"
                          style={{
                            background: activePreset ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                            color: activePreset ? 'var(--accent)' : 'var(--text-2)',
                          }}
                        >
                          {Math.round(preset * 100)}%
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Open management view in main window */}
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void storageApi.openStickiesInMain();
                  }}
                  className="w-full px-2.5 py-1.5 rounded-[7px] flex items-center gap-1.5 ap-ease hover:bg-[var(--bg-subtle)] text-left"
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-3)' }} />
                  <span className="truncate">{t.stickyManageAll}</span>
                </button>

                <div className="my-1" style={{ borderTop: '1px solid var(--hairline-soft)' }} />

                {/* Delete with inline 2-step confirmation */}
                {!confirmDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="w-full px-2.5 py-1.5 rounded-[7px] flex items-center gap-1.5 ap-ease hover:bg-[var(--status-red-soft)] text-left"
                    style={{ color: 'var(--status-red)' }}
                  >
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{t.delete}</span>
                  </button>
                ) : (
                  <div className="px-2 py-1 flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="flex-1 py-1 rounded-[6px] text-[11.5px]"
                      style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
                    >
                      {t.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete()}
                      className="flex-1 py-1 rounded-[6px] text-[11.5px] font-medium text-white"
                      style={{ background: 'var(--status-red)' }}
                    >
                      {t.stickyDeleteConfirm}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Close Window Only (Content Preserved) */}
          <button
            type="button"
            onClick={() => void handleCloseWindow()}
            title={`${t.stickyCloseWindowTip} (${modKey}W)`}
            className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle-hover)]"
            style={{ color: 'var(--text-2)' }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Editable Sticky Canvas */}
      <div className="flex-1 min-h-0 flex flex-col px-3 pt-2.5 pb-1 overflow-y-auto select-text">
        <div className="flex-1 min-h-[140px] ap-sticky-editor">
          <RichTextEditor
            value={content}
            onChange={(md) => {
              setContent(md);
              scheduleSave();
            }}
            placeholder={t.stickyBodyPh}
            minHeight={160}
            maxHeight={4000}
            variant="plain"
            showToolbar={false}
            editorRef={bodyEditorRef}
          />
        </div>
      </div>

      {/* Subtle Bottom Status Strip */}
      <footer
        className="h-[24px] shrink-0 px-3 flex items-center justify-between text-[10.5px]"
        style={{
          color: 'var(--text-3)',
          borderTop: `1px solid color-mix(in srgb, ${vars.border} 65%, transparent)`,
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span>{saving ? t.stickySavingLabel : t.stickySavedLabel}</span>
          {sticky.autoOpen && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-[0.5px] rounded-full text-[10px] font-medium"
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
        {checklistStats.total > 0 && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <CheckSquare className="w-3 h-3" />
            {checklistStats.done}/{checklistStats.total}
          </span>
        )}
      </footer>
    </div>
  );
}
