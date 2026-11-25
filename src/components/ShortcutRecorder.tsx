import { useEffect, useState } from 'react';
import { Keyboard, RotateCcw } from 'lucide-react';
import { defaultQuickCaptureShortcut, isMacPlatform } from '@/services/storage';
import { getDict } from '@/i18n';
import type { Lang } from '@/domain/types';

const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
]);

const CODE_TO_KEY: Record<string, string> = {
  Space: 'Space',
  Minus: 'Minus',
  Equal: 'Equal',
  BracketLeft: 'BracketLeft',
  BracketRight: 'BracketRight',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
  Backquote: 'Backquote',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Tab: 'Tab',
};

function codeToPrimaryKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  return CODE_TO_KEY[code] || null;
}

export function formatShortcutCaps(shortcut: string, mac = isMacPlatform()): string[] {
  if (!shortcut) return [];
  return shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const low = part.toLowerCase();
      if (low === 'commandorcontrol' || low === 'cmdorctrl' || low === 'super' || low === 'meta') {
        return mac ? '⌘' : 'Ctrl';
      }
      if (low === 'control' || low === 'ctrl') return mac ? '⌃' : 'Ctrl';
      if (low === 'alt' || low === 'option') return mac ? '⌥' : 'Alt';
      if (low === 'shift') return mac ? '⇧' : 'Shift';
      if (low === 'space') return 'Space';
      return part.length === 1 ? part.toUpperCase() : part;
    });
}

interface ShortcutRecorderProps {
  value: string;
  defaultValue?: string;
  disabled?: boolean;
  lang: Lang;
  onChange: (nextShortcut: string) => Promise<{ ok: boolean; error?: string }>;
}

export function ShortcutRecorder({
  value,
  defaultValue,
  disabled,
  lang,
  onChange,
}: ShortcutRecorderProps) {
  const t = getDict(lang);
  const mac = isMacPlatform();
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!recording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.code === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(false);
        setError(null);
        return;
      }

      if (MODIFIER_CODES.has(e.code)) return;

      const primary = codeToPrimaryKey(e.code);
      if (!primary) return;

      const hasMainMod = e.metaKey || e.ctrlKey || e.altKey;
      const isFunctionOrSpace = primary === 'Space' || /^F\d+$/.test(primary);

      if (!hasMainMod && !(e.shiftKey && isFunctionOrSpace)) {
        setError(t.qcNeedModifier);
        return;
      }

      const parts: string[] = [];
      if (mac) {
        if (e.metaKey) parts.push('CommandOrControl');
        if (e.ctrlKey) parts.push('Control');
      } else {
        if (e.ctrlKey) parts.push('CommandOrControl');
        if (e.metaKey) parts.push('Super');
      }
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      parts.push(primary);

      const nextShortcut = parts.join('+');
      setRecording(false);
      setError(null);
      setSaving(true);
      void onChange(nextShortcut).then((res) => {
        setSaving(false);
        if (!res.ok && res.error) {
          setError(res.error);
        }
      });
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recording, mac, onChange, t.qcNeedModifier]);

  const caps = formatShortcutCaps(value, mac);
  const defaultSc = defaultValue || defaultQuickCaptureShortcut();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || saving}
          onClick={() => {
            setError(null);
            setRecording((v) => !v);
          }}
          className="px-3.5 py-2 rounded-[10px] inline-flex items-center gap-2.5 text-[13px] font-medium ap-ease disabled:opacity-50"
          style={{
            background: recording ? 'var(--accent-soft)' : 'var(--bg-subtle)',
            color: recording ? 'var(--accent)' : 'var(--text-1)',
            border: recording
              ? '1.5px solid var(--accent)'
              : '1px solid var(--hairline)',
            boxShadow: recording ? '0 0 0 3px var(--accent-soft)' : 'none',
          }}
        >
          <Keyboard className="w-4 h-4 shrink-0" />
          {recording ? (
            <span>{t.qcRecordingHint}</span>
          ) : caps.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              {caps.map((cap, idx) => (
                <kbd
                  key={`${cap}-${idx}`}
                  className="px-1.5 py-0.5 rounded-[6px] text-[12px] font-semibold"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--hairline)',
                    color: 'var(--text-1)',
                  }}
                >
                  {cap}
                </kbd>
              ))}
            </span>
          ) : (
            <span>{t.qcRecordBtn}</span>
          )}
        </button>

        {!recording && (
          <button
            type="button"
            disabled={disabled || saving}
            onClick={() => {
              setError(null);
              setRecording(true);
            }}
            className="ap-btn ap-btn-sm disabled:opacity-50"
          >
            {t.qcRecordBtn}
          </button>
        )}

        {value !== defaultSc && (
          <button
            type="button"
            disabled={disabled || saving}
            onClick={() => {
              setError(null);
              setRecording(false);
              setSaving(true);
              void onChange(defaultSc).then((res) => {
                setSaving(false);
                if (!res.ok && res.error) setError(res.error);
              });
            }}
            className="ap-btn ap-btn-sm disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t.qcResetShortcut}
          </button>
        )}
      </div>

      {error && (
        <div
          className="text-[12px] px-3 py-1.5 rounded-[8px]"
          style={{
            background: 'var(--status-red-soft)',
            color: 'var(--status-red)',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
