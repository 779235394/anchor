import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
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
      style={{ background: 'var(--backdrop-mask)', backdropFilter: 'blur(8px)' }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[420px] rounded-[16px] p-6 space-y-4 ap-glass-modal"
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
      style={{ background: 'var(--backdrop-mask)', backdropFilter: 'blur(8px)' }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[450px] rounded-[16px] p-6 space-y-4 ap-glass-modal"
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

export function ToastHost() {
  const { toasts, dismissToast } = useWorkbenchStore();
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
            className={`ap-toast-enter px-3.5 py-2.5 rounded-full text-[13px] font-medium flex items-center gap-2 max-w-[440px] ${
              item.action ? 'pointer-events-auto' : ''
            }`}
            style={{
              background: 'var(--toast-bg)',
              color: 'var(--toast-fg)',
              boxShadow: 'var(--shadow-float)',
              backdropFilter: 'var(--glass-blur-md)',
            }}
          >
            <Icon className="w-4 h-4 shrink-0" style={{ color: iconColor }} />
            <span className="truncate">{item.message}</span>
            {item.action && (
              <button
                type="button"
                onClick={() => {
                  item.action?.onClick();
                  dismissToast(item.id);
                }}
                className="ml-1 px-2.5 py-0.5 rounded-full text-[12px] font-semibold shrink-0 ap-ease hover:opacity-85"
                style={{
                  background: 'var(--accent)',
                  color: '#ffffff',
                }}
              >
                {item.action.label}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
