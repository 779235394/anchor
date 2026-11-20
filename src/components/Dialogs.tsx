import { AlertTriangle, CheckCircle2, Info, Sparkles } from 'lucide-react';
import { getDict } from '@/i18n';
import { useWorkbenchStore } from '@/store/workbenchStore';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--backdrop-mask)', backdropFilter: 'blur(4px)' }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[420px] rounded-[16px] p-6 space-y-4"
        style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[16px] font-semibold" style={{ color: 'var(--text-1)' }}>
          {title}
        </h3>
        <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
          {body}
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="ap-btn">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`ap-btn ${danger ? 'ap-btn-danger' : 'ap-btn-primary'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

interface ChoiceDialogProps<T extends string> {
  open: boolean;
  title: string;
  body: string;
  cancelLabel: string;
  options: ChoiceOption<T>[];
  onSelect: (value: T) => void;
  onCancel: () => void;
}

export function ChoiceDialog<T extends string>({
  open,
  title,
  body,
  cancelLabel,
  options,
  onSelect,
  onCancel,
}: ChoiceDialogProps<T>) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--backdrop-mask)', backdropFilter: 'blur(4px)' }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[450px] rounded-[16px] p-6 space-y-4"
        style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[16px] font-semibold" style={{ color: 'var(--text-1)' }}>
          {title}
        </h3>
        <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
          {body}
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="ap-btn">
            {cancelLabel}
          </button>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(opt.value)}
              className={`ap-btn ${
                opt.danger ? 'ap-btn-danger' : opt.primary ? 'ap-btn-primary' : ''
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function OnboardingModal() {
  const { showOnboarding, config, chooseOnboarding } = useWorkbenchStore();
  if (!showOnboarding) return null;
  const t = getDict(config.lang);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--backdrop-mask)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="w-full max-w-[460px] rounded-[18px] p-7 space-y-5"
        style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow-modal)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-[12px] flex items-center justify-center text-white"
            style={{ background: 'var(--accent)' }}
          >
            <Sparkles className="w-5 h-5" />
          </div>
          <h2 className="text-[18px] font-semibold tracking-[-0.02em]">{t.onboardTitle}</h2>
        </div>
        <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
          {t.onboardDesc}
        </p>
        <div className="flex flex-wrap gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => void chooseOnboarding(true)}
            className="ap-btn ap-btn-primary flex-1"
          >
            {t.onboardSeed}
          </button>
          <button
            type="button"
            onClick={() => void chooseOnboarding(false)}
            className="ap-btn flex-1"
          >
            {t.onboardBlank}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ToastHost() {
  const { toasts } = useWorkbenchStore();
  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-5 right-6 z-50 flex flex-col items-end gap-2 pointer-events-none">
      {toasts.map((item) => {
        const Icon =
          item.tone === 'err' ? AlertTriangle : item.tone === 'info' ? Info : CheckCircle2;
        const iconColor =
          item.tone === 'err'
            ? 'var(--status-red)'
            : item.tone === 'info'
              ? 'var(--status-sky)'
              : 'var(--status-green)';
        return (
          <div
            key={item.id}
            className="ap-toast-enter px-3.5 py-2.5 rounded-full text-[13px] font-medium flex items-center gap-2 max-w-[360px]"
            style={{
              background: 'var(--text-1)',
              color: 'var(--bg-card)',
              boxShadow: '0 10px 28px rgba(0, 0, 0, 0.24)',
            }}
          >
            <Icon className="w-4 h-4 shrink-0" style={{ color: iconColor }} />
            <span className="truncate">{item.message}</span>
          </div>
        );
      })}
    </div>
  );
}
