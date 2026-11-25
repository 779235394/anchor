import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  ListTree,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Search,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/Dialogs';
import { DocMarkdownEditor, type DocMarkdownEditorHandle } from '@/components/DocMarkdownEditor';
import { DocMarkdownViewer } from '@/components/DocMarkdownViewer';
import { EmptyState } from '@/components/EmptyState';
import { SegmentedControl } from '@/components/SegmentedControl';
import { todayStr } from '@/domain/date';
import {
  buildDocTemplate,
  buildDocTree,
  countDocStats,
  ensureMdFileName,
  extractExternalMarkdownAssets,
  extractToc,
  extractWorkspaceAttachmentRelPath,
  getBaseName,
  getParentRelPath,
  joinDocRelPath,
  sanitizeEntryName,
  stripMdExtension,
  type DocEntry,
  type DocSortBy,
  type DocTemplateKind,
  type DocTreeNode,
  type ExternalDocAssetRef,
} from '@/domain/docs';
import { buildPrintableDocHtml } from '@/domain/docExport';
import { toggleMarkdownTaskItem } from '@/domain/markdown';
import { getDict } from '@/i18n';
import { isTauriRuntime, storageApi } from '@/services/storage';
import { useWorkbenchStore } from '@/store/workbenchStore';

type DocDisplayMode = 'view' | 'edit' | 'source' | 'split';
type SaveIndicator = 'saved' | 'dirty' | 'saving';

interface ModalPromptState {
  mode: 'new-doc' | 'new-folder' | 'rename';
  parentDir: string;
  targetEntry?: DocEntry;
  initialValue: string;
  templateContent?: string;
}

interface ContextMenuState {
  entry: DocEntry;
  x: number;
  y: number;
}

interface ExternalAssetNoticeState {
  assets: ExternalDocAssetRef[];
}

export function KnowledgeView() {
  const { config, activeDocPath, setActiveDocPath, togglePinDoc, pushToast } = useWorkbenchStore();
  const t = getDict(config.lang);
  const pinnedDocs = config.pinnedDocs ?? [];

  const [entries, setEntries] = useState<DocEntry[]>([]);
  const [loadingTree, setLoadingTree] = useState(true);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<DocSortBy>('updated');

  const [content, setContent] = useState('');
  const [diskContent, setDiskContent] = useState('');
  const [saveState, setSaveState] = useState<SaveIndicator>('saved');
  const [externalConflict, setExternalConflict] = useState(false);

  const [displayMode, setDisplayMode] = useState<DocDisplayMode>('edit');
  const [focusMode, setFocusMode] = useState(false);
  const [showToc, setShowToc] = useState(false);

  const [titleDraft, setTitleDraft] = useState('');
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [promptModal, setPromptModal] = useState<ModalPromptState | null>(null);
  const [promptInput, setPromptInput] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DocEntry | null>(null);
  const [assetNotice, setAssetNotice] = useState<ExternalAssetNoticeState | null>(null);

  const [draggingRelPath, setDraggingRelPath] = useState<string | null>(null);
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);
  const [imageDataMap, setImageDataMap] = useState<Record<string, string>>({});
  const [exportingPdf, setExportingPdf] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  const diskContentRef = useRef(diskContent);
  const activePathRef = useRef(activeDocPath);
  const viewerScrollRef = useRef<HTMLDivElement | null>(null);
  const editorControlRef = useRef<DocMarkdownEditorHandle | null>(null);

  contentRef.current = content;
  diskContentRef.current = diskContent;
  activePathRef.current = activeDocPath;

  const refreshTree = useCallback(async () => {
    try {
      const list = await storageApi.listDocsTree();
      setEntries(list);
      return list;
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'err');
      return [];
    } finally {
      setLoadingTree(false);
    }
  }, [pushToast]);

  // Initial load + reload when dataDir changes
  useEffect(() => {
    let mounted = true;
    void refreshTree().then((list) => {
      if (!mounted) return;
      const cur = activePathRef.current;
      const exists = cur && list.some((e) => !e.isDir && e.relPath === cur);
      if (!exists) {
        const firstDoc = list.find((e) => !e.isDir);
        setActiveDocPath(firstDoc ? firstDoc.relPath : null);
      }
    });
    return () => {
      mounted = false;
    };
  }, [config.dataDir, config.storageMode, refreshTree, setActiveDocPath]);

  // Flush pending save immediately
  const flushSave = useCallback(
    async (targetPath?: string, targetContent?: string) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const p = targetPath ?? activePathRef.current;
      const flushedFromEditor =
        targetContent === undefined && editorControlRef.current
          ? editorControlRef.current.flush()
          : undefined;
      const c = targetContent ?? flushedFromEditor ?? contentRef.current;
      if (!p || c === diskContentRef.current) return;
      setSaveState('saving');
      try {
        const saved = await storageApi.writeDocFile(p, c);
        if (activePathRef.current === p) {
          setDiskContent(saved.content);
          setSaveState('saved');
          setExternalConflict(false);
        }
        setEntries((prev) =>
          prev.map((e) =>
            e.relPath === p ? { ...e, updatedAt: saved.updatedAt, size: saved.content.length } : e,
          ),
        );
      } catch (err) {
        setSaveState('dirty');
        pushToast(err instanceof Error ? err.message : String(err), 'err');
      }
    },
    [pushToast],
  );

  // Load active document content when activeDocPath changes
  useEffect(() => {
    setExternalConflict(false);
    if (!activeDocPath) {
      setContent('');
      setDiskContent('');
      setTitleDraft('');
      setSaveState('saved');
      return;
    }

    // Auto-expand ancestor directories of activeDocPath
    const parent = getParentRelPath(activeDocPath);
    if (parent) {
      const parts = parent.split('/');
      setExpandedDirs((prev) => {
        const next = { ...prev };
        for (let i = 1; i <= parts.length; i += 1) {
          next[parts.slice(0, i).join('/')] = true;
        }
        return next;
      });
    }

    setTitleDraft(stripMdExtension(getBaseName(activeDocPath)));
    let cancelled = false;
    void storageApi
      .readDocFile(activeDocPath)
      .then((file) => {
        if (cancelled) return;
        setContent(file.content);
        setDiskContent(file.content);
        setSaveState('saved');
      })
      .catch(() => {
        if (!cancelled) {
          setContent('');
          setDiskContent('');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeDocPath]);

  const printHtmlFallback = useCallback((html: string) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    document.body.appendChild(iframe);

    const cleanup = () => {
      try {
        iframe.remove();
      } catch {
        // ignore
      }
    };

    iframe.onload = () => {
      setTimeout(() => {
        try {
          const win = iframe.contentWindow;
          if (!win) {
            cleanup();
            return;
          }
          win.addEventListener('afterprint', cleanup, { once: true });
          win.focus();
          win.print();
          setTimeout(cleanup, 60000);
        } catch {
          cleanup();
        }
      }, 150);
    };

    const doc = iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
    } else {
      iframe.srcdoc = html;
    }
  }, []);

  const handleExportPdf = useCallback(async () => {
    const curPath = activePathRef.current;
    if (!curPath || exportingPdf) return;
    setExportingPdf(true);
    try {
      const latestMd = editorControlRef.current?.flush() ?? contentRef.current;
      await flushSave(curPath, latestMd);

      // Ensure all workspace attachment images referenced in this doc are resolved to Data URLs
      const resolvedImages: Record<string, string> = { ...imageDataMap };
      if (isTauriRuntime() && latestMd.includes('![')) {
        const regex = /!\[[^\]]*\]\(([^)\s]+)\)/g;
        let match: RegExpExecArray | null;
        const missing: Array<{ mdSrc: string; attRel: string }> = [];
        while ((match = regex.exec(latestMd)) !== null) {
          const mdSrc = match[1];
          if (resolvedImages[mdSrc]) continue;
          const attRel = extractWorkspaceAttachmentRelPath(mdSrc);
          if (attRel) missing.push({ mdSrc, attRel });
        }
        for (const item of missing) {
          try {
            const url = await storageApi.readAttachmentDataUrl(item.attRel);
            if (url) resolvedImages[item.mdSrc] = url;
          } catch {
            // ignore missing image
          }
        }
      }

      const docTitle = stripMdExtension(getBaseName(curPath)) || 'document';
      const html = buildPrintableDocHtml(docTitle, latestMd, resolvedImages);

      if (isTauriRuntime()) {
        try {
          const dest = await storageApi.exportDocPdf(docTitle, html);
          if (dest) {
            pushToast(t.kbExportedPdf(dest), 'ok');
          }
        } catch (err) {
          console.warn('[Anchor PDF Export fallback]', err);
          printHtmlFallback(html);
          pushToast(t.kbExportPdfFallback, 'info');
        }
      } else {
        printHtmlFallback(html);
        pushToast(t.kbExportPdfFallback, 'info');
      }
    } finally {
      setExportingPdf(false);
    }
  }, [exportingPdf, flushSave, imageDataMap, printHtmlFallback, pushToast, t]);

  // Listen for external filesystem changes under <dataDir>/docs/
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void storageApi
      .onDocsExternalChange(() => {
        void refreshTree().then(async (list) => {
          const cur = activePathRef.current;
          if (!cur) return;
          const stillExists = list.some((e) => !e.isDir && e.relPath === cur);
          if (!stillExists) {
            const first = list.find((e) => !e.isDir);
            setActiveDocPath(first ? first.relPath : null);
            return;
          }
          try {
            const latest = await storageApi.readDocFile(cur);
            if (latest.content === contentRef.current) {
              setDiskContent(latest.content);
              return;
            }
            if (contentRef.current === diskContentRef.current) {
              setContent(latest.content);
              setDiskContent(latest.content);
              setSaveState('saved');
            } else {
              setExternalConflict(true);
            }
          } catch {
            // ignore
          }
        });
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [refreshTree, setActiveDocPath]);

  // Resolve workspace attachment images referenced in current Markdown document (debounced)
  useEffect(() => {
    if (!isTauriRuntime() || !content || !content.includes('![')) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const regex = /!\[[^\]]*\]\(([^)\s]+)\)/g;
      const needed: Array<{ mdSrc: string; attRel: string }> = [];
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const mdSrc = match[1];
        const attRel = extractWorkspaceAttachmentRelPath(mdSrc);
        if (attRel && !imageDataMap[mdSrc]) {
          needed.push({ mdSrc, attRel });
        }
      }
      if (needed.length === 0) return;

      void Promise.all(
        needed.map(async ({ mdSrc, attRel }) => {
          try {
            const dataUrl = await storageApi.readAttachmentDataUrl(attRel);
            return [mdSrc, dataUrl] as const;
          } catch {
            return null;
          }
        }),
      ).then((pairs) => {
        if (cancelled) return;
        const patch: Record<string, string> = {};
        for (const pair of pairs) {
          if (pair) patch[pair[0]] = pair[1];
        }
        if (Object.keys(patch).length > 0) {
          setImageDataMap((prev) => ({ ...prev, ...patch }));
        }
      });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [content, imageDataMap]);

  // Close popovers on outside click
  useEffect(() => {
    const closeAll = () => {
      setNewMenuOpen(false);
      setImportMenuOpen(false);
      setMoreMenuOpen(false);
      setContextMenu(null);
    };
    window.addEventListener('click', closeAll);
    return () => window.removeEventListener('click', closeAll);
  }, []);

  const handleContentChange = useCallback(
    (nextMd: string) => {
      setContent(nextMd);
      setSaveState(nextMd === diskContentRef.current ? 'saved' : 'dirty');
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const targetPath = activePathRef.current;
      if (!targetPath) return;
      saveTimerRef.current = setTimeout(() => {
        void flushSave(targetPath, nextMd);
      }, 500);
    },
    [flushSave],
  );

  const selectDoc = async (relPath: string) => {
    if (relPath === activeDocPath) return;
    await flushSave();
    setActiveDocPath(relPath);
  };

  const openNewDocPrompt = (parentDir: string, tplKind: DocTemplateKind) => {
    const tpl = buildDocTemplate(tplKind, todayStr(), config.lang);
    setPromptModal({
      mode: 'new-doc',
      parentDir,
      initialValue: stripMdExtension(tpl.fileName),
      templateContent: tpl.content,
    });
    setPromptInput(stripMdExtension(tpl.fileName));
  };

  const openNewFolderPrompt = (parentDir: string) => {
    setPromptModal({
      mode: 'new-folder',
      parentDir,
      initialValue: '',
    });
    setPromptInput('');
  };

  const openRenamePrompt = (entry: DocEntry) => {
    const init = entry.isDir ? entry.name : stripMdExtension(entry.name);
    setPromptModal({
      mode: 'rename',
      parentDir: getParentRelPath(entry.relPath),
      targetEntry: entry,
      initialValue: init,
    });
    setPromptInput(init);
  };

  const submitPromptModal = async () => {
    if (!promptModal) return;
    const raw = promptInput.trim();
    if (!raw) return;

    try {
      if (promptModal.mode === 'new-folder') {
        const clean = sanitizeEntryName(raw);
        if (!clean) return;
        const relPath = joinDocRelPath(promptModal.parentDir, clean);
        await storageApi.createDocFolder(relPath);
        setExpandedDirs((prev) => ({ ...prev, [relPath]: true, [promptModal.parentDir]: true }));
        await refreshTree();
      } else if (promptModal.mode === 'new-doc') {
        await flushSave();
        const fileName = ensureMdFileName(raw);
        const relPath = joinDocRelPath(promptModal.parentDir, fileName);
        if (entries.some((e) => e.relPath.toLowerCase() === relPath.toLowerCase())) {
          pushToast(`${fileName} already exists`, 'err');
          return;
        }
        const initialContent =
          promptModal.templateContent ?? `# ${stripMdExtension(fileName)}\n\n`;
        await storageApi.writeDocFile(relPath, initialContent);
        if (promptModal.parentDir) {
          setExpandedDirs((prev) => ({ ...prev, [promptModal.parentDir]: true }));
        }
        await refreshTree();
        setActiveDocPath(relPath);
        setDisplayMode('edit');
      } else if (promptModal.mode === 'rename' && promptModal.targetEntry) {
        const entry = promptModal.targetEntry;
        const nextName = entry.isDir ? sanitizeEntryName(raw) : ensureMdFileName(raw);
        if (!nextName) return;
        const newRelPath = joinDocRelPath(promptModal.parentDir, nextName);
        if (newRelPath === entry.relPath) {
          setPromptModal(null);
          return;
        }
        if (activeDocPath === entry.relPath) {
          await flushSave();
        }
        const renamed = await storageApi.renameDocEntry(entry.relPath, newRelPath);
        await refreshTree();
        if (activeDocPath === entry.relPath) {
          setActiveDocPath(renamed);
        } else if (entry.isDir && activeDocPath?.startsWith(`${entry.relPath}/`)) {
          setActiveDocPath(`${renamed}/${activeDocPath.slice(entry.relPath.length + 1)}`);
        }
      }
      setPromptModal(null);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  const commitInlineTitleRename = async () => {
    if (!activeDocPath) return;
    const curName = stripMdExtension(getBaseName(activeDocPath));
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === curName) {
      setTitleDraft(curName);
      return;
    }
    const parent = getParentRelPath(activeDocPath);
    const nextFileName = ensureMdFileName(trimmed);
    const nextRelPath = joinDocRelPath(parent, nextFileName);
    if (nextRelPath === activeDocPath) return;
    try {
      await flushSave();
      const renamed = await storageApi.renameDocEntry(activeDocPath, nextRelPath);
      await refreshTree();
      setActiveDocPath(renamed);
    } catch (err) {
      setTitleDraft(curName);
      pushToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  const handleMoveEntry = async (srcRelPath: string, targetDirRelPath: string) => {
    const entry = entries.find((e) => e.relPath === srcRelPath);
    if (!entry) return;
    const curParent = getParentRelPath(srcRelPath);
    if (curParent === targetDirRelPath) return;
    if (
      entry.isDir &&
      (targetDirRelPath === srcRelPath || targetDirRelPath.startsWith(`${srcRelPath}/`))
    ) {
      return;
    }
    const newRelPath = joinDocRelPath(targetDirRelPath, entry.name);
    try {
      if (activeDocPath === srcRelPath) await flushSave();
      const moved = await storageApi.renameDocEntry(srcRelPath, newRelPath);
      if (targetDirRelPath) {
        setExpandedDirs((prev) => ({ ...prev, [targetDirRelPath]: true }));
      }
      await refreshTree();
      if (activeDocPath === srcRelPath) {
        setActiveDocPath(moved);
      } else if (entry.isDir && activeDocPath?.startsWith(`${srcRelPath}/`)) {
        setActiveDocPath(`${moved}/${activeDocPath.slice(srcRelPath.length + 1)}`);
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await storageApi.deleteDocEntry(target.relPath);
      const list = await refreshTree();
      if (
        activeDocPath === target.relPath ||
        (target.isDir && activeDocPath?.startsWith(`${target.relPath}/`))
      ) {
        const nextDoc = list.find((e) => !e.isDir);
        setActiveDocPath(nextDoc ? nextDoc.relPath : null);
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  const handleImportFolder = async (targetDir: string) => {
    if (!isTauriRuntime()) {
      pushToast(t.kbEmptyDesc, 'info');
      return;
    }
    try {
      const res = await storageApi.importMdFolder(targetDir);
      if (!res) return;
      if (res.importedDocs.length === 0) {
        pushToast(t.kbImportFolderEmpty, 'info');
        return;
      }

      // Expand target parent & imported root folder so newly imported files are immediately visible
      const expandPath = res.rootFolderRelPath;
      if (expandPath) {
        const parts = expandPath.split('/');
        setExpandedDirs((prev) => {
          const next = { ...prev };
          for (let i = 1; i <= parts.length; i += 1) {
            next[parts.slice(0, i).join('/')] = true;
          }
          return next;
        });
      }

      await refreshTree();
      const first = res.importedDocs[0];
      setActiveDocPath(first.relPath);
      pushToast(
        t.kbImportedFolderCount(getBaseName(res.rootFolderRelPath), res.importedDocs.length),
        'ok',
      );

      // Scan imported Markdown files (up to first 20) for external local asset references
      try {
        const seen = new Set<string>();
        const allRefs: ExternalDocAssetRef[] = [];
        for (const doc of res.importedDocs.slice(0, 20)) {
          const loaded = await storageApi.readDocFile(doc.relPath);
          for (const ref of extractExternalMarkdownAssets(loaded.content)) {
            if (!seen.has(ref.rawPath)) {
              seen.add(ref.rawPath);
              allRefs.push(ref);
            }
          }
        }
        if (allRefs.length > 0) {
          setAssetNotice({ assets: allRefs });
        }
      } catch {
        // ignore asset scan error
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  const handleImportMd = async (targetDir: string) => {
    if (!isTauriRuntime()) {
      pushToast(t.kbEmptyDesc, 'info');
      return;
    }
    try {
      const imported = await storageApi.importMdFiles(targetDir);
      if (imported.length > 0) {
        await refreshTree();
        const first = imported[0];
        setActiveDocPath(first.relPath);
        pushToast(t.kbImportedCount(imported.length), 'ok');

        // Inspect imported Markdown for external local asset references
        try {
          const loaded = await storageApi.readDocFile(first.relPath);
          const refs = extractExternalMarkdownAssets(loaded.content);
          if (refs.length > 0) {
            setAssetNotice({ assets: refs });
          }
        } catch {
          // ignore
        }
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'err');
    }
  };

  const inspectPastedMarkdownForAssets = useCallback((pastedText: string) => {
    const refs = extractExternalMarkdownAssets(pastedText);
    if (refs.length > 0) {
      setAssetNotice({ assets: refs });
    }
  }, []);

  const handleToggleViewerTask = (taskIndex: number) => {
    if (!activeDocPath) return;
    const nextMd = toggleMarkdownTaskItem(content, taskIndex);
    setContent(nextMd);
    void flushSave(activeDocPath, nextMd);
  };

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return entries;
    const matched = entries.filter(
      (e) => e.name.toLowerCase().includes(q) || e.relPath.toLowerCase().includes(q),
    );
    const keepSet = new Set<string>();
    for (const e of matched) {
      keepSet.add(e.relPath);
      let p = getParentRelPath(e.relPath);
      while (p) {
        keepSet.add(p);
        p = getParentRelPath(p);
      }
    }
    return entries.filter((e) => keepSet.has(e.relPath));
  }, [entries, searchQuery]);

  const treeNodes = useMemo(
    () => buildDocTree(filteredEntries, sortBy),
    [filteredEntries, sortBy],
  );

  const pinnedEntries = useMemo(() => {
    const fileMap = new Map(entries.filter((e) => !e.isDir).map((e) => [e.relPath, e]));
    return pinnedDocs.map((p) => fileMap.get(p)).filter((x): x is DocEntry => !!x);
  }, [entries, pinnedDocs]);

  const deferredContent = useDeferredValue(content);
  const tocItems = useMemo(
    () => (showToc ? extractToc(deferredContent) : []),
    [deferredContent, showToc],
  );
  const docStats = useMemo(() => countDocStats(deferredContent), [deferredContent]);
  const activeParentDir = activeDocPath ? getParentRelPath(activeDocPath) : '';
  const deleteChildCount = useMemo(() => {
    if (!deleteTarget || !deleteTarget.isDir) return 0;
    const prefix = `${deleteTarget.relPath}/`;
    return entries.filter((e) => e.relPath.startsWith(prefix)).length;
  }, [deleteTarget, entries]);

  const scrollToHeading = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const renderTreeNodes = (nodes: DocTreeNode[], depth: number) =>
    nodes.map((node) => {
      const { entry, children } = node;
      const isExpanded = searchQuery.trim().length > 0 || !!expandedDirs[entry.relPath];
      const isSelected = !entry.isDir && activeDocPath === entry.relPath;
      const isPinned = !entry.isDir && pinnedDocs.includes(entry.relPath);
      const isDropTarget = entry.isDir && dropTargetDir === entry.relPath;

      return (
        <div key={entry.relPath}>
          <div
            draggable
            onDragStart={(e) => {
              setDraggingRelPath(entry.relPath);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', entry.relPath);
            }}
            onDragEnd={() => {
              setDraggingRelPath(null);
              setDropTargetDir(null);
            }}
            onDragOver={(e) => {
              if (!entry.isDir || !draggingRelPath || draggingRelPath === entry.relPath) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDropTargetDir(entry.relPath);
            }}
            onDragLeave={() => {
              if (dropTargetDir === entry.relPath) setDropTargetDir(null);
            }}
            onDrop={(e) => {
              if (!entry.isDir) return;
              e.preventDefault();
              const src = e.dataTransfer.getData('text/plain') || draggingRelPath;
              setDraggingRelPath(null);
              setDropTargetDir(null);
              if (src) void handleMoveEntry(src, entry.relPath);
            }}
            onClick={() => {
              if (entry.isDir) {
                setExpandedDirs((prev) => ({ ...prev, [entry.relPath]: !prev[entry.relPath] }));
              } else {
                void selectDoc(entry.relPath);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ entry, x: e.clientX, y: e.clientY });
            }}
            className="group flex items-center gap-1.5 pr-1.5 py-[5px] rounded-[7px] cursor-pointer ap-ease select-none"
            style={{
              paddingLeft: `${8 + depth * 14}px`,
              background: isDropTarget
                ? 'var(--accent-soft)'
                : isSelected
                  ? 'var(--accent-soft)'
                  : 'transparent',
              color: isSelected ? 'var(--accent)' : 'var(--text-1)',
              outline: isDropTarget ? '1.5px dashed var(--accent)' : 'none',
            }}
          >
            {entry.isDir ? (
              <>
                <span className="w-3.5 h-3.5 inline-flex items-center justify-center shrink-0 opacity-60">
                  {isExpanded ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                </span>
                {isExpanded ? (
                  <FolderOpen className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                ) : (
                  <Folder className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-3)' }} />
                )}
              </>
            ) : (
              <>
                <span className="w-3.5 shrink-0" />
                <FileText
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: isSelected ? 'var(--accent)' : 'var(--text-3)' }}
                />
              </>
            )}

            <span className="flex-1 min-w-0 truncate text-[12.5px] font-medium">
              {entry.isDir ? entry.name : stripMdExtension(entry.name)}
            </span>

            {isPinned && (
              <Star
                className="w-3 h-3 shrink-0 fill-current opacity-75"
                style={{ color: 'var(--status-orange)' }}
              />
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setContextMenu({ entry, x: rect.right, y: rect.bottom + 4 });
              }}
              className="w-5 h-5 rounded-[5px] inline-flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-subtle-hover)] shrink-0"
              style={{ color: 'var(--text-3)' }}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>

          {entry.isDir && isExpanded && children.length > 0 && (
            <div>{renderTreeNodes(children, depth + 1)}</div>
          )}
        </div>
      );
    });

  return (
    <div className="h-full flex overflow-hidden" style={{ background: 'var(--bg-canvas)' }}>
      {/* Left Directory Tree Sidebar */}
      {!focusMode && (
        <aside
          className="w-[252px] shrink-0 h-full flex flex-col overflow-hidden"
          style={{
            background: 'var(--bg-card)',
            borderRight: '1px solid var(--hairline)',
          }}
        >
          {/* Tree Header */}
          <div
            className="px-3 pt-3.5 pb-2.5 space-y-2 shrink-0"
            style={{ borderBottom: '1px solid var(--hairline-soft)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <BookOpen className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
                <h1 className="text-[14px] font-semibold truncate">{t.kbTitle}</h1>
              </div>

              <button
                type="button"
                title={sortBy === 'updated' ? t.kbSortUpdated : t.kbSortName}
                onClick={() => setSortBy((s) => (s === 'updated' ? 'name' : 'updated'))}
                className="px-2 py-0.5 rounded-[6px] inline-flex items-center gap-1 text-[11px] font-medium hover:bg-[var(--bg-subtle-hover)] shrink-0 ap-ease"
                style={{ background: 'var(--bg-subtle)', color: 'var(--text-3)' }}
              >
                <ArrowUpDown className="w-3 h-3" />
                <span>{sortBy === 'updated' ? t.kbSortUpdatedShort : t.kbSortNameShort}</span>
              </button>
            </div>

            {/* Explicit Labeled Quick Action Bar */}
            <div className="grid grid-cols-3 gap-1.5 relative">
              <button
                type="button"
                title={t.kbNewDoc}
                onClick={(e) => {
                  e.stopPropagation();
                  setImportMenuOpen(false);
                  setNewMenuOpen((v) => !v);
                }}
                className="h-7 px-2 rounded-[7px] inline-flex items-center justify-center gap-1 text-[11.5px] font-medium ap-ease"
                style={{
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                }}
              >
                <FilePlus className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t.kbNewDocShort}</span>
              </button>

              <button
                type="button"
                title={t.kbNewFolder}
                onClick={() => {
                  setNewMenuOpen(false);
                  setImportMenuOpen(false);
                  openNewFolderPrompt('');
                }}
                className="h-7 px-2 rounded-[7px] inline-flex items-center justify-center gap-1 text-[11.5px] font-medium hover:bg-[var(--bg-subtle-hover)] ap-ease"
                style={{
                  background: 'var(--bg-subtle)',
                  color: 'var(--text-2)',
                }}
              >
                <FolderPlus className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t.kbNewFolderShort}</span>
              </button>

              <button
                type="button"
                title={t.kbImportMd}
                onClick={(e) => {
                  e.stopPropagation();
                  setNewMenuOpen(false);
                  setImportMenuOpen((v) => !v);
                }}
                className="h-7 px-2 rounded-[7px] inline-flex items-center justify-center gap-1 text-[11.5px] font-medium hover:bg-[var(--bg-subtle-hover)] ap-ease"
                style={{
                  background: 'var(--bg-subtle)',
                  color: 'var(--text-2)',
                }}
              >
                <Upload className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t.kbImportShort}</span>
              </button>

              {importMenuOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-8 z-30 w-40 py-1 rounded-[10px] shadow-lg"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--hairline)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setImportMenuOpen(false);
                      void handleImportMd(activeParentDir);
                    }}
                    className="w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--bg-subtle)] flex items-center gap-2"
                  >
                    <Upload className="w-3.5 h-3.5 opacity-70" />
                    {t.kbImportMd}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImportMenuOpen(false);
                      void handleImportFolder(activeParentDir);
                    }}
                    className="w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--bg-subtle)] flex items-center gap-2"
                  >
                    <FolderOpen className="w-3.5 h-3.5 opacity-70" />
                    {t.kbImportFolder}
                  </button>
                </div>
              )}

              {newMenuOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute left-0 top-8 z-30 w-40 py-1 rounded-[10px] shadow-lg"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--hairline)',
                  }}
                >
                  {(
                    [
                      ['blank', t.kbTplBlank],
                      ['daily', t.kbTplDaily],
                      ['meeting', t.kbTplMeeting],
                    ] as Array<[DocTemplateKind, string]>
                  ).map(([kind, label]) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => {
                        setNewMenuOpen(false);
                        openNewDocPrompt(activeParentDir, kind);
                      }}
                      className="w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--bg-subtle)] flex items-center gap-2"
                      style={{ color: 'var(--text-1)' }}
                    >
                      <FileText className="w-3.5 h-3.5 opacity-70" />
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative">
              <Search
                className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--text-4)' }}
              />
              <input
                id="quick-capture-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.kbSearchPh}
                className="ap-input w-full pl-8 pr-2.5 py-1 text-[12px]"
              />
            </div>
          </div>

          {/* Scrollable Directory Tree */}
          <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-3">
            {pinnedEntries.length > 0 && !searchQuery.trim() && (
              <div>
                <div
                  className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-4)' }}
                >
                  {t.kbPinned}
                </div>
                <div className="space-y-0.5">
                  {pinnedEntries.map((entry) => {
                    const selected = activeDocPath === entry.relPath;
                    return (
                      <button
                        key={`pin:${entry.relPath}`}
                        type="button"
                        onClick={() => void selectDoc(entry.relPath)}
                        className="w-full flex items-center gap-2 px-2 py-1 rounded-[7px] text-left ap-ease"
                        style={{
                          background: selected ? 'var(--accent-soft)' : 'transparent',
                          color: selected ? 'var(--accent)' : 'var(--text-1)',
                        }}
                      >
                        <Star
                          className="w-3 h-3 shrink-0 fill-current"
                          style={{ color: 'var(--status-orange)' }}
                        />
                        <span className="truncate text-[12.5px] font-medium">
                          {stripMdExtension(entry.name)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Drop-to-root target when dragging */}
            {draggingRelPath && getParentRelPath(draggingRelPath) !== '' && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropTargetDir('');
                }}
                onDragLeave={() => {
                  if (dropTargetDir === '') setDropTargetDir(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const src = e.dataTransfer.getData('text/plain') || draggingRelPath;
                  setDraggingRelPath(null);
                  setDropTargetDir(null);
                  if (src) void handleMoveEntry(src, '');
                }}
                className="px-2.5 py-1.5 rounded-[7px] text-[11.5px] text-center"
                style={{
                  border: '1.5px dashed var(--accent)',
                  background: dropTargetDir === '' ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                  color: 'var(--accent)',
                }}
              >
                {t.kbDropToRoot}
              </div>
            )}

            {loadingTree ? (
              <div className="py-8 text-center text-[12px]" style={{ color: 'var(--text-4)' }}>
                …
              </div>
            ) : treeNodes.length === 0 ? (
              <div className="py-8 px-3 text-center space-y-2.5">
                <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                  {t.kbEmptyTitle}
                </p>
                <button
                  type="button"
                  onClick={() => openNewDocPrompt('', 'blank')}
                  className="ap-btn ap-btn-primary ap-btn-sm"
                >
                  <FilePlus className="w-3.5 h-3.5" />
                  {t.kbNewDoc}
                </button>
              </div>
            ) : (
              <div className="space-y-0.5">{renderTreeNodes(treeNodes, 0)}</div>
            )}
          </div>
        </aside>
      )}

      {/* Center Document Area */}
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        {!activeDocPath ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="max-w-md w-full ap-card">
              <EmptyState
                icon={<BookOpen className="w-8 h-8" strokeWidth={1.5} />}
                title={t.kbSelectHint}
                action={
                  <div className="space-y-3">
                    <p className="text-[12px] max-w-sm mx-auto" style={{ color: 'var(--text-4)' }}>
                      {t.kbEmptyDesc}
                    </p>
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => openNewDocPrompt('', 'blank')}
                        className="ap-btn ap-btn-primary ap-btn-sm"
                      >
                        <FilePlus className="w-3.5 h-3.5" />
                        {t.kbNewDoc}
                      </button>
                      <button
                        type="button"
                        onClick={() => openNewDocPrompt('', 'daily')}
                        className="ap-btn ap-btn-sm"
                      >
                        {t.kbTplDaily}
                      </button>
                      <button
                        type="button"
                        onClick={() => openNewFolderPrompt('')}
                        className="ap-btn ap-btn-sm"
                      >
                        <FolderPlus className="w-3.5 h-3.5" />
                        {t.kbNewFolder}
                      </button>
                    </div>
                  </div>
                }
              />
            </div>
          </div>
        ) : (
          <>
            {/* Top Document Header */}
            <header
              className="px-4 py-2.5 flex items-center justify-between gap-3 shrink-0"
              style={{
                background: 'var(--bg-card)',
                borderBottom: '1px solid var(--hairline)',
              }}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <button
                  type="button"
                  title={t.kbFocusMode}
                  onClick={() => setFocusMode((v) => !v)}
                  className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center shrink-0 hover:bg-[var(--bg-subtle-hover)]"
                  style={{ color: 'var(--text-3)' }}
                >
                  {focusMode ? (
                    <PanelLeftOpen className="w-4 h-4" />
                  ) : (
                    <PanelLeftClose className="w-4 h-4" />
                  )}
                </button>

                <div className="min-w-0 flex-1">
                  {activeParentDir && (
                    <div className="text-[11px] truncate" style={{ color: 'var(--text-4)' }}>
                      {activeParentDir}
                    </div>
                  )}
                  <input
                    type="text"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={() => void commitInlineTitleRename()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                    className="w-full bg-transparent border-0 outline-none text-[15px] font-semibold truncate"
                    style={{ color: 'var(--text-1)' }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span
                  className="text-[11.5px] hidden lg:inline tabular-nums"
                  style={{ color: 'var(--text-4)' }}
                >
                  {t.kbWords(docStats.words, docStats.readMinutes)}
                </span>
                <span
                  className="text-[11px] px-2 py-0.5 rounded-full font-medium hidden md:inline-block min-w-[70px] text-center"
                  style={{
                    background:
                      saveState === 'dirty' ? 'var(--status-orange-soft)' : 'var(--bg-subtle)',
                    color: saveState === 'dirty' ? 'var(--status-orange)' : 'var(--text-3)',
                  }}
                >
                  {saveState === 'saving'
                    ? t.kbSaving
                    : saveState === 'dirty'
                      ? t.kbUnsaved
                      : t.kbSaved}
                </span>

                <SegmentedControl<DocDisplayMode>
                  value={displayMode}
                  onChange={(nextMode) => {
                    if (displayMode === 'edit' && editorControlRef.current) {
                      editorControlRef.current.flush();
                    }
                    setDisplayMode(nextMode);
                  }}
                  options={[
                    { value: 'view', label: t.kbModeView },
                    { value: 'edit', label: t.kbModeEdit },
                    { value: 'source', label: t.kbModeSource },
                    { value: 'split', label: t.kbModeSplit },
                  ]}
                />

                <button
                  type="button"
                  title={t.kbTocTitle}
                  onClick={() => setShowToc((v) => !v)}
                  className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center hover:bg-[var(--bg-subtle-hover)]"
                  style={{
                    background: showToc ? 'var(--accent-soft)' : 'transparent',
                    color: showToc ? 'var(--accent)' : 'var(--text-3)',
                  }}
                >
                  <ListTree className="w-4 h-4" />
                </button>

                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMoreMenuOpen((v) => !v);
                    }}
                    className="w-7 h-7 rounded-[7px] inline-flex items-center justify-center hover:bg-[var(--bg-subtle-hover)]"
                    style={{ color: 'var(--text-3)' }}
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>

                  {moreMenuOpen && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-8 z-30 w-44 py-1 rounded-[10px] shadow-lg"
                      style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--hairline)',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setMoreMenuOpen(false);
                          void navigator.clipboard?.writeText(content).then(() => {
                            pushToast(t.kbCopiedMd, 'ok');
                          });
                        }}
                        className="w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--bg-subtle)] flex items-center gap-2"
                      >
                        <Copy className="w-3.5 h-3.5 opacity-70" />
                        {t.kbCopyMd}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setMoreMenuOpen(false);
                          await flushSave();
                          const dest = await storageApi.exportDocFile(activeDocPath);
                          if (dest) pushToast(t.kbExportedMd(dest), 'ok');
                        }}
                        className="w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--bg-subtle)] flex items-center gap-2"
                      >
                        <Download className="w-3.5 h-3.5 opacity-70" />
                        {t.kbExportMd}
                      </button>
                      <button
                        type="button"
                        disabled={exportingPdf}
                        onClick={() => {
                          setMoreMenuOpen(false);
                          void handleExportPdf();
                        }}
                        className="w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--bg-subtle)] flex items-center gap-2 disabled:opacity-50"
                      >
                        <FileText className="w-3.5 h-3.5 opacity-70" />
                        {exportingPdf ? t.kbExportingPdf : t.kbExportPdf}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMoreMenuOpen(false);
                          void togglePinDoc(activeDocPath);
                        }}
                        className="w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--bg-subtle)] flex items-center gap-2"
                      >
                        <Star className="w-3.5 h-3.5 opacity-70" />
                        {pinnedDocs.includes(activeDocPath) ? t.kbUnpin : t.kbPin}
                      </button>
                      {isTauriRuntime() && (
                        <button
                          type="button"
                          onClick={() => {
                            setMoreMenuOpen(false);
                            void storageApi.revealDocEntry(activeDocPath);
                          }}
                          className="w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--bg-subtle)] flex items-center gap-2"
                        >
                          <FolderOpen className="w-3.5 h-3.5 opacity-70" />
                          {t.kbReveal}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </header>

            {/* External Modification Conflict Banner */}
            {externalConflict && (
              <div
                className="px-4 py-2 flex items-center justify-between gap-3 text-[12.5px] shrink-0"
                style={{
                  background: 'var(--status-orange-soft)',
                  color: 'var(--status-orange)',
                  borderBottom: '1px solid var(--hairline-soft)',
                }}
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{t.kbExternalChanged}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      const latest = await storageApi.readDocFile(activeDocPath);
                      setContent(latest.content);
                      setDiskContent(latest.content);
                      setSaveState('saved');
                      setExternalConflict(false);
                    }}
                    className="ap-btn ap-btn-sm"
                  >
                    {t.kbReloadExternal}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExternalConflict(false);
                      void flushSave(activeDocPath, content);
                    }}
                    className="ap-btn ap-btn-primary ap-btn-sm"
                  >
                    {t.kbKeepLocal}
                  </button>
                </div>
              </div>
            )}

            {/* Main Document Body + Optional TOC */}
            <div className="flex-1 min-h-0 flex overflow-hidden">
              <div
                className="flex-1 min-w-0 h-full overflow-hidden flex"
                style={{ background: 'var(--bg-card)' }}
              >
                {displayMode === 'view' && (
                  <div
                    ref={viewerScrollRef}
                    className="flex-1 min-h-0 overflow-y-auto px-8 py-6"
                  >
                    <div className="max-w-[780px] mx-auto">
                      <DocMarkdownViewer
                        markdown={content}
                        imageDataMap={imageDataMap}
                        onToggleTask={handleToggleViewerTask}
                      />
                    </div>
                  </div>
                )}

                {displayMode === 'edit' && (
                  <div className="flex-1 min-w-0 h-full">
                    <DocMarkdownEditor
                      docRelPath={activeDocPath}
                      value={content}
                      imageDataMap={imageDataMap}
                      onChange={handleContentChange}
                      onDirty={() => setSaveState('dirty')}
                      onManualSave={(latestMd) => void flushSave(activeDocPath, latestMd)}
                      onImageStored={(mdSrc, dataUrl) =>
                        setImageDataMap((prev) => ({ ...prev, [mdSrc]: dataUrl }))
                      }
                      onPastedPlainText={inspectPastedMarkdownForAssets}
                      controlRef={editorControlRef}
                    />
                  </div>
                )}

                {displayMode === 'source' && (
                  <div className="flex-1 min-w-0 h-full flex flex-col">
                    <textarea
                      value={content}
                      onChange={(e) => handleContentChange(e.target.value)}
                      onPaste={(e) => {
                        const plain = e.clipboardData?.getData('text/plain');
                        if (plain && plain.includes('](')) {
                          setTimeout(() => inspectPastedMarkdownForAssets(plain), 60);
                        }
                      }}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                          e.preventDefault();
                          void flushSave();
                        } else if (e.key === 'Tab') {
                          e.preventDefault();
                          const el = e.currentTarget;
                          const start = el.selectionStart;
                          const end = el.selectionEnd;
                          const next = `${content.slice(0, start)}  ${content.slice(end)}`;
                          handleContentChange(next);
                          requestAnimationFrame(() => {
                            el.selectionStart = el.selectionEnd = start + 2;
                          });
                        }
                      }}
                      spellCheck={false}
                      className="flex-1 w-full resize-none border-0 outline-none bg-transparent px-8 py-6 font-mono text-[13.5px] leading-relaxed"
                      style={{ color: 'var(--text-1)' }}
                    />
                  </div>
                )}

                {displayMode === 'split' && (
                  <div className="flex-1 min-w-0 h-full grid grid-cols-2 divide-x divide-[var(--hairline-soft)]">
                    <textarea
                      value={content}
                      onChange={(e) => handleContentChange(e.target.value)}
                      onPaste={(e) => {
                        const plain = e.clipboardData?.getData('text/plain');
                        if (plain && plain.includes('](')) {
                          setTimeout(() => inspectPastedMarkdownForAssets(plain), 60);
                        }
                      }}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                          e.preventDefault();
                          void flushSave();
                        } else if (e.key === 'Tab') {
                          e.preventDefault();
                          const el = e.currentTarget;
                          const start = el.selectionStart;
                          const end = el.selectionEnd;
                          const next = `${content.slice(0, start)}  ${content.slice(end)}`;
                          handleContentChange(next);
                          requestAnimationFrame(() => {
                            el.selectionStart = el.selectionEnd = start + 2;
                          });
                        }
                      }}
                      spellCheck={false}
                      className="w-full h-full resize-none border-0 outline-none bg-transparent px-6 py-5 font-mono text-[13px] leading-relaxed overflow-y-auto"
                      style={{ color: 'var(--text-1)' }}
                    />
                    <div className="h-full overflow-y-auto px-6 py-5">
                      <DocMarkdownViewer
                        markdown={deferredContent}
                        imageDataMap={imageDataMap}
                        onToggleTask={handleToggleViewerTask}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Right TOC Outline Sidebar */}
              {showToc && (
                <aside
                  className="w-[208px] shrink-0 h-full overflow-y-auto px-3 py-4"
                  style={{
                    background: 'var(--bg-canvas)',
                    borderLeft: '1px solid var(--hairline)',
                  }}
                >
                  <div
                    className="text-[11px] font-semibold uppercase tracking-wider mb-2.5"
                    style={{ color: 'var(--text-4)' }}
                  >
                    {t.kbTocTitle}
                  </div>
                  {tocItems.length === 0 ? (
                    <p className="text-[12px]" style={{ color: 'var(--text-4)' }}>
                      {t.kbTocEmpty}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {tocItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => scrollToHeading(item.id)}
                          className="w-full text-left text-[12px] py-1 rounded-[6px] hover:bg-[var(--bg-subtle)] truncate ap-ease"
                          style={{
                            paddingLeft: `${(item.level - 1) * 10 + 6}px`,
                            paddingRight: '6px',
                            color: item.level === 1 ? 'var(--text-1)' : 'var(--text-2)',
                            fontWeight: item.level === 1 ? 600 : 400,
                          }}
                        >
                          {item.text}
                        </button>
                      ))}
                    </div>
                  )}
                </aside>
              )}
            </div>
          </>
        )}
      </div>

      {/* Tree Context Menu */}
      {contextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: Math.min(contextMenu.y, window.innerHeight - 220),
            left: Math.min(contextMenu.x, window.innerWidth - 190),
            zIndex: 50,
            background: 'var(--bg-card)',
            border: '1px solid var(--hairline)',
          }}
          className="w-44 py-1 rounded-[10px] shadow-xl"
        >
          {contextMenu.entry.isDir && (
            <>
              <button
                type="button"
                onClick={() => {
                  const dir = contextMenu.entry.relPath;
                  setContextMenu(null);
                  openNewDocPrompt(dir, 'blank');
                }}
                className="w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--bg-subtle)] flex items-center gap-2"
              >
                <FilePlus className="w-3.5 h-3.5 opacity-70" />
                {t.kbNewChildDoc}
              </button>
              <button
                type="button"
                onClick={() => {
                  const dir = contextMenu.entry.relPath;
                  setContextMenu(null);
                  openNewFolderPrompt(dir);
                }}
                className="w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--bg-subtle)] flex items-center gap-2"
              >
                <FolderPlus className="w-3.5 h-3.5 opacity-70" />
                {t.kbNewChildFolder}
              </button>
              <button
                type="button"
                onClick={() => {
                  const dir = contextMenu.entry.relPath;
                  setContextMenu(null);
                  void handleImportFolder(dir);
                }}
                className="w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--bg-subtle)] flex items-center gap-2"
              >
                <Upload className="w-3.5 h-3.5 opacity-70" />
                {t.kbImportFolderHere}
              </button>
            </>
          )}
          {!contextMenu.entry.isDir && (
            <button
              type="button"
              onClick={() => {
                const p = contextMenu.entry.relPath;
                setContextMenu(null);
                void togglePinDoc(p);
              }}
              className="w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--bg-subtle)] flex items-center gap-2"
            >
              <Star className="w-3.5 h-3.5 opacity-70" />
              {pinnedDocs.includes(contextMenu.entry.relPath) ? t.kbUnpin : t.kbPin}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              const target = contextMenu.entry;
              setContextMenu(null);
              openRenamePrompt(target);
            }}
            className="w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--bg-subtle)] flex items-center gap-2"
          >
            <Pencil className="w-3.5 h-3.5 opacity-70" />
            {t.kbRename}
          </button>
          {isTauriRuntime() && (
            <button
              type="button"
              onClick={() => {
                const p = contextMenu.entry.relPath;
                setContextMenu(null);
                void storageApi.revealDocEntry(p);
              }}
              className="w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--bg-subtle)] flex items-center gap-2"
            >
              <FolderOpen className="w-3.5 h-3.5 opacity-70" />
              {t.kbReveal}
            </button>
          )}
          <div className="my-1" style={{ borderTop: '1px solid var(--hairline-soft)' }} />
          <button
            type="button"
            onClick={() => {
              const target = contextMenu.entry;
              setContextMenu(null);
              setDeleteTarget(target);
            }}
            className="w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--status-red-soft)] flex items-center gap-2"
            style={{ color: 'var(--status-red)' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t.delete}
          </button>
        </div>
      )}

      {/* Create / Rename Modal */}
      {promptModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'var(--backdrop-mask)', backdropFilter: 'blur(4px)' }}
          onClick={() => setPromptModal(null)}
        >
          <div
            className="w-full max-w-[380px] rounded-[14px] p-4 space-y-3"
            style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow-modal)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[14px] font-semibold">
              {promptModal.mode === 'new-folder'
                ? t.kbNewFolder
                : promptModal.mode === 'new-doc'
                  ? t.kbNewDoc
                  : t.kbRename}
            </div>
            {promptModal.parentDir && (
              <div className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                {promptModal.parentDir}/
              </div>
            )}
            <input
              type="text"
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submitPromptModal();
                } else if (e.key === 'Escape') {
                  setPromptModal(null);
                }
              }}
              placeholder={
                promptModal.mode === 'new-folder'
                  ? t.kbFolderNamePh
                  : promptModal.mode === 'new-doc'
                    ? t.kbDocNamePh
                    : t.kbRenamePh
              }
              autoFocus
              className="ap-input w-full py-2 px-3 text-[13.5px]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPromptModal(null)}
                className="ap-btn ap-btn-sm"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={() => void submitPromptModal()}
                className="ap-btn ap-btn-primary ap-btn-sm"
              >
                <Check className="w-3.5 h-3.5" />
                {t.confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* External Local Asset Notice Modal */}
      {assetNotice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'var(--backdrop-mask)', backdropFilter: 'blur(4px)' }}
          onClick={() => setAssetNotice(null)}
        >
          <div
            className="w-full max-w-[460px] rounded-[14px] p-5 space-y-3.5"
            style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow-modal)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>
              {t.kbAssetPromptTitle}
            </div>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
              {t.kbAssetPromptBody(assetNotice.assets.length)}
            </p>

            <div
              className="rounded-[9px] px-3 py-2 space-y-1 max-h-[180px] overflow-y-auto font-mono text-[11.5px] select-text"
              style={{
                background: 'var(--bg-subtle)',
                border: '1px solid var(--hairline-soft)',
                color: 'var(--text-2)',
              }}
            >
              {assetNotice.assets.map((a) => (
                <div key={a.rawPath} className="break-all">
                  {a.rawPath}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              {isTauriRuntime() && (
                <button
                  type="button"
                  onClick={() => void storageApi.openDataDir()}
                  className="ap-btn ap-btn-sm"
                >
                  {t.kbAssetOpenDir}
                </button>
              )}
              <button
                type="button"
                onClick={() => setAssetNotice(null)}
                className="ap-btn ap-btn-primary ap-btn-sm"
              >
                {t.kbAssetGotIt}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t.kbDeleteTitle}
        body={
          deleteTarget
            ? deleteTarget.isDir
              ? t.kbDeleteDirBody(deleteTarget.name, deleteChildCount)
              : t.kbDeleteFileBody(deleteTarget.name)
            : ''
        }
        confirmLabel={t.delete}
        cancelLabel={t.cancel}
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
