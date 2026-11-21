import { useEffect, useRef, useState } from 'react';
import {
  ExternalLink,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Link2,
  Paperclip,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { createId, type Attachment } from '@/domain/types';
import { extractLocalFilePaths } from '@/domain/markdown';
import { getDict } from '@/i18n';
import { isTauriRuntime, storageApi } from '@/services/storage';
import { useWorkbenchStore } from '@/store/workbenchStore';

// Module-level cache for resolved local image data URLs so thumbnails never flicker
const imageUrlCache = new Map<string, string>();

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageFile(name: string, mime?: string): boolean {
  if (mime && mime.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|bmp|svg|heic)$/i.test(name);
}

function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const candidate = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function shortHostLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function useAttachmentSrc(att: Attachment): string {
  const [src, setSrc] = useState<string>(() => {
    if (att.dataUrl) return att.dataUrl;
    if (att.relPath && imageUrlCache.has(att.relPath)) {
      return imageUrlCache.get(att.relPath)!;
    }
    return '';
  });

  useEffect(() => {
    if (att.dataUrl) {
      setSrc(att.dataUrl);
      return;
    }
    if (!att.relPath || att.kind !== 'image') return;
    if (imageUrlCache.has(att.relPath)) {
      setSrc(imageUrlCache.get(att.relPath)!);
      return;
    }
    let alive = true;
    void storageApi
      .readAttachmentDataUrl(att.relPath)
      .then((url) => {
        if (!alive || !url) return;
        imageUrlCache.set(att.relPath!, url);
        setSrc(url);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [att.dataUrl, att.relPath, att.kind]);

  return src;
}

function ImageThumb({
  att,
  compact,
  onPreview,
  onDelete,
}: {
  att: Attachment;
  compact?: boolean;
  onPreview: (att: Attachment, src: string) => void;
  onDelete?: () => void;
}) {
  const src = useAttachmentSrc(att);
  return (
    <div
      className={`group relative overflow-hidden rounded-[9px] border cursor-pointer ap-ease ${
        compact ? 'h-16' : 'h-24'
      }`}
      style={{ borderColor: 'var(--hairline)', background: 'var(--bg-subtle)' }}
      onClick={(e) => {
        e.stopPropagation();
        onPreview(att, src);
      }}
    >
      {src ? (
        <img
          src={src}
          alt={att.name}
          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
        />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center text-[11px]"
          style={{ color: 'var(--text-3)' }}
        >
          <ImageIcon className="w-4 h-4" />
        </div>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-1 right-1 w-5 h-5 rounded-full inline-flex items-center justify-center opacity-0 group-hover:opacity-100 ap-ease"
          style={{ background: 'rgba(0,0,0,0.62)', color: '#fff' }}
          title="Delete"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export function AttachmentBadges({ attachments }: { attachments?: Attachment[] }) {
  if (!attachments || attachments.length === 0) return null;
  const links = attachments.filter((a) => a.kind === 'link').length;
  const images = attachments.filter((a) => a.kind === 'image').length;
  const files = attachments.filter((a) => a.kind === 'file').length;

  return (
    <>
      {links > 0 && (
        <span
          className="ap-pill"
          style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
        >
          <Link2 className="w-3 h-3" />
          {links}
        </span>
      )}
      {images > 0 && (
        <span
          className="ap-pill"
          style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
        >
          <ImageIcon className="w-3 h-3" />
          {images}
        </span>
      )}
      {files > 0 && (
        <span
          className="ap-pill"
          style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
        >
          <Paperclip className="w-3 h-3" />
          {files}
        </span>
      )}
    </>
  );
}

interface AttachmentPanelProps {
  attachments: Attachment[];
  onAdd: (att: Attachment) => void;
  onRemove: (attachmentId: string) => void;
  compact?: boolean;
}

const LARGE_FILE_BYTES = 10 * 1024 * 1024; // 10 MB Git-friendly warning threshold

export async function ingestBrowserFilesToAttachments(
  files: FileList | File[],
  onAdd: (att: Attachment) => void,
  onToast: (msg: string, tone?: 'ok' | 'err' | 'info') => void,
  addedMsg: string,
  largeWarnFn: (mb: string) => string,
): Promise<void> {
  const arr = Array.from(files);
  for (const f of arr) {
    try {
      const img = isImageFile(f.name, f.type);
      const buf = new Uint8Array(await f.arrayBuffer());
      if (buf.length > LARGE_FILE_BYTES) {
        onToast(largeWarnFn((buf.length / (1024 * 1024)).toFixed(1)), 'info');
      }
      if (isTauriRuntime()) {
        const saved = await storageApi.saveAttachmentBytes(
          f.name || (img ? `screenshot-${Date.now()}.png` : 'attachment'),
          f.type || 'application/octet-stream',
          buf,
        );
        onAdd({
          id: saved.id || createId(),
          kind: img ? 'image' : 'file',
          name: saved.name,
          relPath: saved.relPath,
          mimeType: saved.mimeType,
          size: saved.size,
          createdAt: Date.now(),
        });
      } else {
        let dataUrl: string | undefined;
        if (img) {
          dataUrl = await new Promise<string>((res) => {
            const r = new FileReader();
            r.onload = () => res(String(r.result || ''));
            r.readAsDataURL(f);
          });
        }
        onAdd({
          id: createId(),
          kind: img ? 'image' : 'file',
          name: f.name || (img ? 'screenshot.png' : 'file'),
          mimeType: f.type || 'application/octet-stream',
          size: f.size,
          dataUrl,
          createdAt: Date.now(),
        });
      }
      onToast(addedMsg);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    }
  }
}

export function extractPastedFiles(e: React.ClipboardEvent | ClipboardEvent): File[] {
  const items = e.clipboardData?.items;
  if (!items) return [];
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  return files;
}

export async function ingestLocalPathsToAttachments(
  rawPaths: string[],
  onAdd: (att: Attachment) => void,
  onToast: (msg: string, tone?: 'ok' | 'err' | 'info') => void,
  addedMsg: string,
  largeWarnFn: (mb: string) => string,
): Promise<number> {
  if (!isTauriRuntime() || rawPaths.length === 0) return 0;
  let count = 0;
  for (const raw of rawPaths) {
    try {
      const saved = await storageApi.tryImportLocalPath(raw);
      if (!saved) continue;
      if (saved.size > LARGE_FILE_BYTES) {
        onToast(largeWarnFn((saved.size / (1024 * 1024)).toFixed(1)), 'info');
      }
      const kind = isImageFile(saved.name, saved.mimeType) ? 'image' : 'file';
      onAdd({
        id: saved.id || createId(),
        kind,
        name: saved.name,
        relPath: saved.relPath,
        mimeType: saved.mimeType,
        size: saved.size,
        createdAt: Date.now(),
      });
      count += 1;
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    }
  }
  if (count > 0) onToast(addedMsg);
  return count;
}

/**
 * Inspects a paste event for binary images/files OR pasted local file paths (macOS Paste/Finder/WeChat).
 * Returns `true` if intercepted as attachments.
 */
export function interceptSmartPaste(
  e: React.ClipboardEvent | ClipboardEvent,
  onAdd: (att: Attachment) => void,
  onToast: (msg: string, tone?: 'ok' | 'err' | 'info') => void,
  addedMsg: string,
  largeWarnFn: (mb: string) => string,
  onFallbackInsertText?: (text: string) => void,
  onAfterAttach?: () => void,
): boolean {
  const files = extractPastedFiles(e);
  if (files.length > 0) {
    e.preventDefault();
    onAfterAttach?.();
    void ingestBrowserFilesToAttachments(files, onAdd, onToast, addedMsg, largeWarnFn);
    return true;
  }

  if (isTauriRuntime()) {
    const plain = e.clipboardData?.getData('text/plain') || '';
    const paths = extractLocalFilePaths(plain);
    if (paths.length > 0) {
      e.preventDefault();
      void ingestLocalPathsToAttachments(paths, onAdd, onToast, addedMsg, largeWarnFn).then(
        (imported) => {
          if (imported > 0) {
            onAfterAttach?.();
          } else {
            onFallbackInsertText?.(plain);
          }
        },
      );
      return true;
    }
  }
  return false;
}

export function AttachmentPanel({
  attachments,
  onAdd,
  onRemove,
  compact = false,
}: AttachmentPanelProps) {
  const { config, pushToast } = useWorkbenchStore();
  const t = getDict(config.lang);

  const [addingLink, setAddingLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [lightbox, setLightbox] = useState<{ att: Attachment; src: string } | null>(null);

  const webImgRef = useRef<HTMLInputElement | null>(null);
  const webFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setLightbox(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [lightbox]);

  const ingestFileList = async (files: FileList | File[]) => {
    await ingestBrowserFilesToAttachments(files, onAdd, pushToast, t.attAdded, t.attLargeWarn);
  };

  const handlePickNative = async (imagesOnly: boolean) => {
    if (!isTauriRuntime()) {
      if (imagesOnly) webImgRef.current?.click();
      else webFileRef.current?.click();
      return;
    }
    try {
      const paths = await storageApi.pickAttachmentFiles(imagesOnly);
      for (const srcPath of paths) {
        const saved = await storageApi.importAttachmentFile(srcPath);
        if (saved.size > LARGE_FILE_BYTES) {
          pushToast(t.attLargeWarn((saved.size / (1024 * 1024)).toFixed(1)), 'info');
        }
        const kind = imagesOnly || isImageFile(saved.name, saved.mimeType) ? 'image' : 'file';
        onAdd({
          id: saved.id || createId(),
          kind,
          name: saved.name,
          relPath: saved.relPath,
          mimeType: saved.mimeType,
          size: saved.size,
          createdAt: Date.now(),
        });
      }
      if (paths.length > 0) pushToast(t.attAdded);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  const handleAddLink = (e: React.FormEvent) => {
    e.preventDefault();
    const valid = normalizeUrl(linkUrl);
    if (!valid) {
      pushToast(t.attBadUrl, 'err');
      return;
    }
    onAdd({
      id: createId(),
      kind: 'link',
      name: linkName.trim() || shortHostLabel(valid),
      url: valid,
      createdAt: Date.now(),
    });
    setLinkUrl('');
    setLinkName('');
    setAddingLink(false);
    pushToast(t.attAdded);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pastedFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) pastedFiles.push(f);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      void ingestFileList(pastedFiles);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) {
      void ingestFileList(e.dataTransfer.files);
    }
  };

  const images = attachments.filter((a) => a.kind === 'image');
  const others = attachments.filter((a) => a.kind !== 'image');

  return (
    <div
      className="space-y-2.5 rounded-[11px] p-2.5 -mx-1 ap-ease"
      style={{
        background: dragOver ? 'var(--accent-soft)' : 'transparent',
        border: dragOver ? '1.5px dashed var(--accent)' : '1.5px dashed transparent',
      }}
      onPaste={handlePaste}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Header + 3 Quick Action Buttons */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
          {t.attTitle}
          {attachments.length > 0 ? ` (${attachments.length})` : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAddingLink((v) => !v)}
            className="ap-btn ap-btn-sm py-1 px-2 text-[11.5px]"
          >
            <Link2 className="w-3 h-3" />
            {t.attAddLink}
          </button>
          <button
            type="button"
            onClick={() => void handlePickNative(true)}
            className="ap-btn ap-btn-sm py-1 px-2 text-[11.5px]"
          >
            <ImageIcon className="w-3 h-3" />
            {t.attAddImage}
          </button>
          <button
            type="button"
            onClick={() => void handlePickNative(false)}
            className="ap-btn ap-btn-sm py-1 px-2 text-[11.5px]"
          >
            <Paperclip className="w-3 h-3" />
            {t.attAddFile}
          </button>
        </div>
      </div>

      {/* Browser fallback file inputs */}
      <input
        ref={webImgRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void ingestFileList(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={webFileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void ingestFileList(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Inline Add Link Form */}
      {addingLink && (
        <form onSubmit={handleAddLink} className="space-y-1.5 pt-0.5">
          <input
            type="text"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder={t.attUrlPh}
            className="ap-input w-full py-1.5 text-[12.5px]"
            autoFocus
          />
          <div className="flex gap-1.5">
            <input
              type="text"
              value={linkName}
              onChange={(e) => setLinkName(e.target.value)}
              placeholder={t.attNamePh}
              className="ap-input flex-1 py-1.5 text-[12.5px]"
            />
            <button type="submit" className="ap-btn ap-btn-primary ap-btn-sm">
              <Plus className="w-3.5 h-3.5" />
              {t.add}
            </button>
          </div>
        </form>
      )}

      {/* Image Thumbnail Grid */}
      {images.length > 0 && (
        <div className={`grid gap-2 ${compact ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {images.map((att) => (
            <ImageThumb
              key={att.id}
              att={att}
              compact={compact}
              onPreview={(a, src) => setLightbox({ att: a, src })}
              onDelete={() => onRemove(att.id)}
            />
          ))}
        </div>
      )}

      {/* Links & Documents List */}
      {others.length > 0 && (
        <div className="space-y-1.5">
          {others.map((att) => (
            <div
              key={att.id}
              onClick={() => void storageApi.openAttachment(att)}
              className="group flex items-center gap-2 px-2.5 py-2 rounded-[9px] cursor-pointer ap-ease border"
              style={{
                background: 'var(--bg-card)',
                borderColor: 'var(--hairline)',
              }}
            >
              {att.kind === 'link' ? (
                <Link2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
              ) : (
                <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--status-orange)' }} />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-medium truncate">{att.name}</div>
                <div className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
                  {att.kind === 'link' ? att.url : formatBytes(att.size)}
                </div>
              </div>
              <div
                className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 ap-ease"
                onClick={(e) => e.stopPropagation()}
              >
                {att.relPath && isTauriRuntime() && (
                  <button
                    type="button"
                    title={t.attReveal}
                    onClick={() => void storageApi.revealAttachment(att.relPath!)}
                    className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center hover:bg-[var(--bg-subtle)]"
                    style={{ color: 'var(--text-3)' }}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  title={t.delete}
                  onClick={() => onRemove(att.id)}
                  className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center hover:bg-[var(--status-red-soft)]"
                  style={{ color: 'var(--text-3)' }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {attachments.length === 0 && !addingLink && !compact && (
        <div
          className="text-[11.5px] leading-relaxed px-2.5 py-2 rounded-[9px]"
          style={{
            background: 'var(--bg-card)',
            border: '1px dashed var(--hairline)',
            color: 'var(--text-3)',
          }}
        >
          {t.attDropHint}
        </div>
      )}

      {/* Fullscreen Image Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6 gap-3"
          style={{ background: 'rgba(10, 12, 18, 0.82)', backdropFilter: 'blur(8px)' }}
          onClick={() => setLightbox(null)}
        >
          <div
            className="max-w-[90vw] max-h-[80vh] rounded-[14px] overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {lightbox.src ? (
              <img
                src={lightbox.src}
                alt={lightbox.att.name}
                className="max-w-[90vw] max-h-[78vh] object-contain block"
              />
            ) : (
              <div className="px-10 py-12 text-white text-sm">{lightbox.att.name}</div>
            )}
          </div>
          <div
            className="flex items-center gap-2 px-4 py-2 rounded-full text-xs text-white"
            style={{ background: 'rgba(30, 32, 38, 0.9)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="max-w-[260px] truncate font-medium">{lightbox.att.name}</span>
            {lightbox.att.relPath && isTauriRuntime() && (
              <>
                <button
                  type="button"
                  onClick={() => void storageApi.openAttachment(lightbox.att)}
                  className="px-2.5 py-1 rounded-full bg-white/15 hover:bg-white/25 inline-flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t.attOpen}
                </button>
                <button
                  type="button"
                  onClick={() => void storageApi.revealAttachment(lightbox.att.relPath!)}
                  className="px-2.5 py-1 rounded-full bg-white/15 hover:bg-white/25 inline-flex items-center gap-1"
                >
                  <FolderOpen className="w-3 h-3" />
                  {t.attReveal}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setLightbox(null)}
              className="px-2.5 py-1 rounded-full bg-white/15 hover:bg-white/25"
            >
              {t.close}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
