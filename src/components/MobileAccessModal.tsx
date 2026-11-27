import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  Power,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import { formatPairingCountdown } from '@/domain/mobileSync';
import { getDict } from '@/i18n';
import { isTauriRuntime } from '@/services/storage';
import { useWorkbenchStore } from '@/store/workbenchStore';

function formatRelativeTime(ts: number, lang: 'zh' | 'en'): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return lang === 'zh' ? '刚刚' : 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return lang === 'zh' ? `${diffMin} 分钟前` : `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return lang === 'zh' ? `${diffHr} 小时前` : `${diffHr}h ago`;
}

export function MobileAccessModal() {
  const {
    config,
    mobileModalOpen,
    mobileStatus,
    setMobileModalOpen,
    startMobileServer,
    stopMobileServer,
    retryMobileTunnel,
    updateMobileAutoStop,
    refreshMobilePairing,
    revokeMobileSession,
    pushToast,
  } = useWorkbenchStore();

  const t = getDict(config.lang);
  const desktop = isTauriRuntime();

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const running = !!mobileStatus?.running;
  const autoStopMinutes =
    mobileStatus?.autoStopMinutes ?? config.mobileAutoStopMinutes ?? 120;
  const sessions = mobileStatus?.sessions || [];
  const tunnel = mobileStatus?.tunnel;

  useEffect(() => {
    if (!mobileModalOpen || !running) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [mobileModalOpen, running]);

  const pairExpired =
    !!mobileStatus?.pairExpiresAt && nowTick >= mobileStatus.pairExpiresAt;
  const pairConsumed = !!mobileStatus?.pairConsumed;
  const activePairUrl =
    running && !pairExpired && !pairConsumed ? mobileStatus?.pairUrl || null : null;

  useEffect(() => {
    let cancelled = false;
    if (!activePairUrl) {
      setQrSvg('');
      return;
    }
    void QRCode.toString(activePairUrl, {
      type: 'svg',
      margin: 2,
      width: 180,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#111827',
        light: '#ffffff',
      },
    })
      .then((svg) => {
        if (!cancelled) setQrSvg(svg);
      })
      .catch(() => {
        if (!cancelled) setQrSvg('');
      });
    return () => {
      cancelled = true;
    };
  }, [activePairUrl]);

  if (!mobileModalOpen) return null;

  const handleStart = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await startMobileServer(autoStopMinutes);
      pushToast(t.mobileStartedToast, 'ok');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await stopMobileServer();
      pushToast(t.mobileStoppedToast, 'info');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRetryTunnel = async () => {
    setErrorMsg(null);
    try {
      await retryMobileTunnel();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAutoStopChange = async (mins: number) => {
    setErrorMsg(null);
    try {
      await updateMobileAutoStop(mins);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCopyUrl = async () => {
    const target = activePairUrl || mobileStatus?.baseUrl;
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target);
      setCopied(true);
      pushToast(t.mobileCopiedUrl, 'ok');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const statusTone = !running
    ? { bg: 'var(--bg-subtle-hover)', color: 'var(--text-3)', label: t.mobileStatusOff }
    : tunnel?.state === 'starting'
      ? { bg: 'var(--status-orange-soft)', color: 'var(--status-orange)', label: t.mobileStatusStarting }
      : tunnel?.state === 'error'
        ? { bg: 'var(--status-red-soft)', color: 'var(--status-red)', label: t.mobileStatusOff }
        : { bg: 'var(--status-green-soft)', color: 'var(--status-green)', label: t.mobileStatusRunning };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--backdrop-mask)', backdropFilter: 'blur(8px)' }}
      onClick={() => setMobileModalOpen(false)}
    >
      <div
        className="w-full max-w-[560px] max-h-[88vh] rounded-[16px] flex flex-col overflow-hidden ap-glass-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-6 py-4 flex items-center gap-3.5 shrink-0"
          style={{ borderBottom: '1px solid var(--hairline-soft)' }}
        >
          <div
            className="w-10 h-10 rounded-[11px] flex items-center justify-center shrink-0"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <Smartphone className="w-[19px] h-[19px]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[16px] font-semibold" style={{ color: 'var(--text-1)' }}>
                {t.mobileModalTitle}
              </h2>
              <span
                className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap"
                style={{ background: statusTone.bg, color: statusTone.color }}
              >
                {statusTone.label}
              </span>
            </div>
            <p className="mt-0.5 text-[12.5px] leading-snug" style={{ color: 'var(--text-3)' }}>
              {t.mobileModalSub}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMobileModalOpen(false)}
            className="w-8 h-8 rounded-[9px] inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle-hover)] shrink-0"
            style={{ color: 'var(--text-3)' }}
            aria-label={t.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {!desktop && (
            <div
              className="px-3.5 py-2.5 rounded-[10px] text-[12.5px]"
              style={{
                background: 'var(--status-orange-soft)',
                color: 'var(--status-orange)',
              }}
            >
              {t.mobileDesktopOnly}
            </div>
          )}

          {errorMsg && (
            <div
              className="px-3.5 py-2.5 rounded-[10px] flex items-start gap-2 text-[12.5px]"
              style={{
                background: 'var(--status-red-soft)',
                color: 'var(--status-red)',
              }}
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="flex-1 break-words">{errorMsg}</span>
            </div>
          )}

          {/* Main Card: Off State vs Running QR State */}
          {!running ? (
            <div
              className="p-6 rounded-[12px] flex flex-col items-center text-center gap-3.5"
              style={{
                background: 'var(--bg-sidebar)',
                border: '1px solid var(--hairline-soft)',
              }}
            >
              <p className="text-[12.5px] leading-relaxed max-w-[340px]" style={{ color: 'var(--text-2)' }}>
                {t.mobileOffDesc}
              </p>
              <button
                type="button"
                disabled={!desktop || busy}
                onClick={() => void handleStart()}
                className="ap-btn-primary px-5 py-2.5 rounded-[11px] text-[13.5px] font-semibold inline-flex items-center gap-2"
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Power className="w-4 h-4" />
                )}
                {t.mobileStartBtn}
              </button>
            </div>
          ) : (
            <div
              className="p-5 rounded-[14px] space-y-3"
              style={{
                background: 'var(--bg-sidebar)',
                border: '1px solid var(--hairline-soft)',
              }}
            >
              {tunnel?.state === 'starting' ? (
                <div className="py-10 flex flex-col items-center justify-center text-center gap-3">
                  <Loader2
                    className="w-7 h-7 animate-spin"
                    style={{ color: 'var(--accent)' }}
                  />
                  <p className="text-[13px] max-w-[340px]" style={{ color: 'var(--text-2)' }}>
                    {t.mobileTunnelStartingTip}
                  </p>
                </div>
              ) : tunnel?.state === 'error' ? (
                <div className="py-6 flex flex-col items-center text-center gap-3.5">
                  <AlertTriangle className="w-6 h-6" style={{ color: 'var(--status-orange)' }} />
                  <p className="text-[13px] leading-relaxed max-w-[360px]" style={{ color: 'var(--text-2)' }}>
                    {tunnel.error || 'Connection failed'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleRetryTunnel()}
                    className="ap-btn-primary px-4 py-2 rounded-[10px] text-[13px] font-medium"
                  >
                    {t.mobileTunnelRetryBtn}
                  </button>
                </div>
              ) : activePairUrl && qrSvg ? (
                <div className="flex flex-col sm:flex-row items-center gap-6">
                  <div
                    className="p-3 rounded-[14px] bg-white shrink-0"
                    style={{
                      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
                      border: '1px solid rgba(15, 23, 42, 0.08)',
                    }}
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                  <div className="flex-1 min-w-0 space-y-3 text-center sm:text-left">
                    <div
                      className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap"
                      style={{
                        background: 'var(--accent-soft)',
                        color: 'var(--accent)',
                      }}
                    >
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {t.mobileQrCountdown(
                          formatPairingCountdown(mobileStatus?.pairExpiresAt ?? null, nowTick),
                        )}
                      </span>
                    </div>
                    <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                      {t.mobileQrHint}
                    </p>
                    {mobileStatus?.baseUrl && (
                      <div
                        className="px-3 py-2 rounded-[9px] text-[11.5px] font-mono truncate"
                        style={{
                          background: 'var(--bg-card)',
                          border: '1px solid var(--hairline-soft)',
                          color: 'var(--text-3)',
                        }}
                        title={mobileStatus.baseUrl}
                      >
                        {mobileStatus.baseUrl}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={() => void handleCopyUrl()}
                        className="px-3 py-1.5 rounded-[9px] text-[12.5px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap ap-ease hover:opacity-85"
                        style={{
                          background: 'var(--bg-card)',
                          border: '1px solid var(--hairline)',
                          color: 'var(--text-1)',
                        }}
                      >
                        {copied ? (
                          <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--status-green)' }} />
                        ) : (
                          <Copy className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-2)' }} />
                        )}
                        {t.mobileCopyUrlBtn}
                      </button>
                      <button
                        type="button"
                        onClick={() => void refreshMobilePairing()}
                        className="px-3 py-1.5 rounded-[9px] text-[12.5px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap ap-ease hover:opacity-85"
                        style={{
                          background: 'var(--bg-card)',
                          border: '1px solid var(--hairline)',
                          color: 'var(--text-1)',
                        }}
                      >
                        <RefreshCw className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-2)' }} />
                        {t.mobileRefreshQrBtn}
                      </button>
                    </div>
                    <div className="pt-0.5">
                      <button
                        type="button"
                        onClick={() => void handleRetryTunnel()}
                        className="text-[11.5px] hover:underline"
                        style={{ color: 'var(--text-3)' }}
                      >
                        {t.mobileTunnelSwitchLink}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-6 flex flex-col items-center text-center gap-2.5">
                  <ShieldCheck className="w-6 h-6" style={{ color: 'var(--accent)' }} />
                  <div className="text-[13.5px] font-semibold" style={{ color: 'var(--text-1)' }}>
                    {pairConsumed ? t.mobileQrConsumedTitle : t.mobileQrExpiredTitle}
                  </div>
                  <p className="text-[12.5px] leading-relaxed max-w-[360px]" style={{ color: 'var(--text-3)' }}>
                    {pairConsumed ? t.mobileQrConsumedDesc : t.mobileQrExpiredDesc}
                  </p>
                  <button
                    type="button"
                    onClick={() => void refreshMobilePairing()}
                    className="ap-btn-primary px-4 py-2 rounded-[10px] text-[12.5px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap mt-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {t.mobileRefreshQrBtn}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Connected Devices */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>
                {t.mobileDevicesTitle(sessions.length)}
              </span>
              {sessions.length > 0 && (
                <button
                  type="button"
                  onClick={() => void revokeMobileSession(undefined, true)}
                  className="text-[11.5px] font-medium hover:underline"
                  style={{ color: 'var(--status-red)' }}
                >
                  {t.mobileKickAllBtn}
                </button>
              )}
            </div>
            {sessions.length === 0 ? (
              <div
                className="px-3.5 py-3 rounded-[10px] text-[12px]"
                style={{
                  background: 'var(--bg-sidebar)',
                  color: 'var(--text-3)',
                  border: '1px dashed var(--hairline)',
                }}
              >
                {t.mobileDevicesEmpty}
              </div>
            ) : (
              <div className="space-y-1.5">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className="px-3 py-2 rounded-[10px] flex items-center gap-2.5"
                    style={{
                      background: 'var(--bg-sidebar)',
                      border: '1px solid var(--hairline-soft)',
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: 'var(--status-green)' }}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className="text-[12.5px] font-medium truncate"
                        style={{ color: 'var(--text-1)' }}
                      >
                        {s.deviceName}
                      </div>
                      <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                        {s.clientIp} · {formatRelativeTime(s.lastSeenAt, config.lang)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void revokeMobileSession(s.id, false)}
                      className="px-2.5 py-1 rounded-[7px] text-[11.5px] font-medium ap-ease hover:opacity-85"
                      style={{
                        background: 'var(--status-red-soft)',
                        color: 'var(--status-red)',
                      }}
                    >
                      {t.mobileKickBtn}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer: Auto-Stop & Stop Service Button */}
          <div
            className="pt-4 flex items-center justify-between gap-3"
            style={{ borderTop: '1px solid var(--hairline-soft)' }}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-[12.5px] font-medium whitespace-nowrap" style={{ color: 'var(--text-2)' }}>
                {t.mobileAutoStopLabel}
              </span>
              <select
                value={autoStopMinutes}
                disabled={!desktop}
                onChange={(e) => void handleAutoStopChange(Number(e.target.value))}
                className="ap-input text-[12.5px] py-1.5 pl-3 pr-8 w-auto"
              >
                <option value={30}>{t.mobileAutoStop30}</option>
                <option value={120}>{t.mobileAutoStop120}</option>
                <option value={480}>{t.mobileAutoStop480}</option>
                <option value={0}>{t.mobileAutoStopNever}</option>
              </select>
            </div>

            {running && (
              <button
                type="button"
                disabled={!desktop || busy}
                onClick={() => void handleStop()}
                className="px-4 py-2 rounded-[10px] text-[12.5px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap ap-ease shrink-0"
                style={{
                  background: 'var(--status-red-soft)',
                  color: 'var(--status-red)',
                }}
              >
                <Power className="w-3.5 h-3.5" />
                {t.mobileStopBtn}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
