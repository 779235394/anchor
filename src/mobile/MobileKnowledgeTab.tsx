import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Edit3,
  Eye,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { Lang } from '@/domain/types';
import {
  ensureMdFileName,
  getBaseName,
  getParentRelPath,
  joinDocRelPath,
  normalizeDocRelPath,
  sanitizeEntryName,
  stripMdExtension,
  type DocEntry,
  type DocFileContent,
  type DocSearchHit,
} from '@/domain/docs';
import { markdownToHtml } from '@/domain/markdown';
import {
  attachmentRelPathToMobileUrl,
  buildRelativeAttachmentMarkdown,
  toggleCheckboxInMarkdown,
} from '@/domain/mobileSync';
import { mobileApi, MobileApiError } from './api';

interface MobileKnowledgeTabProps {
  lang: Lang;
  docsTree: DocEntry[];
  externalOpenDocPath: string | null;
  onConsumeExternalOpenDoc: () => void;
  onRefreshDocsTree: () => Promise<void>;
  onPreviewImage: (url: string) => void;
  onToast: (msg: string, tone?: 'ok' | 'err') => void;
}

function formatUpdated(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${m}-${day} ${hh}:${mm}`;
}

export function MobileKnowledgeTab({
  lang,
  docsTree,
  externalOpenDocPath,
  onConsumeExternalOpenDoc,
  onRefreshDocsTree,
  onPreviewImage,
  onToast,
}: MobileKnowledgeTabProps) {
  const zh = lang !== 'en';

  const [currentDir, setCurrentDir] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<DocSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Active open document state
  const [activeDoc, setActiveDoc] = useState<DocFileContent | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTab, setEditTab] = useState<'source' | 'preview'>('source');
  const [draftContent, setDraftContent] = useState('');
  const [savingDoc, setSavingDoc] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [copiedMd, setCopiedMd] = useState(false);
  const [docMenuOpen, setDocMenuOpen] = useState(false);
  const [conflictDiskDoc, setConflictDiskDoc] = useState<DocFileContent | null>(null);

  // Create / Rename modal
  const [promptModal, setPromptModal] = useState<{
    kind: 'new-doc' | 'new-folder' | 'rename';
    initialValue: string;
    targetRelPath?: string;
    isDir?: boolean;
  } | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [promptBusy, setPromptBusy] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imgInputRef = useRef<HTMLInputElement | null>(null);

  const openDocument = async (relPath: string, startInEdit = false) => {
    setLoadingDoc(true);
    try {
      const doc = await mobileApi.readDocFile(relPath);
      setActiveDoc(doc);
      setDraftContent(doc.content);
      setEditing(startInEdit);
      setEditTab('source');
      setConflictDiskDoc(null);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      setLoadingDoc(false);
    }
  };

  // Support external navigation (from Global Search or Review/Notes save)
  useEffect(() => {
    if (!externalOpenDocPath) return;
    const target = externalOpenDocPath;
    onConsumeExternalOpenDoc();
    setCurrentDir(getParentRelPath(target));
    void openDocument(target, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalOpenDocPath]);

  // Debounced full-text doc search
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchHits(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void mobileApi
        .searchDocs(q)
        .then((hits) => setSearchHits(hits))
        .catch(() => setSearchHits([]))
        .finally(() => setSearching(false));
    }, 220);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Entries in currentDir
  const visibleEntries = useMemo(() => {
    const normDir = normalizeDocRelPath(currentDir);
    return docsTree
      .filter((e) => getParentRelPath(e.relPath) === normDir)
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return b.updatedAt - a.updatedAt || a.name.localeCompare(b.name);
      });
  }, [docsTree, currentDir]);

  const breadcrumbs = useMemo(() => {
    const norm = normalizeDocRelPath(currentDir);
    if (!norm) return [];
    const parts = norm.split('/');
    return parts.map((name, idx) => ({
      name,
      relPath: parts.slice(0, idx + 1).join('/'),
    }));
  }, [currentDir]);

  const renderedReadHtml = useMemo(() => {
    if (!activeDoc) return '';
    return markdownToHtml(editing ? draftContent : activeDoc.content, {
      resolveImageSrc: (src) => attachmentRelPathToMobileUrl(src) ?? src,
    });
  }, [activeDoc, editing, draftContent]);

  const handleSaveDoc = async (force = false) => {
    if (!activeDoc) return;
    setSavingDoc(true);
    try {
      const saved = await mobileApi.writeDocFile({
        relPath: activeDoc.relPath,
        content: draftContent,
        expectedUpdatedAt: activeDoc.updatedAt,
        force,
      });
      setActiveDoc(saved);
      setDraftContent(saved.content);
      setConflictDiskDoc(null);
      setEditing(false);
      await onRefreshDocsTree();
      onToast(zh ? '文档已保存' : 'Document saved', 'ok');
    } catch (err) {
      if (err instanceof MobileApiError && err.status === 409) {
        const data = err.data as { disk?: DocFileContent } | undefined;
        if (data?.disk) {
          setConflictDiskDoc(data.disk);
          return;
        }
      }
      onToast(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      setSavingDoc(false);
    }
  };

  const handleReadAreaClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    if (target.tagName === 'IMG') {
      const src = (target as HTMLImageElement).getAttribute('src');
      if (src) onPreviewImage(src);
      return;
    }

    if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox') {
      if (!activeDoc || editing) return;
      const container = e.currentTarget;
      const boxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
      const idx = boxes.indexOf(target as HTMLInputElement);
      if (idx === -1) return;
      const toggled = toggleCheckboxInMarkdown(activeDoc.content, idx);
      if (toggled === null) return;
      try {
        const saved = await mobileApi.writeDocFile({
          relPath: activeDoc.relPath,
          content: toggled,
          expectedUpdatedAt: activeDoc.updatedAt,
          force: true,
        });
        setActiveDoc(saved);
        setDraftContent(saved.content);
        void onRefreshDocsTree();
      } catch (err) {
        onToast(err instanceof Error ? err.message : String(err), 'err');
      }
    }
  };

  const insertMarkdownSnippet = (snippet: string) => {
    const el = textareaRef.current;
    if (!el) {
      setDraftContent((prev) => `${prev}${prev.endsWith('\n') || !prev ? '' : '\n'}${snippet}`);
      return;
    }
    const start = el.selectionStart ?? draftContent.length;
    const end = el.selectionEnd ?? draftContent.length;
    const next = draftContent.slice(0, start) + snippet + draftContent.slice(end);
    setDraftContent(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const handleInsertImage = async (file: File | undefined) => {
    if (!file || !activeDoc) return;
    setUploadingImg(true);
    try {
      const att = await mobileApi.uploadImage(file);
      if (att.relPath) {
        const md = `\n${buildRelativeAttachmentMarkdown(activeDoc.relPath, att.relPath, att.name)}\n`;
        insertMarkdownSnippet(md);
        onToast(zh ? '图片已插入文档' : 'Image inserted', 'ok');
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      setUploadingImg(false);
      if (imgInputRef.current) imgInputRef.current.value = '';
    }
  };

  const handleCopyMarkdown = async () => {
    if (!activeDoc) return;
    try {
      await navigator.clipboard.writeText(editing ? draftContent : activeDoc.content);
      setCopiedMd(true);
      onToast(zh ? '已复制 Markdown 原文' : 'Markdown copied', 'ok');
      setTimeout(() => setCopiedMd(false), 1600);
    } catch {
      onToast(zh ? '复制失败' : 'Copy failed', 'err');
    }
  };

  const handleDeleteEntry = async (relPath: string, isDir: boolean) => {
    const ok = window.confirm(
      zh
        ? `确认删除${isDir ? '文件夹及其内全部文档' : '文档'}「${getBaseName(relPath)}」？此操作不可撤销。`
        : `Delete ${isDir ? 'folder and all contents' : 'document'} "${getBaseName(relPath)}"?`,
    );
    if (!ok) return;
    try {
      await mobileApi.deleteDocEntry(relPath);
      if (activeDoc && (activeDoc.relPath === relPath || activeDoc.relPath.startsWith(`${relPath}/`))) {
        setActiveDoc(null);
        setEditing(false);
      }
      await onRefreshDocsTree();
      onToast(zh ? '已删除' : 'Deleted', 'ok');
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  const handleSubmitPrompt = async () => {
    if (!promptModal) return;
    const raw = promptValue.trim();
    if (!raw) return;
    setPromptBusy(true);
    try {
      if (promptModal.kind === 'new-folder') {
        const clean = sanitizeEntryName(raw);
        if (!clean) throw new Error(zh ? '文件夹名无效' : 'Invalid folder name');
        const relPath = joinDocRelPath(currentDir, clean);
        await mobileApi.createDocFolder(relPath);
        await onRefreshDocsTree();
        setPromptModal(null);
        onToast(zh ? '文件夹已创建' : 'Folder created', 'ok');
      } else if (promptModal.kind === 'new-doc') {
        const fileName = ensureMdFileName(raw);
        const relPath = joinDocRelPath(currentDir, fileName);
        const title = stripMdExtension(fileName);
        const created = await mobileApi.writeDocFile({
          relPath,
          content: `# ${title}\n\n`,
        });
        await onRefreshDocsTree();
        setPromptModal(null);
        setActiveDoc(created);
        setDraftContent(created.content);
        setEditing(true);
        setEditTab('source');
      } else if (promptModal.kind === 'rename' && promptModal.targetRelPath) {
        const parent = getParentRelPath(promptModal.targetRelPath);
        const nextName = promptModal.isDir ? sanitizeEntryName(raw) : ensureMdFileName(raw);
        if (!nextName) throw new Error(zh ? '名称无效' : 'Invalid name');
        const nextRel = joinDocRelPath(parent, nextName);
        const res = await mobileApi.renameDocEntry(promptModal.targetRelPath, nextRel);
        await onRefreshDocsTree();
        if (activeDoc?.relPath === promptModal.targetRelPath) {
          setActiveDoc((prev) => (prev ? { ...prev, relPath: res.relPath } : null));
        }
        setPromptModal(null);
        onToast(zh ? '已重命名' : 'Renamed', 'ok');
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      setPromptBusy(false);
    }
  };

  const promptDialog = promptModal ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--backdrop-mask)', backdropFilter: 'blur(8px)' }}
      onClick={() => setPromptModal(null)}
    >
      <div
        className="w-full max-w-[360px] rounded-[16px] p-4 space-y-3.5 ap-glass-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>
          {promptModal.kind === 'new-folder'
            ? zh
              ? '新建文件夹'
              : 'New Folder'
            : promptModal.kind === 'new-doc'
              ? zh
                ? '新建 Markdown 文档'
                : 'New Document'
              : zh
                ? '重命名'
                : 'Rename'}
        </div>
        <input
          type="text"
          autoFocus
          value={promptValue}
          onChange={(e) => setPromptValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSubmitPrompt();
          }}
          placeholder={
            promptModal.kind === 'new-folder'
              ? zh
                ? '输入文件夹名'
                : 'Folder name'
              : zh
                ? '输入文档标题'
                : 'Document title'
          }
          className="ap-input w-full text-[14px]"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setPromptModal(null)}
            className="px-3.5 py-2 rounded-[10px] text-[13px]"
            style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
          >
            {zh ? '取消' : 'Cancel'}
          </button>
          <button
            type="button"
            disabled={promptBusy}
            onClick={() => void handleSubmitPrompt()}
            className="ap-btn-primary px-4 py-2 rounded-[10px] text-[13px] font-semibold"
          >
            {zh ? '确定' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // Document Reading / Editing View
  if (activeDoc) {
    const docTitle = stripMdExtension(getBaseName(activeDoc.relPath));
    const dirty = editing && draftContent !== activeDoc.content;

    return (
      <div className="h-full flex flex-col">
        {/* Document Header */}
        <div
          className="px-3 py-2.5 flex items-center gap-2 shrink-0 m-glass-bar"
          style={{
            borderBottom: '1px solid var(--hairline-soft)',
          }}
        >
          <button
            type="button"
            onClick={() => {
              if (dirty && !window.confirm(zh ? '放弃未保存的修改并返回？' : 'Discard unsaved changes?')) {
                return;
              }
              setDocMenuOpen(false);
              setActiveDoc(null);
              setEditing(false);
            }}
            className="p-1.5 rounded-[8px] shrink-0"
            style={{ color: 'var(--text-2)' }}
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="min-w-0 flex-1">
            <div className="text-[14.5px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
              {docTitle}
            </div>
            <div className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
              {activeDoc.relPath}
            </div>
          </div>

          {editing ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setEditTab((t) => (t === 'source' ? 'preview' : 'source'))}
                className="p-2 rounded-[9px]"
                style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
                title={editTab === 'source' ? (zh ? '预览' : 'Preview') : zh ? '源码' : 'Edit'}
              >
                {editTab === 'source' ? <Eye className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
              </button>
              <button
                type="button"
                disabled={savingDoc}
                onClick={() => void handleSaveDoc(false)}
                className="ap-btn-primary px-3 py-1.5 rounded-[9px] text-[13px] font-semibold inline-flex items-center gap-1"
              >
                {savingDoc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {zh ? '保存' : 'Save'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 shrink-0 relative">
              <button
                type="button"
                onClick={() => {
                  setDocMenuOpen(false);
                  setDraftContent(activeDoc.content);
                  setEditing(true);
                  setEditTab('source');
                }}
                className="ap-btn-primary px-3 py-1.5 rounded-[9px] text-[13px] font-semibold inline-flex items-center gap-1 whitespace-nowrap"
              >
                <Edit3 className="w-3.5 h-3.5" />
                {zh ? '编辑' : 'Edit'}
              </button>
              <button
                type="button"
                onClick={() => setDocMenuOpen((v) => !v)}
                className="p-2 rounded-[9px]"
                style={{
                  background: docMenuOpen ? 'var(--bg-subtle)' : 'transparent',
                  color: 'var(--text-2)',
                }}
                aria-label={zh ? '更多操作' : 'More actions'}
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {docMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setDocMenuOpen(false)}
                  />
                  <div
                    className="absolute right-0 top-full mt-1.5 z-40 w-[164px] rounded-[10px] py-1.5 ap-glass-float"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setDocMenuOpen(false);
                        void handleCopyMarkdown();
                      }}
                      className="w-full px-3.5 py-2.5 text-left text-[13.5px] flex items-center gap-2.5"
                      style={{ color: 'var(--text-1)' }}
                    >
                      {copiedMd ? (
                        <Check className="w-4 h-4 shrink-0" style={{ color: 'var(--status-green)' }} />
                      ) : (
                        <Copy className="w-4 h-4 shrink-0" style={{ color: 'var(--text-2)' }} />
                      )}
                      {zh ? '复制 Markdown' : 'Copy Markdown'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDocMenuOpen(false);
                        setPromptValue(docTitle);
                        setPromptModal({
                          kind: 'rename',
                          initialValue: docTitle,
                          targetRelPath: activeDoc.relPath,
                          isDir: false,
                        });
                      }}
                      className="w-full px-3.5 py-2.5 text-left text-[13.5px] flex items-center gap-2.5"
                      style={{ color: 'var(--text-1)' }}
                    >
                      <Pencil className="w-4 h-4 shrink-0" style={{ color: 'var(--text-2)' }} />
                      {zh ? '重命名文档' : 'Rename'}
                    </button>
                    <div
                      className="my-1"
                      style={{ borderTop: '1px solid var(--hairline-soft)' }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setDocMenuOpen(false);
                        void handleDeleteEntry(activeDoc.relPath, false);
                      }}
                      className="w-full px-3.5 py-2.5 text-left text-[13.5px] flex items-center gap-2.5"
                      style={{ color: 'var(--status-red)' }}
                    >
                      <Trash2 className="w-4 h-4 shrink-0" />
                      {zh ? '删除文档' : 'Delete'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Editing quick Markdown toolbar */}
        {editing && editTab === 'source' && (
          <div
            className="px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto shrink-0"
            style={{
              background: 'var(--bg-subtle)',
              borderBottom: '1px solid var(--hairline-soft)',
            }}
          >
            {[
              { label: 'H2', val: '\n## ' },
              { label: 'B', val: '**文本**' },
              { label: '- [ ]', val: '\n- [ ] ' },
              { label: '列表', val: '\n- ' },
              { label: '代码', val: '\n```\n\n```\n' },
              { label: '引用', val: '\n> ' },
            ].map((btn) => (
              <button
                key={btn.label}
                type="button"
                onClick={() => insertMarkdownSnippet(btn.val)}
                className="px-2.5 py-1 rounded-[7px] text-[12px] font-semibold shrink-0"
                style={{ background: 'var(--bg-card)', color: 'var(--text-1)' }}
              >
                {btn.label}
              </button>
            ))}
            <input
              ref={imgInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void handleInsertImage(e.target.files?.[0])}
            />
            <button
              type="button"
              disabled={uploadingImg}
              onClick={() => imgInputRef.current?.click()}
              className="px-2.5 py-1 rounded-[7px] text-[12px] font-semibold inline-flex items-center gap-1 shrink-0"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              {uploadingImg ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ImagePlus className="w-3.5 h-3.5" />
              )}
              {zh ? '插图' : 'Photo'}
            </button>
          </div>
        )}

        {/* Conflict Warning Banner */}
        {conflictDiskDoc && (
          <div
            className="mx-4 mt-3 p-3 rounded-[12px] space-y-2 shrink-0"
            style={{
              background: 'var(--status-orange-soft)',
              border: '1px solid var(--status-orange)',
            }}
          >
            <div className="flex items-start gap-2 text-[12.5px]" style={{ color: 'var(--status-orange)' }}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {zh
                  ? '电脑端刚刚修改过这篇文档。为避免覆盖丢失内容，请选择处理方式：'
                  : 'This document was updated on desktop. Choose how to proceed:'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveDoc(conflictDiskDoc);
                  setDraftContent(conflictDiskDoc.content);
                  setConflictDiskDoc(null);
                  onToast(zh ? '已加载电脑端最新版本' : 'Loaded latest desktop version', 'ok');
                }}
                className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold"
                style={{ background: 'var(--bg-card)', color: 'var(--text-1)' }}
              >
                {zh ? '加载电脑最新' : 'Load Desktop'}
              </button>
              <button
                type="button"
                onClick={() => void handleSaveDoc(true)}
                className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold"
                style={{ background: 'var(--status-red)', color: '#ffffff' }}
              >
                {zh ? '强制覆盖保存' : 'Overwrite'}
              </button>
            </div>
          </div>
        )}

        {/* Document Body */}
        {editing && editTab === 'source' ? (
          <textarea
            ref={textareaRef}
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            placeholder={zh ? '开始书写 Markdown…' : 'Write Markdown…'}
            className="flex-1 w-full p-4 text-[15px] leading-relaxed font-mono resize-none outline-none"
            style={{
              background: 'var(--bg-canvas)',
              color: 'var(--text-1)',
            }}
          />
        ) : (
          <div className="flex-1 overflow-y-auto m-scroll px-4 py-4 pb-24">
            <div
              className="m-md-prose"
              onClick={(e) => void handleReadAreaClick(e)}
              dangerouslySetInnerHTML={{ __html: renderedReadHtml }}
            />
          </div>
        )}

        {promptDialog}
      </div>
    );
  }

  // Directory & Search View
  return (
    <div className="h-full flex flex-col">
      {/* Search + Quick Actions */}
      <div className="px-4 pt-2.5 pb-2 space-y-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-3)' }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={zh ? '全文搜索知识库文档…' : 'Search knowledge base…'}
              className="ap-input w-full pl-9 pr-8 py-2 text-[13.5px]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-3)' }}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setPromptValue('');
              setPromptModal({ kind: 'new-folder', initialValue: '' });
            }}
            className="p-2.5 rounded-[10px] shrink-0"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--hairline-soft)', color: 'var(--text-2)' }}
            title={zh ? '新建文件夹' : 'New Folder'}
          >
            <FolderPlus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setPromptValue('');
              setPromptModal({ kind: 'new-doc', initialValue: '' });
            }}
            className="ap-btn-primary p-2.5 rounded-[10px] shrink-0"
            title={zh ? '新建文档' : 'New Document'}
          >
            <FilePlus2 className="w-4 h-4" />
          </button>
        </div>

        {/* Breadcrumbs */}
        {!searchHits && (
          <div className="flex items-center gap-1 overflow-x-auto text-[12.5px]">
            <button
              type="button"
              onClick={() => setCurrentDir('')}
              className="px-2 py-0.5 rounded-[6px] font-medium shrink-0"
              style={{
                background: currentDir === '' ? 'var(--accent-soft)' : 'transparent',
                color: currentDir === '' ? 'var(--accent)' : 'var(--text-2)',
              }}
            >
              {zh ? '根目录' : 'Docs'}
            </button>
            {breadcrumbs.map((b, idx) => {
              const last = idx === breadcrumbs.length - 1;
              return (
                <div key={b.relPath} className="flex items-center gap-1 shrink-0">
                  <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-4)' }} />
                  <button
                    type="button"
                    onClick={() => setCurrentDir(b.relPath)}
                    className="px-2 py-0.5 rounded-[6px] font-medium"
                    style={{
                      background: last ? 'var(--accent-soft)' : 'transparent',
                      color: last ? 'var(--accent)' : 'var(--text-2)',
                    }}
                  >
                    {b.name}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tree / Search List */}
      <div className="flex-1 overflow-y-auto m-scroll px-4 pb-24 space-y-2">
        {loadingDoc ? (
          <div className="py-16 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
          </div>
        ) : searchHits !== null ? (
          searching ? (
            <div className="py-12 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
              {zh ? '搜索中…' : 'Searching…'}
            </div>
          ) : searchHits.length === 0 ? (
            <div className="py-12 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
              {zh ? '未找到匹配文档' : 'No matching documents'}
            </div>
          ) : (
            searchHits.map((hit) => (
              <button
                key={hit.relPath}
                type="button"
                onClick={() => void openDocument(hit.relPath, false)}
                className="w-full text-left ap-card px-3.5 py-2.5 space-y-1"
              >
                <div className="text-[14px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                  {stripMdExtension(hit.name)}
                </div>
                <div className="text-[11.5px] truncate" style={{ color: 'var(--text-3)' }}>
                  {hit.relPath}
                </div>
                {hit.snippet && (
                  <div className="text-[12.5px] line-clamp-2" style={{ color: 'var(--text-2)' }}>
                    {hit.snippet}
                  </div>
                )}
              </button>
            ))
          )
        ) : visibleEntries.length === 0 ? (
          <div className="py-16 text-center text-[13.5px]" style={{ color: 'var(--text-3)' }}>
            {zh ? '该目录下暂无文档，点右上角新建吧' : 'Empty folder — tap + above to create a doc'}
          </div>
        ) : (
          visibleEntries.map((entry) => (
            <div
              key={entry.relPath}
              className="ap-card px-3.5 py-3 flex items-center gap-3"
            >
              <button
                type="button"
                onClick={() => {
                  if (entry.isDir) {
                    setCurrentDir(entry.relPath);
                  } else {
                    void openDocument(entry.relPath, false);
                  }
                }}
                className="flex-1 min-w-0 flex items-center gap-3 text-left"
              >
                {entry.isDir ? (
                  <Folder className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} />
                ) : (
                  <FileText className="w-5 h-5 shrink-0" style={{ color: 'var(--text-2)' }} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-medium truncate" style={{ color: 'var(--text-1)' }}>
                    {entry.isDir ? entry.name : stripMdExtension(entry.name)}
                  </div>
                  <div className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                    {formatUpdated(entry.updatedAt)}
                  </div>
                </div>
                {entry.isDir && <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--text-4)' }} />}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteEntry(entry.relPath, entry.isDir)}
                className="p-1.5 rounded-[8px] shrink-0"
                style={{ color: 'var(--text-3)' }}
                aria-label="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Create / Rename Dialog */}
      {promptDialog}
    </div>
  );
}
