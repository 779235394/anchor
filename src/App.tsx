import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { ViewKey } from '@/domain/types';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { Sidebar } from '@/components/Sidebar';
import { CommandPalette } from '@/components/CommandPalette';
import { QuickCaptureWindow } from '@/components/QuickCaptureWindow';
import { UpdatePromptModal } from '@/components/UpdatePromptModal';
import { MobileAccessModal } from '@/components/MobileAccessModal';
import { ToastHost } from '@/components/Dialogs';
import { AUTO_UPDATE_INTERVAL_MS } from '@/services/updater';
import { isTauriRuntime } from '@/services/storage';
import {
  getDemoFlagshipDocPath,
  getDemoMobileServerStatus,
  getDemoQueryParams,
  isWebsiteDemoMode,
  resetDemoLanguage,
  saveDemoConfig,
} from '@/services/demoBridge';
import { TasksView } from '@/views/TasksView';
import { KanbanView } from '@/views/KanbanView';
import { ScheduleView } from '@/views/ScheduleView';
import { KnowledgeView } from '@/views/KnowledgeView';
import { NotesView } from '@/views/NotesView';
import { StickiesView } from '@/views/StickiesView';
import { ProjectsView } from '@/views/ProjectsView';
import { ReviewView } from '@/views/ReviewView';
import { SettingsView } from '@/views/SettingsView';

const VIEW_SHORTCUTS: ViewKey[] = [
  'tasks',
  'kanban',
  'schedule',
  'projects',
  'knowledge',
  'notes',
  'stickies',
  'review',
  'settings',
];

export function App() {
  const {
    ready,
    config,
    view,
    warnings,
    commandPaletteOpen,
    quickCapturePreviewOpen,
    mobileModalOpen,
    init,
    setView,
    openInspector,
    setCommandPaletteOpen,
    setQuickCapturePreviewOpen,
    setMobileModalOpen,
    flushPendingWrites,
    handleExternalChange,
    checkForUpdates,
    checkForUpdatesIfStale,
    dismissWarning,
  } = useWorkbenchStore();

  // Initialize workspace & listeners
  useEffect(() => {
    void init();
  }, [init]);

  // Apply Light / Dark / System theme + Accent color to document root
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const resolved =
        config.theme === 'system' ? (mq.matches ? 'dark' : 'light') : config.theme;
      root.dataset.theme = resolved;
      root.dataset.accent = config.accent;
      root.lang = config.lang === 'en' ? 'en' : 'zh-CN';
    };

    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [config.theme, config.accent, config.lang]);

  // Flush writes on hide/unload and verify external changes + stale update checks on focus
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        void flushPendingWrites();
      } else {
        void checkForUpdatesIfStale();
      }
    };
    const onUnload = () => {
      void flushPendingWrites();
    };
    const onFocus = () => {
      void handleExternalChange();
      void checkForUpdatesIfStale();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('focus', onFocus);
    };
  }, [flushPendingWrites, handleExternalChange, checkForUpdatesIfStale]);

  // Periodic silent version check every 1 hour (desktop app only)
  useEffect(() => {
    if (!ready || !isTauriRuntime()) return;
    const timer = setInterval(() => {
      void checkForUpdates(true);
    }, AUTO_UPDATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [ready, checkForUpdates]);

  // Website ?demo=1 director bridge (strictly disabled in Tauri desktop runtime)
  useEffect(() => {
    if (!ready || !isWebsiteDemoMode()) return;

    const initial = getDemoQueryParams();
    if (initial.view) {
      setView(initial.view);
      if (initial.view === 'knowledge') {
        useWorkbenchStore.getState().setActiveDocPath(getDemoFlagshipDocPath(initial.lang));
      }
    }

    try {
      window.parent?.postMessage({ type: 'ANCHOR_DEMO_READY' }, window.location.origin);
    } catch {
      // ignore standalone preview
    }

    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin || !ev.data || typeof ev.data !== 'object') return;
      const msg = ev.data as {
        type?: string;
        view?: ViewKey;
        theme?: 'dark' | 'light';
        accent?: 'blue' | 'indigo' | 'teal' | 'graphite';
        lang?: 'zh' | 'en';
        overlay?: 'quick-capture' | 'spotlight' | 'mobile' | 'none';
      };

      const st = useWorkbenchStore.getState();

      if (msg.type === 'ANCHOR_DEMO_SET_VIEW' && msg.view) {
        st.setCommandPaletteOpen(false);
        st.setQuickCapturePreviewOpen(false);
        st.setMobileModalOpen(false);
        st.openInspector(null);
        st.setView(msg.view);
        if (msg.view === 'knowledge') {
          st.setActiveDocPath(getDemoFlagshipDocPath(st.config.lang));
        }
      } else if (msg.type === 'ANCHOR_DEMO_SET_THEME') {
        const nextCfg = {
          ...st.config,
          theme: msg.theme ?? st.config.theme,
          accent: msg.accent ?? st.config.accent,
        };
        saveDemoConfig(nextCfg);
        useWorkbenchStore.setState({ config: nextCfg });
      } else if (msg.type === 'ANCHOR_DEMO_SET_LANG' && msg.lang && msg.lang !== st.config.lang) {
        const nextData = resetDemoLanguage(msg.lang, st.config);
        const nextCfg = { ...st.config, lang: msg.lang };
        saveDemoConfig(nextCfg);
        useWorkbenchStore.setState({
          config: nextCfg,
          data: nextData,
          activeDocPath: st.view === 'knowledge' ? getDemoFlagshipDocPath(msg.lang) : st.activeDocPath,
        });
      } else if (msg.type === 'ANCHOR_DEMO_OPEN_OVERLAY') {
        st.setCommandPaletteOpen(msg.overlay === 'spotlight');
        st.setQuickCapturePreviewOpen(msg.overlay === 'quick-capture');
        if (msg.overlay === 'mobile') {
          useWorkbenchStore.setState({ mobileStatus: getDemoMobileServerStatus() });
          st.setMobileModalOpen(true);
        } else {
          st.setMobileModalOpen(false);
        }
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [ready, setView]);

  // Global keyboard shortcuts: Cmd/Ctrl + K (Spotlight), Cmd/Ctrl + N (focus quick input), Esc, Cmd/Ctrl + 1..7
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mobileModalOpen) {
          setMobileModalOpen(false);
          return;
        }
        if (quickCapturePreviewOpen) {
          setQuickCapturePreviewOpen(false);
          return;
        }
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
          return;
        }
        openInspector(null);
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const lower = e.key.toLowerCase();
      if (lower === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
        return;
      }
      if (lower === 'n') {
        const input = document.getElementById('quick-capture-input');
        if (input) {
          e.preventDefault();
          const editable = input.querySelector<HTMLElement>('.ProseMirror') || input;
          editable.focus();
          return;
        }
        const newStickyBtn = document.getElementById('sticky-new-btn') as HTMLButtonElement | null;
        if (newStickyBtn) {
          e.preventDefault();
          newStickyBtn.click();
        }
        return;
      }
      const num = Number(e.key);
      if (num >= 1 && num <= VIEW_SHORTCUTS.length) {
        e.preventDefault();
        setView(VIEW_SHORTCUTS[num - 1]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    commandPaletteOpen,
    quickCapturePreviewOpen,
    mobileModalOpen,
    openInspector,
    setCommandPaletteOpen,
    setQuickCapturePreviewOpen,
    setMobileModalOpen,
    setView,
  ]);

  if (!ready) {
    return (
      <div
        data-tauri-drag-region="deep"
        className="h-full flex items-center justify-center text-[13px] select-none"
        style={{
          backgroundColor: 'var(--bg-canvas)',
          backgroundImage: 'var(--bg-canvas-glow)',
          color: 'var(--text-3)',
        }}
      >
        Loading Anchor…
      </div>
    );
  }

  return (
    <div
      className="h-full w-full flex overflow-hidden"
      style={{
        backgroundColor: 'var(--bg-canvas)',
        backgroundImage: 'var(--bg-canvas-glow)',
      }}
    >
      <Sidebar />

      {/* Right Inset Floating Workspace Shell */}
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden pr-2.5 pb-2.5">
        {/* Seamless 10px Top Edge Drag Strip above the floating workspace shell */}
        <div data-tauri-drag-region="deep" className="h-2.5 shrink-0" />

        {/* Recovery warnings banner if any corrupted JSON fell back to snapshot */}
        {warnings.length > 0 && (
          <div data-tauri-drag-region="deep" className="pb-2 space-y-2 shrink-0">
            {warnings.map((w, i) => (
              <div
                key={i}
                className="px-3.5 py-2.5 rounded-[12px] flex items-center gap-2.5 text-[12.5px]"
                style={{
                  background: 'var(--status-orange-soft)',
                  border: '1px solid color-mix(in srgb, var(--status-orange) 24%, transparent)',
                  color: 'var(--status-orange)',
                }}
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="flex-1">{w}</span>
                <button
                  type="button"
                  onClick={() => dismissWarning(i)}
                  className="p-0.5 rounded hover:opacity-75"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <main className="flex-1 min-h-0 overflow-hidden ap-workspace-shell">
          {view === 'tasks' && <TasksView />}
          {view === 'kanban' && <KanbanView />}
          {view === 'schedule' && <ScheduleView />}
          {view === 'knowledge' && <KnowledgeView />}
          {view === 'notes' && <NotesView />}
          {view === 'stickies' && <StickiesView />}
          {view === 'projects' && <ProjectsView />}
          {view === 'review' && <ReviewView />}
          {view === 'settings' && <SettingsView />}
        </main>
      </div>

      <CommandPalette />
      {quickCapturePreviewOpen && (
        <QuickCaptureWindow onClose={() => setQuickCapturePreviewOpen(false)} />
      )}
      <UpdatePromptModal />
      <MobileAccessModal />
      <ToastHost />
    </div>
  );
}
