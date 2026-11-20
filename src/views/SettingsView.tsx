import { useRef, useState } from 'react';
import {
  Download,
  FolderOpen,
  FolderSync,
  History,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { AccentColor, Lang, ThemeMode, WorkspaceData } from '@/domain/types';
import { todayStr } from '@/domain/date';
import { getDict } from '@/i18n';
import { isTauriRuntime, storageApi } from '@/services/storage';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { SegmentedControl } from '@/components/SegmentedControl';
import { ChoiceDialog, ConfirmDialog } from '@/components/Dialogs';

const ACCENTS: Array<{ key: AccentColor; label: string; swatch: string }> = [
  { key: 'blue', label: 'Apple Blue', swatch: '#007AFF' },
  { key: 'indigo', label: 'Indigo', swatch: '#5856D6' },
  { key: 'teal', label: 'Calm Teal', swatch: '#0D9488' },
  { key: 'graphite', label: 'Graphite', swatch: '#636366' },
];

export function SettingsView() {
  const {
    config,
    data,
    snapshots,
    updateConfig,
    switchDataDir,
    restoreSnapshot,
    buildExportPayload,
    markExported,
    importBackup,
    clearSampleData,
    loadSampleData,
    wipeAllData,
    pushToast,
  } = useWorkbenchStore();

  const t = getDict(config.lang);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [pendingDir, setPendingDir] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<WorkspaceData | null>(null);
  const [restoreKey, setRestoreKey] = useState<string | null>(null);
  const [confirmClearSample, setConfirmClearSample] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);

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
    pushToast(config.lang === 'zh' ? '已导出全量 JSON 备份' : 'Exported JSON backup');
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
          config.lang === 'zh' ? '文件格式无效，请选择导出的 JSON 备份' : 'Invalid JSON backup file',
          'err',
        );
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="h-full overflow-y-auto px-8 py-7">
      <div className="max-w-[820px] mx-auto space-y-6">
        <div>
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
            <button
              type="button"
              role="switch"
              aria-checked={config.closeToTray}
              onClick={() => void updateConfig({ closeToTray: !config.closeToTray })}
              className="w-11 h-6 rounded-full p-0.5 ap-ease shrink-0"
              style={{
                background: config.closeToTray ? 'var(--status-green)' : 'var(--bg-subtle-hover)',
              }}
            >
              <span
                className="block w-5 h-5 rounded-full bg-white shadow transition-transform"
                style={{
                  transform: config.closeToTray ? 'translateX(20px)' : 'translateX(0)',
                }}
              />
            </button>
          </div>
        </section>

        {/* 2. Local Data Directory */}
        <section className="ap-card p-5 space-y-3.5">
          <h2 className="text-[14.5px] font-semibold">{t.secStorage}</h2>
          <div className="space-y-1.5">
            <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
              {t.currentDirLabel}
            </div>
            <div
              className="px-3 py-2 rounded-[9px] text-[13px] font-mono break-all"
              style={{ background: 'var(--bg-subtle)', color: 'var(--text-1)' }}
            >
              {config.dataDir || '—'}
            </div>
          </div>
          {isTauriRuntime() && (
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
        </section>

        {/* 3. Automatic Daily Snapshots */}
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

        {/* 4. Backup & Cleanup */}
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
            {data.meta.hasSample ? (
              <button
                type="button"
                onClick={() => setConfirmClearSample(true)}
                className="ap-btn ap-btn-danger ap-btn-sm"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {t.clearSampleBtn}
              </button>
            ) : (
              <button type="button" onClick={loadSampleData} className="ap-btn ap-btn-sm">
                <Sparkles className="w-3.5 h-3.5" />
                {t.loadSampleBtn}
              </button>
            )}
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
      </div>

      {/* Dialogs */}
      <ChoiceDialog<'use_existing' | 'copy_current'>
        open={!!pendingDir}
        title={t.switchDirBtn}
        body={
          pendingDir
            ? config.lang === 'zh'
              ? `即将切换数据目录至：\n${pendingDir}\n\n请选择「使用目标目录已有数据」（适合同步另一台电脑的数据）或「迁移当前数据到新目录」。`
              : `Switch data folder to:\n${pendingDir}\n\nLoad existing files there, or copy your current workspace into it?`
            : ''
        }
        cancelLabel={t.cancel}
        options={[
          {
            value: 'use_existing',
            label: config.lang === 'zh' ? '使用目标目录数据' : 'Use existing folder',
            primary: true,
          },
          {
            value: 'copy_current',
            label: config.lang === 'zh' ? '迁移当前数据过去' : 'Copy current data',
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
          config.lang === 'zh'
            ? '请选择导入方式：「合并」将按记录 ID 保留最新修改；「覆盖」会完全替换为备份文件内容。'
            : 'Choose Merge (keep latest by record ID) or Replace (overwrite current workspace).'
        }
        cancelLabel={t.cancel}
        options={[
          { value: 'merge', label: config.lang === 'zh' ? '智能合并' : 'Merge', primary: true },
          { value: 'replace', label: config.lang === 'zh' ? '完全覆盖' : 'Replace', danger: true },
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
            ? config.lang === 'zh'
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
        open={confirmClearSample}
        title={t.clearSampleBtn}
        body={
          config.lang === 'zh'
            ? '将精确移除所有内置示例数据，你自己创建的全部记录完整保留。'
            : 'Removes only sample entries while keeping everything you created.'
        }
        confirmLabel={t.confirm}
        cancelLabel={t.cancel}
        danger
        onConfirm={() => {
          clearSampleData();
          setConfirmClearSample(false);
        }}
        onCancel={() => setConfirmClearSample(false)}
      />

      <ConfirmDialog
        open={confirmWipe}
        title={t.wipeAllBtn}
        body={
          config.lang === 'zh'
            ? '这将清空全部待办、项目、灵感、成员、派活与每日记录（自动快照仍会保留）。确定继续？'
            : 'This clears all live workspace records (daily snapshots remain on disk). Continue?'
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
