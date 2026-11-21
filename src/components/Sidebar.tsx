import {
  BarChart3,
  CalendarCheck2,
  CheckCircle2,
  ClipboardList,
  FolderKanban,
  GitBranch,
  Lightbulb,
  RefreshCw,
  Search,
  Settings,
  Users,
} from 'lucide-react';
import { isActive, type ViewKey } from '@/domain/types';
import { isWeekend, todayStr, weekdayLabel } from '@/domain/date';
import { getDict } from '@/i18n';
import { isTauriRuntime } from '@/services/storage';
import { useWorkbenchStore } from '@/store/workbenchStore';

function isMacDesktop(): boolean {
  if (!isTauriRuntime()) return false;
  return /Macintosh|Mac OS X/i.test(navigator.userAgent);
}

function shortFolderName(dir: string): string {
  if (!dir) return 'Local';
  const cleaned = dir.replace(/[\\/]+$/, '');
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/');
}

export function Sidebar() {
  const {
    config,
    data,
    view,
    setView,
    setCommandPaletteOpen,
    syncStatus,
    lastError,
    retryFailedWrites,
    gitStatus,
    gitSyncState,
    gitLastError,
    syncGitNow,
  } = useWorkbenchStore();
  const t = getDict(config.lang);
  const today = todayStr();
  const macPad = isMacDesktop();

  const activeTasks = data.tasks.filter(isActive);
  const activeProjects = data.projects.filter(isActive);
  const activeNotes = data.notes.filter(isActive);
  const activeMembers = data.members.filter(isActive);
  const activeAssignments = data.assignments.filter(isActive);
  const activeDaily = data.daily.filter(isActive);

  const openTodayCount = activeTasks.filter(
    (k) => !k.done && (!k.due || k.due <= today),
  ).length;
  const overdueCount = activeTasks.filter((k) => !k.done && !!k.due && k.due < today).length;
  const blockedProjCount = activeProjects.filter((p) => p.status === 'blocked').length;
  const openDailyCount = isWeekend(today)
    ? 0
    : activeDaily.filter((d) => d.date === today && !d.done).length;
  const openAssignCount = activeAssignments.filter((a) => a.status !== 'done').length;

  const now = new Date();
  const dateSubtitle =
    config.lang === 'zh'
      ? `${now.getMonth() + 1}月${now.getDate()}日 · ${weekdayLabel(today, 'zh')}`
      : `${now.toLocaleString('en-US', { month: 'short' })} ${now.getDate()} · ${weekdayLabel(today, 'en')}`;

  const sections: Array<{
    label: string;
    items: Array<{
      key: ViewKey;
      name: string;
      icon: typeof CheckCircle2;
      badge?: string | number;
      hot?: boolean;
    }>;
  }> = [
    {
      label: t.groupPersonal,
      items: [
        {
          key: 'tasks',
          name: t.navTasks,
          icon: CheckCircle2,
          badge: openTodayCount || undefined,
          hot: overdueCount > 0,
        },
        {
          key: 'notes',
          name: t.navNotes,
          icon: Lightbulb,
          badge: activeNotes.length || undefined,
        },
        {
          key: 'projects',
          name: t.navProjects,
          icon: FolderKanban,
          badge: blockedProjCount
            ? t.blockedShort(blockedProjCount)
            : activeProjects.filter((p) => p.status !== 'done').length || undefined,
          hot: blockedProjCount > 0,
        },
      ],
    },
    {
      label: t.groupTeam,
      items: [
        {
          key: 'daily',
          name: t.navDaily,
          icon: CalendarCheck2,
          badge: openDailyCount || undefined,
        },
        {
          key: 'assignments',
          name: t.navAssignments,
          icon: ClipboardList,
          badge: openAssignCount || undefined,
        },
        {
          key: 'members',
          name: t.navMembers,
          icon: Users,
          badge: activeMembers.length || undefined,
        },
      ],
    },
    {
      label: t.groupSystem,
      items: [
        { key: 'review', name: t.navReview, icon: BarChart3 },
        { key: 'settings', name: t.navSettings, icon: Settings },
      ],
    },
  ];

  const dotColor =
    syncStatus === 'error'
      ? 'var(--status-red)'
      : syncStatus === 'saving'
        ? 'var(--status-orange)'
        : 'var(--status-green)';

  const statusText =
    syncStatus === 'error'
      ? t.syncError
      : syncStatus === 'saving'
        ? t.syncSaving
        : `${t.syncSaved} · ${shortFolderName(config.dataDir)}`;

  return (
    <aside
      className="w-[236px] shrink-0 h-full flex flex-col select-none"
      style={{
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--hairline)',
      }}
    >
      {/* Top drag region (leaves clean room for macOS Overlay traffic lights) */}
      <div
        data-tauri-drag-region
        className="shrink-0 px-4 flex flex-col justify-end"
        style={{
          paddingTop: macPad ? 42 : 18,
          paddingBottom: 14,
          borderBottom: '1px solid var(--hairline-soft)',
        }}
      >
        <div className="flex items-center gap-2.5" data-tauri-drag-region>
          <img
            src="/app-icon.png"
            alt={t.appName}
            draggable={false}
            className="w-8 h-8 rounded-[9px] shrink-0 object-cover"
            style={{
              boxShadow: '0 2px 8px rgba(0, 98, 230, 0.28)',
            }}
          />
          <div className="min-w-0">
            <div
              className="text-[14.5px] font-semibold tracking-[-0.015em] truncate"
              style={{ color: 'var(--text-1)' }}
            >
              {t.appName}
            </div>
            <div className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
              {dateSubtitle}
            </div>
          </div>
        </div>

        {/* Spotlight Global Search Trigger */}
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          className="mt-3 w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] text-[12.5px] ap-ease"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--hairline)',
            color: 'var(--text-3)',
          }}
        >
          <Search className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1 text-left truncate">{t.searchShortcut}…</span>
          <kbd className="text-[10.5px] font-medium opacity-75">
            {macPad ? '⌘K' : 'Ctrl+K'}
          </kbd>
        </button>
      </div>

      {/* Grouped Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3.5 space-y-5">
        {sections.map((sec) => (
          <div key={sec.label} className="space-y-0.5">
            <div
              className="px-2.5 pb-1 text-[11px] font-semibold tracking-wider uppercase"
              style={{ color: 'var(--text-3)' }}
            >
              {sec.label}
            </div>
            {sec.items.map((item) => {
              const active = view === item.key;
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setView(item.key)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[9px] text-[13.5px] ap-ease"
                  style={{
                    background: active ? 'var(--accent-soft)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-2)',
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  <Icon
                    className="w-[16.5px] h-[16.5px] shrink-0"
                    strokeWidth={active ? 2.2 : 1.85}
                  />
                  <span className="flex-1 text-left truncate">{item.name}</span>
                  {item.badge !== undefined && (
                    <span
                      className="text-[11px] font-semibold px-1.5 py-[1px] rounded-full min-w-[20px] text-center"
                      style={{
                        background: item.hot
                          ? 'var(--status-red-soft)'
                          : active
                            ? 'var(--accent)'
                            : 'var(--bg-subtle-hover)',
                        color: item.hot
                          ? 'var(--status-red)'
                          : active
                            ? '#ffffff'
                            : 'var(--text-2)',
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Bottom Sync Status Indicator + One-Click Git Sync */}
      <div
        className="px-3 py-2.5 shrink-0 space-y-1"
        style={{ borderTop: '1px solid var(--hairline-soft)' }}
      >
        {gitStatus?.isRepo && gitStatus.remoteUrl && (
          <button
            type="button"
            disabled={gitSyncState === 'syncing'}
            onClick={() => void syncGitNow(false)}
            title={gitLastError || gitStatus.remoteUrl}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[8px] text-[12px] ap-ease hover:bg-[var(--bg-subtle-hover)] disabled:opacity-60"
            style={{
              color:
                gitSyncState === 'error'
                  ? 'var(--status-red)'
                  : gitStatus.dirtyCount > 0 || gitStatus.ahead > 0
                    ? 'var(--status-orange)'
                    : 'var(--text-2)',
            }}
          >
            <GitBranch className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 truncate text-left font-medium">
              {gitSyncState === 'syncing'
                ? t.gitSyncing
                : gitStatus.dirtyCount > 0
                  ? t.gitDirtyCount(gitStatus.dirtyCount)
                  : t.gitSyncedClean}
            </span>
            <RefreshCw
              className={`w-3.5 h-3.5 shrink-0 ${gitSyncState === 'syncing' ? 'animate-spin' : ''}`}
            />
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            if (syncStatus === 'error') {
              void retryFailedWrites();
            } else {
              setView('settings');
            }
          }}
          title={lastError || config.dataDir}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[8px] text-[12px] ap-ease hover:bg-[var(--bg-subtle-hover)]"
          style={{ color: syncStatus === 'error' ? 'var(--status-red)' : 'var(--text-3)' }}
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${syncStatus === 'saving' ? 'animate-pulse' : ''}`}
            style={{ background: dotColor }}
          />
          <span className="truncate text-left">{statusText}</span>
        </button>
      </div>
    </aside>
  );
}
