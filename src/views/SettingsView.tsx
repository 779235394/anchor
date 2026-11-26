import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowUpCircle,
  CheckCircle2,
  CloudDownload,
  Download,
  Eraser,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  FolderSync,
  GitBranch,
  GitCommitHorizontal,
  HardDrive,
  History,
  Link2,
  RefreshCw,
  RotateCcw,
  StickyNote,
  Trash2,
  Upload,
  Wifi,
  Zap,
} from 'lucide-react';
import type {
  AccentColor,
  GitAuth,
  GitAuthMode,
  Lang,
  QuickCaptureDefaultMode,
  StorageMode,
  ThemeMode,
  WorkspaceData,
} from '@/domain/types';
import { todayStr } from '@/domain/date';
import { getDict } from '@/i18n';
import { defaultStickyShortcut, isTauriRuntime, storageApi } from '@/services/storage';
import { APP_VERSION, formatBytesMb } from '@/services/updater';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { SegmentedControl } from '@/components/SegmentedControl';
import { ChoiceDialog, ConfirmDialog } from '@/components/Dialogs';
import { RichTextView } from '@/components/RichTextView';
import { ShortcutRecorder } from '@/components/ShortcutRecorder';

const ACCENTS: Array<{ key: AccentColor; label: string; swatch: string }> = [
  { key: 'blue', label: 'Apple Blue', swatch: '#007AFF' },
  { key: 'indigo', label: 'Indigo', swatch: '#5856D6' },
  { key: 'teal', label: 'Calm Teal', swatch: '#0D9488' },
  { key: 'graphite', label: 'Graphite', swatch: '#636366' },
];

function ToggleSwitch({
  checked,
  disabled,
  onToggle,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      className="w-11 h-6 rounded-full p-0.5 ap-ease shrink-0 disabled:opacity-50"
      style={{
        background: checked ? 'var(--status-green)' : 'var(--bg-subtle-hover)',
      }}
    >
      <span
        className="block w-5 h-5 rounded-full bg-white shadow transition-transform"
        style={{
          transform: checked ? 'translateX(20px)' : 'translateX(0)',
        }}
      />
    </button>
  );
}

export function SettingsView() {
  const {
    config,
    snapshots,
    gitStatus,
    gitSyncState,
    gitLastError,
    updateState,
    updateConfig,
    updateQuickCaptureShortcut,
    updateStickyShortcut,
    openQuickCapture,
    openNewDraftSticky,
    switchDataDir,
    switchStorageMode,
    restoreSnapshot,
    cleanupOrphanAttachments,
    bindGitRemote,
    cloneGitRemote,
    syncGitNow,
    checkForUpdates,
    clearIgnoredUpdateVersion,
    downloadAndInstallUpdate,
    relaunchToApplyUpdate,
    buildExportPayload,
    markExported,
    importBackup,
    wipeAllData,
    pushToast,
  } = useWorkbenchStore();

  const t = getDict(config.lang);
  const zh = config.lang === 'zh';
  const desktop = isTauriRuntime();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [pendingDir, setPendingDir] = useState<string | null>(null);
  const [pendingStorageMode, setPendingStorageMode] = useState<StorageMode | null>(null);
  const [pendingImport, setPendingImport] = useState<WorkspaceData | null>(null);
  const [restoreKey, setRestoreKey] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  // Autostart state
  const [autostart, setAutostart] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);

  // Git form state
  const [gitRemoteUrl, setGitRemoteUrl] = useState(config.gitRemoteUrl || '');
  const [gitBranch, setGitBranch] = useState(config.gitBranch || 'main');
  const [gitAuthMode, setGitAuthMode] = useState<GitAuthMode>(config.gitAuthMode || 'system');
  const [gitUsername, setGitUsername] = useState(config.gitUsername || '');
  const [gitToken, setGitToken] = useState(config.gitToken || '');
  const [showToken, setShowToken] = useState(false);
  const [testingGit, setTestingGit] = useState(false);
  const [bindingGit, setBindingGit] = useState(false);
  const [gitTestMsg, setGitTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setGitRemoteUrl(config.gitRemoteUrl || gitStatus?.remoteUrl || '');
    setGitBranch(config.gitBranch || gitStatus?.branch || 'main');
    setGitAuthMode(config.gitAuthMode || 'system');
    setGitUsername(config.gitUsername || '');
    setGitToken(config.gitToken || '');
  }, [
    config.gitRemoteUrl,
    config.gitBranch,
    config.gitAuthMode,
    config.gitUsername,
    config.gitToken,
    gitStatus?.remoteUrl,
    gitStatus?.branch,
  ]);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void storageApi.getAutostartEnabled().then((enabled) => {
      if (active) setAutostart(enabled);
    });
    return () => {
      active = false;
    };
  }, [desktop]);

  const currentGitAuth = (): GitAuth => ({
    mode: gitAuthMode,
    username: gitUsername.trim(),
    token: gitToken.trim(),
  });

  const persistGitSettings = async () => {
    await updateConfig({
      gitRemoteUrl: gitRemoteUrl.trim(),
      gitBranch: gitBranch.trim() || 'main',
      gitAuthMode,
      gitUsername: gitUsername.trim(),
      gitToken: gitToken.trim(),
    });
  };

  const handleToggleAutostart = async () => {
    if (!desktop) {
      setAutostart((v) => !v);
      pushToast(zh ? '开机自启仅在桌面端生效' : 'Launch at login applies on the desktop app', 'info');
      return;
    }
    setAutostartBusy(true);
    try {
      const next = await storageApi.setAutostartEnabled(!autostart);
      setAutostart(next);
      pushToast(
        next
          ? zh
            ? '已开启开机自动启动'
            : 'Launch at login enabled'
          : zh
            ? '已关闭开机自动启动'
            : 'Launch at login disabled',
      );
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      setAutostartBusy(false);
    }
  };

  const handleGitTest = async () => {
    const url = gitRemoteUrl.trim();
    if (!url) {
      pushToast(zh ? '请先填写 Git 远程仓库地址' : 'Please enter a Git remote URL first', 'err');
      return;
    }
    setTestingGit(true);
    setGitTestMsg(null);
    try {
      await persistGitSettings();
      const res = await storageApi.gitTestConnection(url, currentGitAuth());
      if (res.ok && res.defaultBranch) {
        setGitBranch(res.defaultBranch);
        await updateConfig({ gitBranch: res.defaultBranch });
      }
      setGitTestMsg({ ok: res.ok, text: res.message });
      pushToast(res.message, res.ok ? 'ok' : 'err');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGitTestMsg({ ok: false, text: msg });
      pushToast(msg, 'err');
    } finally {
      setTestingGit(false);
    }
  };

  const handleGitBind = async () => {
    const url = gitRemoteUrl.trim();
    if (!url) {
      pushToast(zh ? '请先填写 Git 远程仓库地址' : 'Please enter a Git remote URL first', 'err');
      return;
    }
    setBindingGit(true);
    try {
      await persistGitSettings();
      await bindGitRemote(url, gitBranch.trim() || 'main');
    } finally {
      setBindingGit(false);
    }
  };

  const handleGitClone = async () => {
    const url = gitRemoteUrl.trim();
    if (!url) {
      pushToast(zh ? '请先填写 Git 远程仓库地址' : 'Please enter a Git remote URL first', 'err');
      return;
    }
    const picked = await storageApi.pickDataDir();
    if (!picked) return;
    await persistGitSettings();
    await cloneGitRemote(url, picked, gitBranch.trim() || 'main', currentGitAuth());
  };

  const handleGitSyncNow = async () => {
    await persistGitSettings();
    await syncGitNow(false);
  };

  const handlePickDir = async () => {
    const picked = await storageApi.pickDataDir();
    if (picked && picked !== config.dataDir) {
      setPendingDir(picked);
    }
  };

  const handleExportJson = () => {
    const payload = buildExportPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `anchor-backup-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 500);
    markExported();
    pushToast(zh ? '已导出全量 JSON 备份' : 'Exported JSON backup');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '')) as WorkspaceData;
        if (!parsed || typeof parsed !== 'object') throw new Error('Invalid JSON');
        setPendingImport(parsed);
      } catch {
        pushToast(
          zh ? '文件格式无效，请选择导出的 JSON 备份' : 'Invalid JSON backup file',
          'err',
        );
      }
    };
    reader.readAsText(file);
  };

  const isGitMode = config.storageMode === 'git';
  const gitConfigured = isGitMode && !!gitStatus?.isRepo && !!(gitStatus.remoteUrl || gitRemoteUrl.trim());
  const gitBusy = gitSyncState === 'syncing' || testingGit || bindingGit;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div data-tauri-drag-region="deep" className="h-7 shrink-0" />
      <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-7">
        <div className="max-w-[820px] mx-auto space-y-6 pb-8">
          <div data-tauri-drag-region="deep" className="select-none">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em] leading-tight">
              {t.settingsTitle}
            </h1>
            <p className="text-[13px] mt-1" style={{ color: 'var(--text-2)' }}>
              {t.settingsSub}
            </p>
          </div>

        {/* 1. Appearance & Desktop */}
        <section className="ap-card p-5 space-y-4">
          <h2 className="text-[14.5px] font-semibold">{t.secAppearance}</h2>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[13.5px]" style={{ color: 'var(--text-2)' }}>
              {t.themeLabel}
            </span>
            <SegmentedControl<ThemeMode>
              value={config.theme}
              onChange={(theme) => void updateConfig({ theme })}
              options={[
                { value: 'system', label: t.themeSystem },
                { value: 'light', label: t.themeLight },
                { value: 'dark', label: t.themeDark },
              ]}
            />
          </div>

          <div
            className="flex flex-wrap items-center justify-between gap-3 pt-3.5"
            style={{ borderTop: '1px solid var(--hairline-soft)' }}
          >
            <span className="text-[13.5px]" style={{ color: 'var(--text-2)' }}>
              {t.accentLabel}
            </span>
            <div className="flex items-center gap-2.5">
              {ACCENTS.map((a) => {
                const active = config.accent === a.key;
                return (
                  <button
                    key={a.key}
                    type="button"
                    title={a.label}
                    onClick={() => void updateConfig({ accent: a.key })}
                    className="w-6 h-6 rounded-full transition-transform hover:scale-110"
                    style={{
                      background: a.swatch,
                      outline: active ? '2px solid var(--text-1)' : 'none',
                      outlineOffset: '2px',
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div
            className="flex flex-wrap items-center justify-between gap-3 pt-3.5"
            style={{ borderTop: '1px solid var(--hairline-soft)' }}
          >
            <span className="text-[13.5px]" style={{ color: 'var(--text-2)' }}>
              {t.langLabel}
            </span>
            <SegmentedControl<Lang>
              value={config.lang}
              onChange={(lang) => void updateConfig({ lang })}
              options={[
                { value: 'zh', label: '简体中文' },
                { value: 'en', label: 'English' },
              ]}
            />
          </div>

          <div
            className="flex items-center justify-between gap-4 pt-3.5"
            style={{ borderTop: '1px solid var(--hairline-soft)' }}
          >
            <div>
              <div className="text-[13.5px] font-medium">{t.closeToTrayLabel}</div>
              <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                {t.closeToTrayDesc}
              </div>
            </div>
            <ToggleSwitch
              checked={config.closeToTray}
              onToggle={() => void updateConfig({ closeToTray: !config.closeToTray })}
            />
          </div>

          <div
            className="flex items-center justify-between gap-4 pt-3.5"
            style={{ borderTop: '1px solid var(--hairline-soft)' }}
          >
            <div>
              <div className="text-[13.5px] font-medium">{t.autostartLabel}</div>
              <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                {t.autostartDesc}
              </div>
            </div>
            <ToggleSwitch
              checked={autostart}
              disabled={autostartBusy}
              onToggle={() => void handleToggleAutostart()}
            />
          </div>
        </section>

        {/* 1.5 Global Quick Capture Shortcut */}
        <section className="ap-card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <h2 className="text-[14.5px] font-semibold">{t.secQuickCapture}</h2>
            </div>
            <button
              type="button"
              onClick={() => void openQuickCapture()}
              className="ap-btn ap-btn-primary ap-btn-sm"
            >
              <Zap className="w-3.5 h-3.5" />
              {t.qcTestBtn}
            </button>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[13.5px] font-medium">{t.qcEnabledLabel}</div>
              <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                {t.qcEnabledDesc}
              </div>
            </div>
            <ToggleSwitch
              checked={config.quickCaptureEnabled}
              onToggle={() =>
                void updateQuickCaptureShortcut(
                  config.quickCaptureShortcut,
                  !config.quickCaptureEnabled,
                )
              }
            />
          </div>

          <div
            className="pt-3.5 space-y-2"
            style={{ borderTop: '1px solid var(--hairline-soft)' }}
          >
            <div>
              <div className="text-[13.5px] font-medium">{t.qcShortcutLabel}</div>
              <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                {t.qcShortcutHint}
              </div>
            </div>
            <ShortcutRecorder
              value={config.quickCaptureShortcut}
              disabled={!config.quickCaptureEnabled}
              lang={config.lang}
              onChange={(nextShortcut) =>
                updateQuickCaptureShortcut(nextShortcut, config.quickCaptureEnabled)
              }
            />
            {!desktop && (
              <div className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                {t.qcDesktopOnly}
              </div>
            )}
          </div>

          <div
            className="flex flex-wrap items-center justify-between gap-3 pt-3.5"
            style={{ borderTop: '1px solid var(--hairline-soft)' }}
          >
            <span className="text-[13.5px] font-medium">{t.qcDefaultModeLabel}</span>
            <SegmentedControl<QuickCaptureDefaultMode>
              value={config.quickCaptureDefaultMode || 'last'}
              onChange={(quickCaptureDefaultMode) =>
                void updateConfig({ quickCaptureDefaultMode })
              }
              options={[
                { value: 'last', label: t.qcModeLast },
                { value: 'note', label: t.qcModeNote },
                { value: 'task', label: t.qcModeTask },
              ]}
            />
          </div>

          {/* Desktop Sticky Global Shortcut */}
          <div
            className="pt-4 space-y-3.5"
            style={{ borderTop: '1px solid var(--hairline)' }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <StickyNote className="w-4 h-4" style={{ color: 'var(--sticky-yellow-dot)' }} />
                <h3 className="text-[14px] font-semibold">{t.stickyShortcutSectionTitle}</h3>
              </div>
              <button
                type="button"
                onClick={() => void openNewDraftSticky('yellow')}
                className="ap-btn ap-btn-sm"
              >
                <StickyNote className="w-3.5 h-3.5" />
                {t.stickyTestBtn}
              </button>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[13.5px] font-medium">{t.stickyShortcutEnabledLabel}</div>
                <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                  {t.stickyShortcutEnabledDesc}
                </div>
              </div>
              <ToggleSwitch
                checked={config.stickyShortcutEnabled}
                onToggle={() =>
                  void updateStickyShortcut(
                    config.stickyShortcut,
                    !config.stickyShortcutEnabled,
                  )
                }
              />
            </div>

            <div className="space-y-2">
              <div>
                <div className="text-[13.5px] font-medium">{t.stickyShortcutLabel}</div>
                <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                  {t.stickyShortcutHint}
                </div>
              </div>
              <ShortcutRecorder
                value={config.stickyShortcut}
                defaultValue={defaultStickyShortcut()}
                disabled={!config.stickyShortcutEnabled}
                lang={config.lang}
                onChange={(nextShortcut) =>
                  updateStickyShortcut(nextShortcut, config.stickyShortcutEnabled)
                }
              />
            </div>
          </div>
        </section>

        {/* 2. Mutually-Exclusive Data Storage Mode (Local Folder OR Git Cloud Sync) */}
        <section className="ap-card p-5 space-y-4">
          <div>
            <h2 className="text-[14.5px] font-semibold">{t.secStorageMode}</h2>
            <p className="text-[12.5px] mt-1" style={{ color: 'var(--text-3)' }}>
              {t.storageModeDesc}
            </p>
          </div>

          {/* Two-Option Exclusive Selector Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                if (isGitMode) setPendingStorageMode('local');
              }}
              className="p-3.5 rounded-[12px] border text-left ap-ease flex flex-col gap-1.5"
              style={{
                background: !isGitMode ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                borderColor: !isGitMode ? 'var(--accent)' : 'var(--hairline)',
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: !isGitMode ? 'var(--accent)' : 'var(--text-1)' }}>
                  <HardDrive className="w-4 h-4 shrink-0" />
                  {t.storageModeLocalTitle}
                </span>
                {!isGitMode && (
                  <span
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: 'var(--status-green-soft)', color: 'var(--status-green)' }}
                  >
                    {t.storageModeActiveBadge}
                  </span>
                )}
              </div>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                {t.storageModeLocalDesc}
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!isGitMode) setPendingStorageMode('git');
              }}
              className="p-3.5 rounded-[12px] border text-left ap-ease flex flex-col gap-1.5"
              style={{
                background: isGitMode ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                borderColor: isGitMode ? 'var(--accent)' : 'var(--hairline)',
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: isGitMode ? 'var(--accent)' : 'var(--text-1)' }}>
                  <GitBranch className="w-4 h-4 shrink-0" />
                  {t.storageModeGitTitle}
                </span>
                {isGitMode && (
                  <span
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: 'var(--status-green-soft)', color: 'var(--status-green)' }}
                  >
                    {t.storageModeActiveBadge}
                  </span>
                )}
              </div>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                {t.storageModeGitDesc}
              </p>
            </button>
          </div>

          {/* Active Mode Panel */}
          {!isGitMode ? (
            <div
              className="pt-4 space-y-3.5"
              style={{ borderTop: '1px solid var(--hairline-soft)' }}
            >
              <div className="space-y-1.5">
                <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                  {t.currentDirLabel}
                </div>
                <div
                  className="px-3 py-2 rounded-[9px] text-[13px] font-mono break-all"
                  style={{ background: 'var(--bg-subtle)', color: 'var(--text-1)' }}
                >
                  {config.localDataDir || config.dataDir || '—'}
                </div>
              </div>
              {desktop && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void storageApi.openDataDir()}
                    className="ap-btn ap-btn-sm"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    {t.openDirBtn}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handlePickDir()}
                    className="ap-btn ap-btn-primary ap-btn-sm"
                  >
                    <FolderSync className="w-3.5 h-3.5" />
                    {t.switchDirBtn}
                  </button>
                </div>
              )}
              <div
                className="px-3 py-2 rounded-[9px] text-[12px]"
                style={{ background: 'var(--bg-subtle)', color: 'var(--text-3)' }}
              >
                {t.storageModeLocalGitOff}
              </div>
            </div>
          ) : (
            <div
              className="pt-4 space-y-4"
              style={{ borderTop: '1px solid var(--hairline-soft)' }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                    {t.storageModeGitDirLabel}
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className="px-3 py-1.5 rounded-[9px] text-[12.5px] font-mono break-all flex-1"
                      style={{ background: 'var(--bg-subtle)', color: 'var(--text-1)' }}
                    >
                      {config.gitDataDir || config.dataDir || '—'}
                    </div>
                    {desktop && (
                      <button
                        type="button"
                        onClick={() => void storageApi.openDataDir()}
                        className="ap-btn ap-btn-sm shrink-0"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        {t.openDirBtn}
                      </button>
                    )}
                  </div>
                </div>

                {desktop && gitStatus && (
                  <div
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium shrink-0 self-end"
                    style={{
                      background: !gitStatus.gitAvailable
                        ? 'var(--status-red-soft)'
                        : gitStatus.isRepo
                          ? gitStatus.dirtyCount > 0
                            ? 'var(--status-orange-soft)'
                            : 'var(--status-green-soft)'
                          : 'var(--bg-subtle)',
                      color: !gitStatus.gitAvailable
                        ? 'var(--status-red)'
                        : gitStatus.isRepo
                          ? gitStatus.dirtyCount > 0
                            ? 'var(--status-orange)'
                            : 'var(--status-green)'
                          : 'var(--text-2)',
                    }}
                  >
                    {gitStatus.isRepo
                      ? `${gitStatus.branch || 'main'} · ${
                          gitStatus.dirtyCount > 0
                            ? t.gitDirtyCount(gitStatus.dirtyCount)
                            : t.gitSyncedClean
                        }`
                      : gitStatus.gitAvailable
                        ? gitStatus.gitVersion || 'Git Ready'
                        : 'Git Missing'}
                  </div>
                )}
              </div>

          {desktop && gitStatus && !gitStatus.gitAvailable && (
            <div
              className="px-3.5 py-2.5 rounded-[10px] flex items-center gap-2 text-[12.5px]"
              style={{ background: 'var(--status-red-soft)', color: 'var(--status-red)' }}
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{t.gitNotInstalled}</span>
            </div>
          )}

          {!desktop && (
            <div
              className="px-3.5 py-2 rounded-[10px] text-[12px]"
              style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
            >
              {zh
                ? '当前为浏览器预览模式，Git 同步需在 macOS / Windows 桌面客户端中使用本机 Git 执行。'
                : 'Browser preview mode: Git sync runs via local Git CLI inside the desktop app.'}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-3 space-y-1.5">
              <label className="text-[12px] font-medium block" style={{ color: 'var(--text-2)' }}>
                {t.gitRemoteLabel}
              </label>
              <input
                type="text"
                value={gitRemoteUrl}
                onChange={(e) => setGitRemoteUrl(e.target.value)}
                placeholder={t.gitRemotePh}
                className="ap-input w-full font-mono text-[12.5px]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium block" style={{ color: 'var(--text-2)' }}>
                {t.gitBranchLabel}
              </label>
              <input
                type="text"
                value={gitBranch}
                onChange={(e) => setGitBranch(e.target.value)}
                placeholder="main"
                className="ap-input w-full font-mono text-[12.5px]"
              />
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
                {t.gitAuthLabel}
              </span>
              <SegmentedControl<GitAuthMode>
                value={gitAuthMode}
                onChange={(mode) => {
                  setGitAuthMode(mode);
                  void updateConfig({ gitAuthMode: mode });
                }}
                options={[
                  { value: 'system', label: t.gitAuthSystem },
                  { value: 'https_token', label: t.gitAuthToken },
                ]}
              />
            </div>

            {gitAuthMode === 'https_token' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <input
                  type="text"
                  value={gitUsername}
                  onChange={(e) => setGitUsername(e.target.value)}
                  onBlur={() => void persistGitSettings()}
                  placeholder={t.gitUserPh}
                  className="ap-input w-full text-[12.5px]"
                />
                <div className="relative w-full">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={gitToken}
                    onChange={(e) => setGitToken(e.target.value)}
                    onBlur={() => void persistGitSettings()}
                    placeholder={t.gitTokenPh}
                    className="ap-input w-full text-[12.5px] pr-9 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded"
                    style={{ color: 'var(--text-3)' }}
                    aria-label="Toggle token visibility"
                  >
                    {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Git Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={!desktop || gitBusy}
              onClick={() => void handleGitTest()}
              className="ap-btn ap-btn-sm disabled:opacity-50"
            >
              <Wifi className="w-3.5 h-3.5" />
              {testingGit ? (zh ? '测试中…' : 'Testing…') : t.gitTestBtn}
            </button>
            <button
              type="button"
              disabled={!desktop || gitBusy}
              onClick={() => void handleGitBind()}
              className="ap-btn ap-btn-sm disabled:opacity-50"
            >
              <Link2 className="w-3.5 h-3.5" />
              {t.gitBindBtn}
            </button>
            <button
              type="button"
              disabled={!desktop || gitBusy}
              onClick={() => void handleGitClone()}
              className="ap-btn ap-btn-sm disabled:opacity-50"
            >
              <CloudDownload className="w-3.5 h-3.5" />
              {t.gitCloneBtn}
            </button>
            <button
              type="button"
              disabled={!desktop || gitBusy || !gitConfigured}
              onClick={() => void handleGitSyncNow()}
              className="ap-btn ap-btn-primary ap-btn-sm disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${gitSyncState === 'syncing' ? 'animate-spin' : ''}`}
              />
              {gitSyncState === 'syncing' ? t.gitSyncing : t.gitSyncNowBtn}
            </button>
            {config.gitLastSyncAt && (
              <span className="text-[11.5px] ml-auto" style={{ color: 'var(--text-3)' }}>
                {zh ? '上次同步：' : 'Last sync: '}
                {new Date(config.gitLastSyncAt).toLocaleString()}
              </span>
            )}
          </div>

          {gitTestMsg && (
            <div
              className="px-3 py-2 rounded-[9px] flex items-center gap-2 text-[12px]"
              style={{
                background: gitTestMsg.ok ? 'var(--status-green-soft)' : 'var(--status-red-soft)',
                color: gitTestMsg.ok ? 'var(--status-green)' : 'var(--status-red)',
              }}
            >
              {gitTestMsg.ok ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="break-all">{gitTestMsg.text}</span>
            </div>
          )}

          {gitLastError && (
            <div
              className="px-3 py-2 rounded-[9px] flex items-center gap-2 text-[12px]"
              style={{ background: 'var(--status-red-soft)', color: 'var(--status-red)' }}
            >
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="break-all">{gitLastError}</span>
            </div>
          )}

          {/* Git Automation Toggles */}
          <div
            className="flex items-center justify-between gap-4 pt-3.5"
            style={{ borderTop: '1px solid var(--hairline-soft)' }}
          >
            <div>
              <div className="text-[13.5px] font-medium">{t.gitPullOnStartLabel}</div>
              <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                {t.gitPullOnStartDesc}
              </div>
            </div>
            <ToggleSwitch
              checked={config.gitPullOnStart}
              onToggle={() => void updateConfig({ gitPullOnStart: !config.gitPullOnStart })}
            />
          </div>

          <div
            className="flex items-center justify-between gap-4 pt-3.5"
            style={{ borderTop: '1px solid var(--hairline-soft)' }}
          >
            <div>
              <div className="text-[13.5px] font-medium">{t.gitAutoPushLabel}</div>
              <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                {t.gitAutoPushDesc}
              </div>
            </div>
            <ToggleSwitch
              checked={config.gitAutoPush}
              onToggle={() => void updateConfig({ gitAutoPush: !config.gitAutoPush })}
            />
          </div>

          {/* Recent Git Commits */}
          {gitStatus && gitStatus.recentCommits.length > 0 && (
            <div
              className="pt-3.5 space-y-2"
              style={{ borderTop: '1px solid var(--hairline-soft)' }}
            >
              <div className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
                <GitCommitHorizontal className="w-3.5 h-3.5" />
                {t.gitRecentCommits}
              </div>
              <div
                className="rounded-[10px] px-3 py-1.5 ap-divide"
                style={{ background: 'var(--bg-subtle)' }}
              >
                {gitStatus.recentCommits.slice(0, 6).map((c) => (
                  <div
                    key={c.hash}
                    className="py-1.5 flex items-center gap-2.5 text-[12px]"
                  >
                    <span
                      className="font-mono text-[11px] px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: 'var(--bg-card)', color: 'var(--accent)' }}
                    >
                      {c.hash}
                    </span>
                    <span className="truncate flex-1" style={{ color: 'var(--text-1)' }}>
                      {c.message}
                    </span>
                    <span className="text-[11px] shrink-0" style={{ color: 'var(--text-3)' }}>
                      {c.date.slice(0, 16)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
            </div>
          )}
        </section>

        {/* 4. Automatic Daily Snapshots */}
        <section className="ap-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <h2 className="text-[14.5px] font-semibold">{t.secSnapshots}</h2>
          </div>
          {snapshots.length === 0 ? (
            <p className="text-[12.5px]" style={{ color: 'var(--text-3)' }}>
              {t.noSnapshots}
            </p>
          ) : (
            <div className="ap-divide">
              {snapshots.map((snap) => (
                <div
                  key={snap.dateKey}
                  className="py-2.5 flex items-center justify-between gap-3 text-[13px]"
                >
                  <div>
                    <span className="font-semibold">{snap.dateKey}</span>
                    <span className="ml-2 text-[12px]" style={{ color: 'var(--text-3)' }}>
                      ({snap.fileCount} files)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRestoreKey(snap.dateKey)}
                    className="ap-btn ap-btn-sm"
                  >
                    {t.restoreBtn}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 5. Backup & Cleanup */}
        <section className="ap-card p-5 space-y-3.5">
          <h2 className="text-[14.5px] font-semibold">{t.secBackup}</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleExportJson} className="ap-btn ap-btn-primary ap-btn-sm">
              <Download className="w-3.5 h-3.5" />
              {t.exportJsonBtn}
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="ap-btn ap-btn-sm"
            >
              <Upload className="w-3.5 h-3.5" />
              {t.importJsonBtn}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={() => void cleanupOrphanAttachments()}
              className="ap-btn ap-btn-sm"
            >
              <Eraser className="w-3.5 h-3.5" />
              {t.cleanupOrphansBtn}
            </button>
            <button
              type="button"
              onClick={() => setConfirmWipe(true)}
              className="ap-btn ap-btn-danger ap-btn-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t.wipeAllBtn}
            </button>
          </div>
        </section>

        {/* 6. Version & Native In-App Updates */}
        <section id="settings-update-section" className="ap-card p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[14.5px] font-semibold">{t.secUpdate}</h2>
              <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                Anchor v{APP_VERSION} · github.com/779235394/anchor
              </p>
              <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                {t.updateAutoCheckHint}
              </p>
            </div>
            <button
              type="button"
              disabled={updateState.status === 'checking' || updateState.status === 'downloading'}
              onClick={() => void checkForUpdates(false)}
              className="ap-btn ap-btn-sm disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${updateState.status === 'checking' ? 'animate-spin' : ''}`}
              />
              {updateState.status === 'checking' ? t.checkingUpdate : t.checkUpdateBtn}
            </button>
          </div>

          {config.ignoredUpdateVersion && (
            <div
              className="px-3 py-2 rounded-[9px] flex items-center justify-between gap-2 text-[12px]"
              style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
            >
              <span>{t.updateSkippedNotice(config.ignoredUpdateVersion)}</span>
              <button
                type="button"
                onClick={() => void clearIgnoredUpdateVersion()}
                className="font-medium hover:underline"
                style={{ color: 'var(--accent)' }}
              >
                {t.updateClearSkipped}
              </button>
            </div>
          )}

          {updateState.status === 'up-to-date' && (
            <div
              className="px-3 py-2 rounded-[9px] flex items-center gap-2 text-[12.5px]"
              style={{ background: 'var(--status-green-soft)', color: 'var(--status-green)' }}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{t.alreadyLatest} (v{APP_VERSION})</span>
            </div>
          )}

          {(updateState.status === 'available' || updateState.status === 'downloading') && (
            <div
              className="p-4 rounded-[12px] space-y-3 border"
              style={{
                background: 'var(--accent-soft)',
                borderColor: 'color-mix(in srgb, var(--accent) 22%, transparent)',
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold"
                  style={{ color: 'var(--accent)' }}
                >
                  <ArrowUpCircle className="w-4 h-4 shrink-0" />
                  {t.newVersionFound(updateState.version)}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void storageApi.openExternalUrl(updateState.fallbackUrl)}
                    className="ap-btn ap-btn-sm"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {t.openReleaseFallbackBtn}
                  </button>
                  {desktop && (
                    <button
                      type="button"
                      disabled={updateState.status === 'downloading'}
                      onClick={() => void downloadAndInstallUpdate()}
                      className="ap-btn ap-btn-primary ap-btn-sm disabled:opacity-60"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {updateState.status === 'downloading'
                        ? t.downloadingUpdate
                        : t.downloadUpdateBtn}
                    </button>
                  )}
                </div>
              </div>

              {updateState.status === 'downloading' && (
                <div className="space-y-1.5">
                  <div
                    className="h-2 w-full rounded-full overflow-hidden"
                    style={{ background: 'var(--bg-card)' }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-200"
                      style={{
                        width: `${Math.max(4, updateState.percent)}%`,
                        background: 'var(--accent)',
                      }}
                    />
                  </div>
                  <div
                    className="flex items-center justify-between text-[11.5px]"
                    style={{ color: 'var(--text-2)' }}
                  >
                    <span>
                      {formatBytesMb(updateState.downloadedBytes)}
                      {updateState.totalBytes ? ` / ${formatBytesMb(updateState.totalBytes)}` : ''}
                    </span>
                    <span className="font-semibold">{updateState.percent}%</span>
                  </div>
                </div>
              )}

              {updateState.body && (
                <div
                  className="rounded-[9px] px-3.5 py-2.5 max-h-[200px] overflow-y-auto text-[12.5px]"
                  style={{ background: 'var(--bg-card)' }}
                >
                  <RichTextView markdown={updateState.body} />
                </div>
              )}
            </div>
          )}

          {updateState.status === 'ready' && (
            <div
              className="p-3.5 rounded-[11px] flex flex-wrap items-center justify-between gap-3"
              style={{ background: 'var(--status-green-soft)' }}
            >
              <div
                className="flex items-center gap-2 text-[13px] font-medium"
                style={{ color: 'var(--status-green)' }}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{t.installReadyMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => void relaunchToApplyUpdate()}
                className="ap-btn ap-btn-primary ap-btn-sm"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t.relaunchNowBtn}
              </button>
            </div>
          )}

          {updateState.status === 'error' && (
            <div
              className="p-3 rounded-[10px] space-y-2.5 text-[12px]"
              style={{ background: 'var(--status-orange-soft)', color: 'var(--status-orange)' }}
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="break-all">
                  {zh ? '更新检查或下载失败：' : 'Update failed: '}
                  {updateState.error}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void checkForUpdates(false)}
                  className="ap-btn ap-btn-sm"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t.retryUpdateBtn}
                </button>
                <button
                  type="button"
                  onClick={() => void storageApi.openExternalUrl(updateState.fallbackUrl)}
                  className="ap-btn ap-btn-sm"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {t.openReleaseFallbackBtn}
                </button>
              </div>
            </div>
          )}

          {/* Copyright & Proprietary Notice */}
          <div
            className="pt-3 flex flex-wrap items-center justify-between gap-2 text-[12px]"
            style={{
              borderTop: '1px solid var(--hairline-soft)',
              color: 'var(--text-3)',
            }}
          >
            <span>{t.copyrightText}</span>
            <span>All Rights Reserved</span>
          </div>
        </section>
        </div>
      </div>

      {/* Dialogs */}
      <ChoiceDialog<'none' | 'copy_current'>
        open={!!pendingStorageMode}
        title={t.storageSwitchTitle(pendingStorageMode === 'git')}
        body={
          pendingStorageMode
            ? t.storageSwitchBody(
                pendingStorageMode === 'git',
                pendingStorageMode === 'git'
                  ? config.gitDataDir || 'Anchor-Git'
                  : config.localDataDir || 'Anchor',
              )
            : ''
        }
        cancelLabel={t.cancel}
        options={[
          { value: 'none', label: t.storageSwitchDirect, primary: true },
          { value: 'copy_current', label: t.storageSwitchMigrate },
        ]}
        onSelect={(migration) => {
          if (pendingStorageMode) void switchStorageMode(pendingStorageMode, migration);
          setPendingStorageMode(null);
        }}
        onCancel={() => setPendingStorageMode(null)}
      />

      <ChoiceDialog<'use_existing' | 'copy_current'>
        open={!!pendingDir}
        title={t.switchDirBtn}
        body={
          pendingDir
            ? zh
              ? `即将切换数据目录至：\n${pendingDir}\n\n请选择「使用目标目录已有数据」（适合同步另一台电脑的数据）或「迁移当前数据到新目录」。`
              : `Switch data folder to:\n${pendingDir}\n\nLoad existing files there, or copy your current workspace into it?`
            : ''
        }
        cancelLabel={t.cancel}
        options={[
          {
            value: 'use_existing',
            label: zh ? '使用目标目录数据' : 'Use existing folder',
            primary: true,
          },
          {
            value: 'copy_current',
            label: zh ? '迁移当前数据过去' : 'Copy current data',
          },
        ]}
        onSelect={(mode) => {
          if (pendingDir) void switchDataDir(pendingDir, mode);
          setPendingDir(null);
        }}
        onCancel={() => setPendingDir(null)}
      />

      <ChoiceDialog<'merge' | 'replace'>
        open={!!pendingImport}
        title={t.importJsonBtn}
        body={
          zh
            ? '请选择导入方式：「合并」将按记录 ID 保留最新修改；「覆盖」会完全替换为备份文件内容。'
            : 'Choose Merge (keep latest by record ID) or Replace (overwrite current workspace).'
        }
        cancelLabel={t.cancel}
        options={[
          { value: 'merge', label: zh ? '智能合并' : 'Merge', primary: true },
          { value: 'replace', label: zh ? '完全覆盖' : 'Replace', danger: true },
        ]}
        onSelect={(mode) => {
          if (pendingImport) importBackup(pendingImport, mode);
          setPendingImport(null);
        }}
        onCancel={() => setPendingImport(null)}
      />

      <ConfirmDialog
        open={!!restoreKey}
        title={t.restoreBtn}
        body={
          restoreKey
            ? zh
              ? `确定恢复至 ${restoreKey} 的自动快照？恢复前会自动备份当前实时数据。`
              : `Restore snapshot from ${restoreKey}? Current data will be backed up first.`
            : ''
        }
        confirmLabel={t.confirm}
        cancelLabel={t.cancel}
        onConfirm={() => {
          if (restoreKey) void restoreSnapshot(restoreKey);
          setRestoreKey(null);
        }}
        onCancel={() => setRestoreKey(null)}
      />

      <ConfirmDialog
        open={confirmWipe}
        title={t.wipeAllBtn}
        body={
          zh
            ? '这将清空全部待办、项目与灵感记录（自动快照仍会保留）。确定继续？'
            : 'This clears all live tasks, projects, and notes (daily snapshots remain on disk). Continue?'
        }
        confirmLabel={t.wipeAllBtn}
        cancelLabel={t.cancel}
        danger
        onConfirm={() => {
          wipeAllData();
          setConfirmWipe(false);
        }}
        onCancel={() => setConfirmWipe(false)}
      />
    </div>
  );
}
