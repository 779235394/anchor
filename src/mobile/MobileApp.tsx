import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Lightbulb,
  Loader2,
  LogOut,
  Moon,
  RefreshCw,
  Search,
  ShieldAlert,
  Sun,
  WifiOff,
  X,
} from 'lucide-react';
import {
  isActive,
  type AccentColor,
  type Lang,
  type Note,
  type Project,
  type Task,
  type TaskStatus,
  type WorkspaceData,
} from '@/domain/types';
import { createEmptyWorkspace, normalizeTask } from '@/domain/merge';
import type { DocEntry } from '@/domain/docs';
import { todayStr } from '@/domain/date';
import { extractPairTokenFromSearch, mergeMobileShardItems } from '@/domain/mobileSync';
import { mobileApi, MobileApiError } from './api';
import { MobileTasksTab } from './MobileTasksTab';
import { MobileScheduleTab } from './MobileScheduleTab';
import { MobileKnowledgeTab } from './MobileKnowledgeTab';
import { MobileNotesTab } from './MobileNotesTab';
import { MobileReviewTab } from './MobileReviewTab';
import { MobileTaskEditor } from './MobileTaskEditor';
import { MobileSearchModal } from './MobileSearchModal';

type MobileTab = 'tasks' | 'schedule' | 'knowledge' | 'notes' | 'review';
type AuthPhase = 'checking' | 'authenticated' | 'unauthenticated';

interface ToastMsg {
  id: number;
  text: string;
  tone: 'ok' | 'err';
}

export function MobileApp() {
  const [phase, setPhase] = useState<AuthPhase>('checking');
  const [authError, setAuthError] = useState<string>('');
  const [lang, setLang] = useState<Lang>('zh');
  const [accent, setAccent] = useState<AccentColor>('blue');
  const [themePref, setThemePref] = useState<'system' | 'light' | 'dark'>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
  );

  const [tab, setTab] = useState<MobileTab>('tasks');
  const [workspace, setWorkspace] = useState<WorkspaceData>(() => createEmptyWorkspace(todayStr()));
  const [docsTree, setDocsTree] = useState<DocEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [sseDisconnected, setSseDisconnected] = useState(false);

  // Shared modals & overlays
  const [searchOpen, setSearchOpen] = useState(false);
  const [taskEditor, setTaskEditor] = useState<{
    open: boolean;
    task: Task | null;
    defaultDue?: string;
    defaultProjectId?: string;
    defaultStatus?: TaskStatus;
  }>({ open: false, task: null });
  const [externalOpenDocPath, setExternalOpenDocPath] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMsg | null>(null);

  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const zh = lang !== 'en';

  const showToast = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), text, tone });
    toastTimerRef.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // Apply Light/Dark theme + Accent to root
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = themePref === 'system' ? (mq.matches ? 'dark' : 'light') : themePref;
      setResolvedTheme(resolved);
      root.dataset.theme = resolved;
      root.dataset.accent = accent;
      root.lang = lang === 'en' ? 'en' : 'zh-CN';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [themePref, accent, lang]);

  const loadBootstrap = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const boot = await mobileApi.bootstrap();
      setLang(boot.prefs?.lang === 'en' ? 'en' : 'zh');
      if (boot.prefs?.accent) setAccent(boot.prefs.accent);
      setWorkspace({
        meta: boot.meta || createEmptyWorkspace(todayStr()).meta,
        tasks: (boot.tasks || []).map((t) => normalizeTask(t)),
        projects: boot.projects || [],
        notes: boot.notes || [],
        stickies: [],
      });
      setDocsTree(boot.docsTree || []);
      setSseDisconnected(false);
    } catch (err) {
      if (err instanceof MobileApiError && err.status === 401) {
        setPhase('unauthenticated');
        setAuthError(
          zh
            ? '会话已失效或已被电脑端断开，请重新扫描桌面端二维码。'
            : 'Session expired or revoked on desktop. Please scan a fresh QR code.',
        );
      } else if (!silent) {
        showToast(err instanceof Error ? err.message : String(err), 'err');
      }
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, [showToast, zh]);

  const refreshDocsTree = useCallback(async () => {
    try {
      const tree = await mobileApi.listDocsTree();
      setDocsTree(tree);
    } catch {
      // ignore transient error
    }
  }, []);

  // Initial auth handshake: consume one-time ?pair=... via POST (never GET!) and strip URL
  useEffect(() => {
    let cancelled = false;
    const bootstrapAuth = async () => {
      const pairToken = extractPairTokenFromSearch(window.location.search);
      if (pairToken) {
        // Immediately clean URL bar so screenshots/forwards never leak pairing code
        window.history.replaceState({}, '', window.location.pathname || '/');
        try {
          await mobileApi.pair(pairToken);
          if (cancelled) return;
          setPhase('authenticated');
          await loadBootstrap(false);
          return;
        } catch (err) {
          if (cancelled) return;
          // Maybe the user already had a valid session cookie and re-opened an old link
          try {
            const sess = await mobileApi.checkSession();
            if (sess.authenticated && !cancelled) {
              setPhase('authenticated');
              await loadBootstrap(false);
              return;
            }
          } catch {
            // ignore
          }
          setAuthError(
            err instanceof Error
              ? err.message
              : '配对码已失效，请在电脑端点击「刷新二维码」重新扫码。',
          );
          setPhase('unauthenticated');
          return;
        }
      }

      try {
        const sess = await mobileApi.checkSession();
        if (cancelled) return;
        if (sess.authenticated) {
          setPhase('authenticated');
          await loadBootstrap(false);
        } else {
          setAuthError('请使用手机扫描 Anchor 桌面端「手机访问」面板中的二维码接入。');
          setPhase('unauthenticated');
        }
      } catch {
        if (!cancelled) {
          setAuthError('无法连接到 Anchor 桌面端，请确认电脑开机且已开启「手机访问」。');
          setPhase('unauthenticated');
        }
      }
    };
    void bootstrapAuth();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live SSE sync stream from desktop
  useEffect(() => {
    if (phase !== 'authenticated') return;
    const es = new EventSource('/api/events', { withCredentials: true });
    es.onopen = () => {
      setSseDisconnected(false);
    };
    es.addEventListener('sync', (ev) => {
      const kind = String((ev as MessageEvent).data || '');
      if (kind === 'auth-revoked') {
        es.close();
        setPhase('unauthenticated');
        setAuthError(
          zh
            ? '当前设备已被电脑端断开连接，请重新扫码配对。'
            : 'This device was disconnected from desktop. Scan a fresh QR code to reconnect.',
        );
        return;
      }
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => {
        if (kind === 'docs') {
          void refreshDocsTree();
        } else {
          void loadBootstrap(true);
        }
      }, 260);
    });
    es.onerror = () => {
      setSseDisconnected(true);
    };
    return () => {
      es.close();
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
  }, [phase, loadBootstrap, refreshDocsTree, zh]);

  const activeTasks = useMemo(() => workspace.tasks.filter(isActive), [workspace.tasks]);
  const activeProjects = useMemo(() => workspace.projects.filter(isActive), [workspace.projects]);
  const activeNotes = useMemo(() => workspace.notes.filter(isActive), [workspace.notes]);

  const handleTaskSaved = useCallback((saved: Task) => {
    setWorkspace((prev) => ({
      ...prev,
      tasks: mergeMobileShardItems(prev.tasks, [saved], (t) => normalizeTask(t)),
    }));
  }, []);

  const handleProjectSaved = useCallback((saved: Project) => {
    setWorkspace((prev) => ({
      ...prev,
      projects: mergeMobileShardItems(prev.projects, [saved]),
    }));
  }, []);

  const handleProjectDeleted = useCallback((projectId: string) => {
    const now = Date.now();
    setWorkspace((prev) => ({
      ...prev,
      projects: prev.projects.map((p) =>
        p.id === projectId ? { ...p, deletedAt: now, updatedAt: now } : p,
      ),
      tasks: prev.tasks.map((t) =>
        t.projectId === projectId ? { ...t, projectId: '', updatedAt: now } : t,
      ),
    }));
  }, []);

  const handleNoteSaved = useCallback((saved: Note) => {
    setWorkspace((prev) => ({
      ...prev,
      notes: mergeMobileShardItems(prev.notes, [saved]),
    }));
  }, []);

  const handleLogout = async () => {
    if (!window.confirm(zh ? '确定退出当前手机连接？下次需要重新扫码。' : 'Disconnect this device?')) {
      return;
    }
    try {
      await mobileApi.logout();
    } catch {
      // ignore
    }
    setPhase('unauthenticated');
    setAuthError(zh ? '已安全退出连接，如需使用请重新扫码。' : 'Disconnected cleanly. Scan QR to reconnect.');
  };

  const toggleTheme = () => {
    setThemePref((cur) => {
      if (cur === 'dark') return 'light';
      if (cur === 'light') return 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark';
    });
  };

  if (phase === 'checking') {
    return (
      <div
        className="h-full w-full flex flex-col items-center justify-center gap-3 p-6"
        style={{
          backgroundColor: 'var(--bg-canvas)',
          backgroundImage: 'var(--bg-canvas-glow)',
          color: 'var(--text-2)',
        }}
      >
        <Loader2 className="w-7 h-7 animate-spin" style={{ color: 'var(--accent)' }} />
        <div className="text-[14px] font-medium">Anchor Mobile</div>
      </div>
    );
  }

  if (phase === 'unauthenticated') {
    return (
      <div
        className="h-full w-full flex items-center justify-center p-6"
        style={{
          backgroundColor: 'var(--bg-canvas)',
          backgroundImage: 'var(--bg-canvas-glow)',
        }}
      >
        <div className="w-full max-w-[360px] rounded-[16px] p-6 text-center space-y-4 ap-glass-modal">
          <div className="flex justify-center">
            <img
              src={`${import.meta.env.BASE_URL}app-icon.png`}
              alt="Anchor"
              className="w-14 h-14 rounded-[14px]"
              style={{ boxShadow: '0 4px 14px color-mix(in srgb, var(--accent) 26%, transparent)' }}
            />
          </div>
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>
              <ShieldAlert className="w-4 h-4" style={{ color: 'var(--status-orange)' }} />
              Anchor Mobile
            </div>
            <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
              {authError}
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="ap-btn-primary w-full py-2.5 rounded-[12px] text-[14px] font-semibold"
          >
            {zh ? '重试连接' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  const tabItems: Array<{
    key: MobileTab;
    label: string;
    icon: typeof CheckCircle2;
  }> = [
    { key: 'tasks', label: zh ? '待办' : 'Tasks', icon: CheckCircle2 },
    { key: 'schedule', label: zh ? '日程' : 'Schedule', icon: CalendarDays },
    { key: 'knowledge', label: zh ? '知识库' : 'Docs', icon: BookOpen },
    { key: 'notes', label: zh ? '灵感' : 'Notes', icon: Lightbulb },
    { key: 'review', label: zh ? '复盘' : 'Review', icon: BarChart3 },
  ];

  const currentTabTitle = tabItems.find((i) => i.key === tab)?.label || 'Anchor';

  return (
    <div
      className="h-full w-full flex flex-col overflow-hidden"
      style={{
        backgroundColor: 'var(--bg-canvas)',
        backgroundImage: 'var(--bg-canvas-glow)',
      }}
    >
      {/* Top App Header (Frosted Glass Bar) */}
      <header
        className="px-4 py-2.5 flex items-center justify-between gap-2 shrink-0 m-safe-top m-glass-bar"
        style={{
          borderBottom: '1px solid var(--hairline-soft)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <img
            src={`${import.meta.env.BASE_URL}app-icon.png`}
            alt="Anchor"
            className="w-6 h-6 rounded-[6px] shrink-0"
          />
          <span className="text-[16px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
            {currentTabTitle}
          </span>
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              background: sseDisconnected ? 'var(--status-orange)' : 'var(--status-green)',
            }}
            title={sseDisconnected ? 'Reconnecting…' : 'Live synced'}
          />
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="p-2 rounded-[9px]"
            style={{ color: 'var(--text-2)' }}
            aria-label="Global Search"
          >
            <Search className="w-[18px] h-[18px]" />
          </button>
          <button
            type="button"
            onClick={() => void loadBootstrap(false)}
            className="p-2 rounded-[9px]"
            style={{ color: 'var(--text-2)' }}
            aria-label="Refresh"
          >
            <RefreshCw className={`w-[17px] h-[17px] ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            className="p-2 rounded-[9px]"
            style={{ color: 'var(--text-2)' }}
            aria-label="Toggle Theme"
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="w-[17px] h-[17px]" />
            ) : (
              <Moon className="w-[17px] h-[17px]" />
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="p-2 rounded-[9px]"
            style={{ color: 'var(--text-3)' }}
            aria-label="Disconnect"
          >
            <LogOut className="w-[17px] h-[17px]" />
          </button>
        </div>
      </header>

      {/* Disconnected Banner */}
      {sseDisconnected && (
        <div
          className="px-4 py-1.5 flex items-center justify-between gap-2 text-[12px] shrink-0"
          style={{
            background: 'var(--status-orange-soft)',
            color: 'var(--status-orange)',
          }}
        >
          <span className="inline-flex items-center gap-1.5">
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            {zh
              ? '与电脑实时连接中断，请确认桌面端 Anchor 运行中…'
              : 'Connection interrupted. Ensure Anchor desktop is running…'}
          </span>
          <button
            type="button"
            onClick={() => void loadBootstrap(false)}
            className="font-semibold underline shrink-0"
          >
            {zh ? '刷新' : 'Retry'}
          </button>
        </div>
      )}

      {/* Main Active Tab Body */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {tab === 'tasks' && (
          <MobileTasksTab
            lang={lang}
            tasks={activeTasks}
            projects={activeProjects}
            onTaskUpdated={handleTaskSaved}
            onProjectUpdated={handleProjectSaved}
            onProjectDeleted={handleProjectDeleted}
            onEditTask={(task) => setTaskEditor({ open: true, task })}
            onNewTask={(opts) =>
              setTaskEditor({
                open: true,
                task: null,
                defaultDue: opts?.due,
                defaultProjectId: opts?.projectId,
                defaultStatus: opts?.status,
              })
            }
            onToast={showToast}
          />
        )}

        {tab === 'schedule' && (
          <MobileScheduleTab
            lang={lang}
            tasks={activeTasks}
            projects={activeProjects}
            onTaskUpdated={handleTaskSaved}
            onEditTask={(task) => setTaskEditor({ open: true, task })}
            onNewTaskOnDate={(ymd) =>
              setTaskEditor({ open: true, task: null, defaultDue: ymd })
            }
            onToast={showToast}
          />
        )}

        {tab === 'knowledge' && (
          <MobileKnowledgeTab
            lang={lang}
            docsTree={docsTree}
            externalOpenDocPath={externalOpenDocPath}
            onConsumeExternalOpenDoc={() => setExternalOpenDocPath(null)}
            onRefreshDocsTree={refreshDocsTree}
            onPreviewImage={setLightboxUrl}
            onToast={showToast}
          />
        )}

        {tab === 'notes' && (
          <MobileNotesTab
            lang={lang}
            notes={activeNotes}
            docsTree={docsTree}
            onNoteSaved={handleNoteSaved}
            onNoteDeleted={handleNoteSaved}
            onRefreshDocsTree={refreshDocsTree}
            onOpenDocInKnowledge={(relPath) => {
              setExternalOpenDocPath(relPath);
              setTab('knowledge');
            }}
            onPreviewImage={setLightboxUrl}
            onToast={showToast}
          />
        )}

        {tab === 'review' && (
          <MobileReviewTab
            lang={lang}
            workspace={workspace}
            docsTree={docsTree}
            onRefreshDocsTree={refreshDocsTree}
            onOpenDocInKnowledge={(relPath) => {
              setExternalOpenDocPath(relPath);
              setTab('knowledge');
            }}
            onToast={showToast}
          />
        )}
      </main>

      {/* Bottom 5-Tab Bar (Frosted Glass Navigation) */}
      <nav
        className="grid grid-cols-5 px-1.5 pt-1.5 pb-1.5 shrink-0 m-safe-bottom m-glass-bar"
        style={{
          borderTop: '1px solid var(--hairline-soft)',
        }}
      >
        {tabItems.map((item) => {
          const active = tab === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className="flex flex-col items-center justify-center gap-0.5 py-1 rounded-[10px] ap-ease"
              style={{
                background: active ? 'var(--accent-soft)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-3)',
              }}
            >
              <Icon className="w-[20px] h-[20px]" strokeWidth={active ? 2.3 : 1.8} />
              <span className={`text-[10.5px] ${active ? 'font-semibold' : 'font-medium'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Shared Task Editor Drawer */}
      {taskEditor.open && (
        <MobileTaskEditor
          lang={lang}
          task={taskEditor.task}
          defaultDue={taskEditor.defaultDue}
          defaultProjectId={taskEditor.defaultProjectId}
          defaultStatus={taskEditor.defaultStatus}
          projects={activeProjects}
          onClose={() => setTaskEditor({ open: false, task: null })}
          onSaved={handleTaskSaved}
          onDeleted={handleTaskSaved}
          onPreviewImage={setLightboxUrl}
          onToast={showToast}
        />
      )}

      {/* Global Spotlight Search */}
      <MobileSearchModal
        open={searchOpen}
        lang={lang}
        workspace={workspace}
        onClose={() => setSearchOpen(false)}
        onSelectTask={(taskId) => {
          const found = activeTasks.find((t) => t.id === taskId);
          if (found) {
            setTab('tasks');
            setTaskEditor({ open: true, task: found });
          }
        }}
        onSelectNote={() => setTab('notes')}
        onSelectDoc={(relPath) => {
          setExternalOpenDocPath(relPath);
          setTab('knowledge');
        }}
      />

      {/* Fullscreen Image Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/15 text-white inline-flex items-center justify-center m-safe-top"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={lightboxUrl}
            alt="Preview"
            className="max-w-full max-h-[88vh] object-contain rounded-[10px]"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-[13px] font-medium pointer-events-none max-w-[88vw] truncate"
          style={{
            background: toast.tone === 'err' ? 'var(--status-red)' : 'var(--toast-bg)',
            color: toast.tone === 'err' ? '#ffffff' : 'var(--toast-fg)',
            boxShadow: 'var(--shadow-float)',
            backdropFilter: 'var(--glass-blur-md)',
          }}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
