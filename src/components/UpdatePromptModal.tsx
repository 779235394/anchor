import {
  AlertCircle,
  ArrowUpCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import { getDict } from '@/i18n';
import { isTauriRuntime, storageApi } from '@/services/storage';
import { APP_VERSION, formatBytesMb } from '@/services/updater';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { RichTextView } from '@/components/RichTextView';

export function UpdatePromptModal() {
  const {
    config,
    updateState,
    updateModalOpen,
    setUpdateModalOpen,
    snoozeUpdateModal,
    skipUpdateVersion,
    downloadAndInstallUpdate,
    relaunchToApplyUpdate,
    checkForUpdates,
  } = useWorkbenchStore();

  const t = getDict(config.lang);
  const zh = config.lang === 'zh';
  const desktop = isTauriRuntime();

  const visible =
    updateModalOpen &&
    (updateState.status === 'available' ||
      updateState.status === 'downloading' ||
      updateState.status === 'ready' ||
      updateState.status === 'error');

  if (!visible) return null;

  const isDownloading = updateState.status === 'downloading';
  const isReady = updateState.status === 'ready';
  const isError = updateState.status === 'error';

  const handleClose = () => {
    if (isDownloading) {
      setUpdateModalOpen(false);
    } else {
      snoozeUpdateModal();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: 'rgba(15, 23, 42, 0.42)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[500px] rounded-[16px] border overflow-hidden shadow-2xl"
        style={{
          background: 'var(--bg-card)',
          borderColor: 'var(--hairline)',
          boxShadow: 'var(--shadow-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-5 py-4 flex items-start justify-between gap-3"
          style={{ borderBottom: '1px solid var(--hairline-soft)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0"
              style={{
                background: isReady ? 'var(--status-green-soft)' : 'var(--accent-soft)',
                color: isReady ? 'var(--status-green)' : 'var(--accent)',
              }}
            >
              {isReady ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : (
                <ArrowUpCircle className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold tracking-[-0.015em] truncate">
                {updateState.version
                  ? t.updateModalTitle(updateState.version)
                  : t.secUpdate}
              </h2>
              {updateState.version && (
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {t.updateModalSub(APP_VERSION, updateState.version)}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            aria-label={t.close}
            className="w-7 h-7 rounded-[8px] inline-flex items-center justify-center hover:bg-[var(--bg-subtle-hover)] shrink-0"
            style={{ color: 'var(--text-3)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3.5">
          {updateState.body && (
            <div
              className="rounded-[11px] px-4 py-3 max-h-[240px] overflow-y-auto text-[12.5px] leading-relaxed"
              style={{
                background: 'var(--bg-subtle)',
                border: '1px solid var(--hairline-soft)',
              }}
            >
              <RichTextView markdown={updateState.body} />
            </div>
          )}

          {isDownloading && (
            <div className="space-y-2 pt-1">
              <div
                className="h-2 w-full rounded-full overflow-hidden"
                style={{ background: 'var(--bg-subtle)' }}
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
                className="flex items-center justify-between text-[12px]"
                style={{ color: 'var(--text-2)' }}
              >
                <span>
                  {t.downloadingUpdate} · {formatBytesMb(updateState.downloadedBytes)}
                  {updateState.totalBytes ? ` / ${formatBytesMb(updateState.totalBytes)}` : ''}
                </span>
                <span className="font-semibold">{updateState.percent}%</span>
              </div>
            </div>
          )}

          {isReady && (
            <div
              className="px-3.5 py-2.5 rounded-[10px] flex items-center gap-2 text-[13px] font-medium"
              style={{ background: 'var(--status-green-soft)', color: 'var(--status-green)' }}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{t.installReadyMsg}</span>
            </div>
          )}

          {isError && (
            <div
              className="px-3.5 py-2.5 rounded-[10px] flex items-start gap-2 text-[12.5px]"
              style={{ background: 'var(--status-orange-soft)', color: 'var(--status-orange)' }}
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="break-all">
                {zh ? '更新下载或校验失败：' : 'Update failed: '}
                {updateState.error}
              </span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-2"
          style={{
            background: 'var(--bg-subtle)',
            borderTop: '1px solid var(--hairline-soft)',
          }}
        >
          {updateState.status === 'available' ? (
            <>
              <button
                type="button"
                onClick={() => void skipUpdateVersion(updateState.version)}
                className="text-[12.5px] font-medium px-2 py-1 rounded-[7px] hover:bg-[var(--bg-subtle-hover)] ap-ease"
                style={{ color: 'var(--text-3)' }}
              >
                {t.updateModalSkip}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={snoozeUpdateModal}
                  className="ap-btn ap-btn-sm"
                >
                  {t.updateModalLater}
                </button>
                {desktop ? (
                  <button
                    type="button"
                    onClick={() => void downloadAndInstallUpdate()}
                    className="ap-btn ap-btn-primary ap-btn-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {t.updateModalNow}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void storageApi.openExternalUrl(updateState.fallbackUrl)}
                    className="ap-btn ap-btn-primary ap-btn-sm"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {t.openReleaseFallbackBtn}
                  </button>
                )}
              </div>
            </>
          ) : isDownloading ? (
            <div className="w-full flex items-center justify-between gap-2">
              <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                {zh ? '可关闭弹窗在后台继续下载' : 'You can close this window while downloading'}
              </span>
              <button
                type="button"
                onClick={() => setUpdateModalOpen(false)}
                className="ap-btn ap-btn-sm"
              >
                {t.close}
              </button>
            </div>
          ) : isReady ? (
            <>
              <button
                type="button"
                onClick={snoozeUpdateModal}
                className="ap-btn ap-btn-sm"
              >
                {t.updateModalLater}
              </button>
              <button
                type="button"
                onClick={() => void relaunchToApplyUpdate()}
                className="ap-btn ap-btn-primary ap-btn-sm"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t.relaunchNowBtn}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void storageApi.openExternalUrl(updateState.fallbackUrl)}
                className="ap-btn ap-btn-sm"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {t.openReleaseFallbackBtn}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={snoozeUpdateModal}
                  className="ap-btn ap-btn-sm"
                >
                  {t.close}
                </button>
                <button
                  type="button"
                  onClick={() => void checkForUpdates(false)}
                  className="ap-btn ap-btn-primary ap-btn-sm"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t.retryUpdateBtn}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
