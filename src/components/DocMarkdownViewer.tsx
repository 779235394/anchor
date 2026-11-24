import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { markdownToHtml, sanitizeHref } from '@/domain/markdown';
import { getDict } from '@/i18n';
import { storageApi } from '@/services/storage';
import { useWorkbenchStore } from '@/store/workbenchStore';

interface DocMarkdownViewerProps {
  markdown: string;
  imageDataMap: Record<string, string>;
  onToggleTask?: (taskIndex: number) => void;
  className?: string;
}

export function DocMarkdownViewer({
  markdown,
  imageDataMap,
  onToggleTask,
  className = '',
}: DocMarkdownViewerProps) {
  const { config, pushToast } = useWorkbenchStore();
  const t = getDict(config.lang);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const html = useMemo(
    () =>
      markdownToHtml(markdown, {
        addHeadingIds: true,
        resolveImageSrc: (src) => imageDataMap[src] || src,
      }),
    [markdown, imageDataMap],
  );

  // Enhance fenced code blocks with copy button in reading mode
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const pres = Array.from(root.querySelectorAll('pre'));
    const cleanups: Array<() => void> = [];

    for (const pre of pres) {
      if (pre.querySelector('.ap-code-copy-btn')) continue;
      const codeEl = pre.querySelector('code');
      const rawCode = codeEl?.textContent || '';
      const langClass = codeEl?.className.match(/language-([^\s]+)/)?.[1] || '';

      const badge = document.createElement('div');
      badge.className = 'ap-code-copy-btn';
      badge.style.cssText =
        'position:absolute;top:6px;right:8px;display:inline-flex;align-items:center;gap:6px;font-size:11px;user-select:none;';

      if (langClass) {
        const langSpan = document.createElement('span');
        langSpan.textContent = langClass;
        langSpan.style.cssText = 'color:var(--text-4);font-family:ui-monospace,monospace;';
        badge.appendChild(langSpan);
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = t.kbCodeCopy;
      btn.style.cssText =
        'padding:2px 7px;border-radius:5px;background:var(--bg-card);border:1px solid var(--hairline);color:var(--text-2);cursor:pointer;font-size:11px;';
      const onClick = (ev: MouseEvent) => {
        ev.stopPropagation();
        void navigator.clipboard?.writeText(rawCode).then(() => {
          btn.textContent = t.kbCodeCopied;
          pushToast(t.kbCodeCopied, 'ok');
          setTimeout(() => {
            btn.textContent = t.kbCodeCopy;
          }, 1400);
        });
      };
      btn.addEventListener('click', onClick);
      badge.appendChild(btn);
      pre.appendChild(badge);
      cleanups.push(() => {
        btn.removeEventListener('click', onClick);
        badge.remove();
      });
    }

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, [html, t.kbCodeCopy, t.kbCodeCopied, pushToast]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    // 1. External links
    const anchor = target.closest('a') as HTMLAnchorElement | null;
    if (anchor) {
      e.preventDefault();
      e.stopPropagation();
      const href = sanitizeHref(anchor.getAttribute('href') || '');
      if (href) void storageApi.openExternalUrl(href);
      return;
    }

    // 2. Image lightbox
    const img = target.closest('img') as HTMLImageElement | null;
    if (img && img.src) {
      e.stopPropagation();
      setLightboxSrc(img.src);
      return;
    }

    // 3. Interactive task list checkbox
    const input = target.closest('input[type="checkbox"]') as HTMLInputElement | null;
    const label = target.closest('li[data-type="taskItem"] > label');
    if ((input || label) && onToggleTask && containerRef.current) {
      e.preventDefault();
      e.stopPropagation();
      const item = target.closest('li[data-type="taskItem"]');
      const allItems = Array.from(containerRef.current.querySelectorAll('li[data-type="taskItem"]'));
      const idx = item ? allItems.indexOf(item) : -1;
      if (idx >= 0) onToggleTask(idx);
    }
  };

  if (!markdown.trim()) {
    return (
      <div className={`text-[13.5px] italic ${className}`} style={{ color: 'var(--text-4)' }}>
        {t.kbEmptyTitle}
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        onClick={handleClick}
        className={`ap-prose ap-prose-doc ${className}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {lightboxSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
          onClick={() => setLightboxSrc(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxSrc(null)}
            className="fixed top-4 right-4 w-9 h-9 rounded-full inline-flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.16)', color: '#fff' }}
            aria-label={t.close}
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={lightboxSrc}
            alt=""
            className="max-w-[92vw] max-h-[88vh] rounded-[12px] object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
