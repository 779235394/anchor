import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { ViewKey } from '@/domain/types';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { Sidebar } from '@/components/Sidebar';
import { OnboardingModal, ToastHost } from '@/components/Dialogs';
import { TasksView } from '@/views/TasksView';
import { NotesView } from '@/views/NotesView';
import { ProjectsView } from '@/views/ProjectsView';
import { DailyView } from '@/views/DailyView';
import { AssignmentsView } from '@/views/AssignmentsView';
import { MembersView } from '@/views/MembersView';
import { ReviewView } from '@/views/ReviewView';
import { SettingsView } from '@/views/SettingsView';

const VIEW_SHORTCUTS: ViewKey[] = [
  'tasks',
  'notes',
  'projects',
  'daily',
  'assignments',
  'members',
  'review',
  'settings',
];

export function App() {
  const {
    ready,
    config,
    view,
    warnings,
    init,
    setView,
    openInspector,
    flushPendingWrites,
    handleExternalChange,
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

  // Flush writes on hide/unload and verify external changes on focus
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) void flushPendingWrites();
    };
    const onUnload = () => {
      void flushPendingWrites();
    };
    const onFocus = () => {
      void handleExternalChange();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('focus', onFocus);
    };
  }, [flushPendingWrites, handleExternalChange]);

  // Global keyboard shortcuts: Cmd/Ctrl + N (focus quick input), Esc (close inspector), Cmd/Ctrl + 1..8
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        openInspector(null);
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === 'n') {
        const input = document.getElementById('quick-capture-input') as
          | HTMLInputElement
          | HTMLTextAreaElement
          | null;
        if (input) {
          e.preventDefault();
          input.focus();
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
  }, [openInspector, setView]);

  if (!ready) {
    return (
      <div
        className="h-full flex items-center justify-center text-[13px]"
        style={{ background: 'var(--bg-canvas)', color: 'var(--text-3)' }}
      >
        Loading Clarity Workbench…
      </div>
    );
  }

  return (
    <div className="h-full w-full flex overflow-hidden" style={{ background: 'var(--bg-canvas)' }}>
      <Sidebar />

      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        {/* Recovery warnings banner if any corrupted JSON fell back to snapshot */}
        {warnings.length > 0 && (
          <div className="px-6 pt-3 space-y-2 shrink-0">
            {warnings.map((w, i) => (
              <div
                key={i}
                className="px-3.5 py-2.5 rounded-[10px] flex items-center gap-2.5 text-[12.5px]"
                style={{
                  background: 'var(--status-orange-soft)',
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

        <main className="flex-1 min-h-0 overflow-hidden">
          {view === 'tasks' && <TasksView />}
          {view === 'notes' && <NotesView />}
          {view === 'projects' && <ProjectsView />}
          {view === 'daily' && <DailyView />}
          {view === 'assignments' && <AssignmentsView />}
          {view === 'members' && <MembersView />}
          {view === 'review' && <ReviewView />}
          {view === 'settings' && <SettingsView />}
        </main>
      </div>

      <OnboardingModal />
      <ToastHost />
    </div>
  );
}
