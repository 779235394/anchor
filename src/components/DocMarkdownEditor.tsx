import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Extension, wrappingInputRule } from '@tiptap/core';
import { AllSelection, TextSelection } from '@tiptap/pm/state';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import {
  Bold,
  Check,
  CheckSquare,
  Code,
  Code2,
  ExternalLink,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Table2,
  Trash2,
  Unlink,
} from 'lucide-react';
import { computeAttachmentRelPath } from '@/domain/docs';
import {
  looksLikeMarkdown,
  markdownToHtml,
  sanitizeHref,
  tiptapJsonToMarkdown,
} from '@/domain/markdown';
import { getDict } from '@/i18n';
import { isTauriRuntime, storageApi } from '@/services/storage';
import { useWorkbenchStore } from '@/store/workbenchStore';

export interface DocMarkdownEditorHandle {
  /** Synchronously serializes & flushes any pending debounced edit, returning the latest Markdown. */
  flush: () => string;
}

/**
 * Custom TipTap Image extension that preserves the original portable relative Markdown
 * path in `mdSrc` (`data-md-src`) while rendering the resolved Data URL in `src`.
 */
const DocImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mdSrc: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-md-src') || el.getAttribute('src'),
        renderHTML: (attrs) => (attrs.mdSrc ? { 'data-md-src': attrs.mdSrc } : {}),
      },
    };
  },
});

interface DocMarkdownEditorProps {
  docRelPath: string;
  value: string;
  imageDataMap: Record<string, string>;
  onChange: (markdown: string) => void;
  onDirty?: () => void;
  onManualSave?: (latestMarkdown: string) => void;
  onImageStored?: (mdSrc: string, dataUrl: string) => void;
  onPastedPlainText?: (plainText: string) => void;
  controlRef?: MutableRefObject<DocMarkdownEditorHandle | null>;
}

export function DocMarkdownEditor({
  docRelPath,
  value,
  imageDataMap,
  onChange,
  onDirty,
  onManualSave,
  onImageStored,
  onPastedPlainText,
  controlRef,
}: DocMarkdownEditorProps) {
  const { config, pushToast } = useWorkbenchStore();
  const t = getDict(config.lang);

  const lastEmittedRef = useRef<string>(value);
  const onChangeRef = useRef(onChange);
  const onDirtyRef = useRef(onDirty);
  const onManualSaveRef = useRef(onManualSave);
  const onImageStoredRef = useRef(onImageStored);
  const onPastedPlainTextRef = useRef(onPastedPlainText);
  const docRelPathRef = useRef(docRelPath);
  const imageDataMapRef = useRef(imageDataMap);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasScrollRef = useRef<HTMLDivElement | null>(null);
  const serializeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolbarRafRef = useRef<number | null>(null);
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);

  onChangeRef.current = onChange;
  onDirtyRef.current = onDirty;
  onManualSaveRef.current = onManualSave;
  onImageStoredRef.current = onImageStored;
  onPastedPlainTextRef.current = onPastedPlainText;
  docRelPathRef.current = docRelPath;
  imageDataMapRef.current = imageDataMap;

  const [editingLink, setEditingLink] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const [tableBarPos, setTableBarPos] = useState<{ top: number; left: number } | null>(null);
  const [virtualAllSelected, setVirtualAllSelected] = useState(false);
  const [, setToolbarTick] = useState(0);
  const virtualAllSelectedRef = useRef(false);
  const enteringVirtualAllRef = useRef(false);
  const mouseDownRef = useRef(false);
  const lastMouseUpAtRef = useRef(0);
  const lastCaretPosRef = useRef(1);

  const exitVirtualAllSelect = () => {
    if (!virtualAllSelectedRef.current) return;
    virtualAllSelectedRef.current = false;
    setVirtualAllSelected(false);
  };

  const enterVirtualAllSelect = (ed: NonNullable<ReturnType<typeof useEditor>>) => {
    const { state } = ed.view;
    if (state.doc.content.size <= 2) return;

    const container = canvasScrollRef.current;
    const prevScrollTop = container?.scrollTop ?? 0;

    enteringVirtualAllRef.current = true;
    virtualAllSelectedRef.current = true;
    setVirtualAllSelected(true);

    // Collapse native DOM selection and ProseMirror selection to a 0-char caret
    // so macOS WKWebView NSTextInputContext / IME / Writing Tools never stalls ~1.3s
    // inspecting a giant multi-block selection before delivering the next keydown.
    const domSel = window.getSelection();
    if (domSel && !domSel.isCollapsed) {
      domSel.removeAllRanges();
    }
    const maxPos = Math.max(1, state.doc.content.size - 1);
    const safePos = Math.min(Math.max(1, lastCaretPosRef.current), maxPos);
    try {
      const collapsedSel = TextSelection.near(state.doc.resolve(safePos));
      ed.view.dispatch(state.tr.setSelection(collapsedSel).setMeta('addToHistory', false));
    } catch {
      ed.view.dispatch(
        state.tr.setSelection(TextSelection.atStart(state.doc)).setMeta('addToHistory', false),
      );
    }

    if (container) {
      container.scrollTop = prevScrollTop;
      requestAnimationFrame(() => {
        if (canvasScrollRef.current && virtualAllSelectedRef.current) {
          canvasScrollRef.current.scrollTop = prevScrollTop;
        }
      });
    }

    queueMicrotask(() => {
      enteringVirtualAllRef.current = false;
    });
  };

  const copyAllToClipboard = (
    ed: NonNullable<ReturnType<typeof useEditor>>,
    showToast = true,
  ) => {
    const md = serializeNow(ed);
    const copiedMsg = getDict(useWorkbenchStore.getState().config.lang).kbCopiedMd;
    const fallbackCopy = () => {
      const ta = document.createElement('textarea');
      ta.value = md;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      ed.view.dom.focus({ preventScroll: true });
      if (showToast) pushToast(copiedMsg, 'ok');
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(md).then(
        () => {
          if (showToast) pushToast(copiedMsg, 'ok');
        },
        fallbackCopy,
      );
    } else {
      fallbackCopy();
    }
  };

  const clearDocFast = (ed: NonNullable<ReturnType<typeof useEditor>>): boolean => {
    virtualAllSelectedRef.current = false;
    setVirtualAllSelected(false);

    const domSel = window.getSelection();
    if (domSel && !domSel.isCollapsed) {
      domSel.removeAllRanges();
    }

    const { state } = ed.view;
    const emptyPara = state.schema.nodes.paragraph?.create();
    if (!emptyPara) return false;

    const tr = state.tr
      .replaceWith(0, state.doc.content.size, emptyPara)
      .setMeta('preventAutolink', true);
    tr.setSelection(TextSelection.create(tr.doc, 1));
    ed.view.dispatch(tr.scrollIntoView());
    return true;
  };

  const computeTableBarPos = (ed: ReturnType<typeof useEditor> | null) => {
    if (!ed || !ed.isActive('table') || !canvasScrollRef.current) {
      setTableBarPos(null);
      return;
    }
    try {
      const domAtPos = ed.view.domAtPos(ed.state.selection.from);
      const node = domAtPos.node as HTMLElement;
      const el = node.nodeType === 3 ? node.parentElement : node;
      const tableEl = el?.closest('table') as HTMLElement | null;
      if (!tableEl) {
        setTableBarPos(null);
        return;
      }
      const container = canvasScrollRef.current;
      const cRect = container.getBoundingClientRect();
      const tRect = tableEl.getBoundingClientRect();
      const top = Math.max(6, tRect.top - cRect.top + container.scrollTop - 36);
      const left = Math.max(12, tRect.left - cRect.left + container.scrollLeft);
      setTableBarPos({ top, left });
    } catch {
      setTableBarPos(null);
    }
  };

  const scheduleToolbarRefresh = () => {
    if (toolbarRafRef.current !== null) return;
    toolbarRafRef.current = requestAnimationFrame(() => {
      toolbarRafRef.current = null;
      computeTableBarPos(editorRef.current);
      setToolbarTick((n) => (n + 1) % 100000);
    });
  };

  const serializeNow = (ed: NonNullable<ReturnType<typeof useEditor>>): string => {
    if (serializeTimerRef.current) {
      clearTimeout(serializeTimerRef.current);
      serializeTimerRef.current = null;
    }
    const md = ed.isEmpty
      ? ''
      : tiptapJsonToMarkdown(ed.getJSON() as Parameters<typeof tiptapJsonToMarkdown>[0]);
    if (md !== lastEmittedRef.current) {
      lastEmittedRef.current = md;
      onChangeRef.current(md);
    }
    return md;
  };

  const extensions = useMemo(() => {
    const saveKeymap = Extension.create({
      name: 'anchorDocSaveKeymap',
      priority: 1000,
      addKeyboardShortcuts() {
        return {
          'Mod-s': () => {
            const ed = editorRef.current;
            const latest = ed ? serializeNow(ed) : lastEmittedRef.current;
            onManualSaveRef.current?.(latest);
            return true;
          },
        };
      },
    });

    const checklistShortcut = Extension.create({
      name: 'anchorDocChecklistShortcut',
      addInputRules() {
        const taskItemType = this.editor.schema.nodes.taskItem;
        if (!taskItemType) return [];
        return [
          wrappingInputRule({
            find: /^\s*\[\s?\]\s$/,
            type: taskItemType,
            getAttributes: () => ({ checked: false }),
          }),
          wrappingInputRule({
            find: /^\s*\[[xX]\]\s$/,
            type: taskItemType,
            getAttributes: () => ({ checked: true }),
          }),
        ];
      },
    });

    return [
      saveKeymap,
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: false,
          HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
        },
      }),
      Highlight.configure({ multicolor: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false, renderWrapper: true } }),
      DocImage.configure({ inline: false }),
      Placeholder.configure({
        placeholder: t.richInspectorPh,
      }),
      checklistShortcut,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compute initial HTML ONCE on mount (never re-parse on every React render!)
  const initialHtml = useMemo(
    () =>
      markdownToHtml(value, {
        resolveImageSrc: (src) => imageDataMap[src] || src,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const ingestImageFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.readAsDataURL(file);
    });
    if (!dataUrl) return;

    if (isTauriRuntime()) {
      try {
        const meta = await storageApi.saveAttachmentBytes(
          file.name || `image-${Date.now()}.png`,
          file.type || 'image/png',
          bytes,
        );
        const relImgPath = computeAttachmentRelPath(docRelPathRef.current, meta.relPath);
        onImageStoredRef.current?.(relImgPath, dataUrl);
        editorRef.current
          ?.chain()
          .focus()
          .insertContent({
            type: 'image',
            attrs: { src: dataUrl, mdSrc: relImgPath, alt: file.name || 'image' },
          })
          .run();
        pushToast(t.attAdded, 'ok');
      } catch (err) {
        pushToast(err instanceof Error ? err.message : String(err), 'err');
      }
      return;
    }

    editorRef.current
      ?.chain()
      .focus()
      .insertContent({
        type: 'image',
        attrs: { src: dataUrl, mdSrc: dataUrl, alt: file.name || 'image' },
      })
      .run();
  };

  const editor = useEditor({
    shouldRerenderOnTransaction: false,
    extensions,
    content: initialHtml,
    onSelectionUpdate: ({ editor: ed }) => {
      if (
        ed.state.selection.empty &&
        !enteringVirtualAllRef.current &&
        !virtualAllSelectedRef.current
      ) {
        lastCaretPosRef.current = ed.state.selection.from;
      }
      if (!enteringVirtualAllRef.current && virtualAllSelectedRef.current) {
        exitVirtualAllSelect();
      }
      scheduleToolbarRefresh();
    },
    onUpdate: ({ editor: ed }) => {
      if (!enteringVirtualAllRef.current && virtualAllSelectedRef.current) {
        exitVirtualAllSelect();
      }
      scheduleToolbarRefresh();
      onDirtyRef.current?.();
      if (serializeTimerRef.current) {
        clearTimeout(serializeTimerRef.current);
      }
      // Fast-path: clearing the whole doc (Cmd+A -> Delete) emits '' immediately with zero JSON walk
      if (ed.isEmpty) {
        serializeTimerRef.current = null;
        if (lastEmittedRef.current !== '') {
          lastEmittedRef.current = '';
          onChangeRef.current('');
        }
        return;
      }
      serializeTimerRef.current = setTimeout(() => {
        serializeTimerRef.current = null;
        const md = tiptapJsonToMarkdown(ed.getJSON() as Parameters<typeof tiptapJsonToMarkdown>[0]);
        if (md !== lastEmittedRef.current) {
          lastEmittedRef.current = md;
          onChangeRef.current(md);
        }
      }, 180);
    },
    onBlur: ({ editor: ed }) => {
      exitVirtualAllSelect();
      if (serializeTimerRef.current) {
        serializeNow(ed);
      }
    },
    editorProps: {
      attributes: {
        spellcheck: 'false',
        autocorrect: 'off',
        autocapitalize: 'off',
        autocomplete: 'off',
        writingsuggestions: 'false',
      },
      handleKeyDown: (view, event) => {
        // 1. Intercept Cmd/Ctrl+A -> Virtual AllSelection (fallback if capture phase didn't run)
        if (
          (event.metaKey || event.ctrlKey) &&
          !event.shiftKey &&
          !event.altKey &&
          event.key.toLowerCase() === 'a'
        ) {
          if (editorRef.current && view.state.doc.content.size > 2) {
            event.preventDefault();
            enterVirtualAllSelect(editorRef.current);
            return true;
          }
        }

        // 2. Intercept Backspace / Delete on full-document or large selections BEFORE
        // prosemirror-tables, ListKeymap, and macOS WKWebView native contenteditable teardown.
        if (event.key === 'Backspace' || event.key === 'Delete') {
          if (virtualAllSelectedRef.current && editorRef.current) {
            event.preventDefault();
            return clearDocFast(editorRef.current);
          }

          const { state } = view;
          const { selection, doc } = state;
          const domSel = window.getSelection();
          const hasDomSelection = !!domSel && !domSel.isCollapsed;
          if (selection.empty && !hasDomSelection) return false;

          const startPos = TextSelection.atStart(doc).from;
          const endPos = TextSelection.atEnd(doc).to;
          const domCoversAll =
            hasDomSelection &&
            !!view.dom.firstChild &&
            !!view.dom.lastChild &&
            domSel.containsNode(view.dom.firstChild, true) &&
            domSel.containsNode(view.dom.lastChild, true);
          const isAllSelected =
            selection instanceof AllSelection ||
            (!selection.empty && selection.from <= startPos && selection.to >= endPos) ||
            domCoversAll;

          if (isAllSelected && doc.content.size > 2 && editorRef.current) {
            event.preventDefault();
            return clearDocFast(editorRef.current);
          }

          if (!selection.empty && selection.to - selection.from > 60) {
            event.preventDefault();
            if (hasDomSelection) {
              domSel.removeAllRanges();
            }
            const tr = state.tr.deleteSelection().setMeta('preventAutolink', true);
            view.dispatch(tr.scrollIntoView());
            return true;
          }
        }
        return false;
      },
      handleDOMEvents: {
        compositionstart: () => {
          if (virtualAllSelectedRef.current && editorRef.current) {
            clearDocFast(editorRef.current);
          }
          return false;
        },
        paste: (_view, event) => {
          const dt = (event as ClipboardEvent).clipboardData;
          if (!dt) return false;
          const ed = editorRef.current;
          const replacingAll = virtualAllSelectedRef.current;
          const imgItem = Array.from(dt.items || []).find((it) => it.type.startsWith('image/'));
          if (imgItem) {
            const file = imgItem.getAsFile();
            if (file) {
              event.preventDefault();
              if (replacingAll && ed) {
                clearDocFast(ed);
              }
              void ingestImageFile(file);
              return true;
            }
          }
          const plain = dt.getData('text/plain');
          if (plain) {
            if (plain.includes('](')) {
              setTimeout(() => onPastedPlainTextRef.current?.(plain), 60);
            }
            // Convert pasted Markdown (tables, headings, lists, code blocks, emphasis) cleanly into TipTap nodes
            if (looksLikeMarkdown(plain) && ed) {
              event.preventDefault();
              const html = markdownToHtml(plain, {
                resolveImageSrc: (src) => imageDataMapRef.current[src] || src,
              });
              if (replacingAll) {
                exitVirtualAllSelect();
                ed.chain()
                  .focus()
                  .insertContentAt({ from: 0, to: ed.state.doc.content.size }, html)
                  .run();
              } else {
                ed.chain().focus().insertContent(html).run();
              }
              return true;
            }
            if (replacingAll && ed) {
              event.preventDefault();
              exitVirtualAllSelect();
              const htmlClipboard = dt.getData('text/html');
              if (htmlClipboard && htmlClipboard.trim()) {
                ed.chain()
                  .focus()
                  .insertContentAt({ from: 0, to: ed.state.doc.content.size }, htmlClipboard)
                  .run();
              } else {
                const paras = plain
                  .replace(/\r\n?/g, '\n')
                  .split('\n')
                  .map((line) => ({
                    type: 'paragraph',
                    ...(line ? { content: [{ type: 'text', text: line }] } : {}),
                  }));
                ed.chain()
                  .focus()
                  .insertContentAt({ from: 0, to: ed.state.doc.content.size }, paras)
                  .run();
              }
              return true;
            }
          }
          return false;
        },
        click: (_view, event) => {
          const target = event.target as HTMLElement | null;
          const anchor = target?.closest('a') as HTMLAnchorElement | null;
          if (anchor && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            const href = sanitizeHref(anchor.getAttribute('href') || '');
            if (href) void storageApi.openExternalUrl(href);
            return true;
          }
          return false;
        },
      },
    },
  });

  editorRef.current = editor;

  // Wrap ProseMirror's dispatchTransaction to clear WebKit's DOM selection right before
  // any large-range doc mutation (covers Cmd+X Cut, Paste-over-All, and typing-over-All).
  useEffect(() => {
    if (!editor) return;
    const origDispatch = editor.view.props.dispatchTransaction;
    if (!origDispatch) return;
    editor.view.setProps({
      dispatchTransaction(tr) {
        const prevSel = editor.view.state.selection;
        if (tr.docChanged && !prevSel.empty && prevSel.to - prevSel.from > 60) {
          const domSel = window.getSelection();
          if (domSel && !domSel.isCollapsed) {
            domSel.removeAllRanges();
          }
        }
        origDispatch.call(this, tr);
      },
    });
    return () => {
      if (!editor.isDestroyed) {
        editor.view.setProps({ dispatchTransaction: origDispatch });
      }
    };
  }, [editor]);

  // Detect macOS native Edit -> Select All (selectAll:) via selectionchange so WKWebView
  // immediately collapses its native multi-block DOM selection into Virtual AllSelection,
  // and handle native Edit -> Copy / Cut while Virtual AllSelection is active.
  useEffect(() => {
    if (!editor) return;

    const handleSelectionChange = () => {
      if (enteringVirtualAllRef.current) return;
      if (mouseDownRef.current || performance.now() - lastMouseUpAtRef.current < 150) return;
      const ed = editorRef.current;
      if (!ed || ed.isDestroyed || !ed.view) return;
      const dom = ed.view.dom;
      if (document.activeElement !== dom && !dom.contains(document.activeElement)) return;
      const domSel = window.getSelection();
      if (!domSel || domSel.isCollapsed || domSel.rangeCount === 0) return;
      if (ed.state.doc.content.size <= 2) return;

      const first = dom.firstChild;
      const last = dom.lastChild;
      const startPos = TextSelection.atStart(ed.state.doc).from;
      const endPos = TextSelection.atEnd(ed.state.doc).to;
      const pmCoversAll =
        ed.state.doc.content.size > 40 &&
        (ed.state.selection instanceof AllSelection ||
          (!ed.state.selection.empty &&
            ed.state.selection.from <= startPos &&
            ed.state.selection.to >= endPos));
      const coversMultiBlockAll =
        !!first &&
        !!last &&
        first !== last &&
        domSel.containsNode(first, true) &&
        domSel.containsNode(last, true);
      const coversSingleBlockAll =
        !!first &&
        first === last &&
        ed.state.doc.textContent.length >= 120 &&
        domSel.toString().length >= ed.state.doc.textContent.length - 2;

      if (pmCoversAll || coversMultiBlockAll || coversSingleBlockAll) {
        enterVirtualAllSelect(ed);
      }
    };

    const handleCopy = (e: ClipboardEvent) => {
      if (!virtualAllSelectedRef.current) return;
      const ed = editorRef.current;
      if (!ed || ed.isDestroyed || !ed.view) return;
      const dom = ed.view.dom;
      if (document.activeElement !== dom && !dom.contains(document.activeElement)) return;
      e.preventDefault();
      const md = serializeNow(ed);
      e.clipboardData?.setData('text/plain', md);
      e.clipboardData?.setData('text/html', ed.getHTML());
      pushToast(getDict(useWorkbenchStore.getState().config.lang).kbCopiedMd, 'ok');
    };

    const handleCut = (e: ClipboardEvent) => {
      if (!virtualAllSelectedRef.current) return;
      const ed = editorRef.current;
      if (!ed || ed.isDestroyed || !ed.view) return;
      const dom = ed.view.dom;
      if (document.activeElement !== dom && !dom.contains(document.activeElement)) return;
      e.preventDefault();
      const md = serializeNow(ed);
      e.clipboardData?.setData('text/plain', md);
      e.clipboardData?.setData('text/html', ed.getHTML());
      clearDocFast(ed);
    };

    const handleMouseUp = () => {
      if (mouseDownRef.current) {
        const sel = window.getSelection();
        const hadDragSel = !!sel && !sel.isCollapsed;
        mouseDownRef.current = false;
        if (hadDragSel) {
          lastMouseUpAtRef.current = performance.now();
        }
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('copy', handleCopy);
    document.addEventListener('cut', handleCut);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('cut', handleCut);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Expose synchronous flush handle and clean up timers on unmount
  useEffect(() => {
    if (controlRef) {
      controlRef.current = {
        flush: () => (editorRef.current ? serializeNow(editorRef.current) : lastEmittedRef.current),
      };
    }
    return () => {
      if (serializeTimerRef.current && editorRef.current) {
        serializeNow(editorRef.current);
      }
      if (toolbarRafRef.current !== null) {
        cancelAnimationFrame(toolbarRafRef.current);
        toolbarRafRef.current = null;
      }
      if (controlRef) {
        controlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlRef]);

  // Sync external document switch or external reload
  useEffect(() => {
    exitVirtualAllSelect();
    if (!editor) return;
    if (value !== lastEmittedRef.current) {
      if (serializeTimerRef.current) {
        clearTimeout(serializeTimerRef.current);
        serializeTimerRef.current = null;
      }
      lastEmittedRef.current = value;
      editor.commands.setContent(
        markdownToHtml(value, { resolveImageSrc: (src) => imageDataMapRef.current[src] || src }),
        { emitUpdate: false },
      );
      scheduleToolbarRefresh();
    }
  }, [editor, value, docRelPath]);

  // Refresh image srcs when async attachment dataUrls finish loading
  useEffect(() => {
    if (!editor || Object.keys(imageDataMap).length === 0) return;
    const { state } = editor;
    let tr = state.tr;
    let changed = false;
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') {
        const mdSrc = typeof node.attrs.mdSrc === 'string' ? node.attrs.mdSrc : '';
        const resolved = mdSrc ? imageDataMap[mdSrc] : '';
        if (resolved && node.attrs.src !== resolved) {
          tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: resolved });
          changed = true;
        }
      }
    });
    if (changed) {
      tr.setMeta('addToHistory', false);
      editor.view.dispatch(tr);
    }
  }, [editor, imageDataMap]);

  const applyLink = () => {
    if (!editor) return;
    const trimmed = linkDraft.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      setEditingLink(false);
      return;
    }
    const candidate = /^https?:\/\/|^mailto:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const safe = sanitizeHref(candidate);
    if (!safe) {
      pushToast(t.attBadUrl, 'err');
      return;
    }
    if (editor.state.selection.empty) {
      editor
        .chain()
        .focus()
        .insertContent(`<a href="${safe}">${safe}</a> `)
        .run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: safe }).run();
    }
    setEditingLink(false);
  };

  const handlePickImage = async () => {
    if (isTauriRuntime()) {
      const paths = await storageApi.pickAttachmentFiles(true);
      for (const p of paths) {
        try {
          const meta = await storageApi.importAttachmentFile(p);
          const dataUrl = await storageApi.readAttachmentDataUrl(meta.relPath);
          const relImgPath = computeAttachmentRelPath(docRelPath, meta.relPath);
          onImageStored?.(relImgPath, dataUrl);
          editor
            ?.chain()
            .focus()
            .insertContent({
              type: 'image',
              attrs: { src: dataUrl, mdSrc: relImgPath, alt: meta.name },
            })
            .run();
        } catch (err) {
          pushToast(err instanceof Error ? err.message : String(err), 'err');
        }
      }
      return;
    }
    fileInputRef.current?.click();
  };

  const btnCls = (active: boolean) =>
    `h-6 min-w-6 px-1.5 rounded-[5px] inline-flex items-center justify-center ap-ease ${
      active
        ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
        : 'text-[var(--text-3)] hover:bg-[var(--bg-subtle-hover)] hover:text-[var(--text-1)]'
    }`;

  const inTable = !!editor?.isActive('table');

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Permanent Format Toolbar */}
      {editor && (
        <div
          className="px-4 py-1.5 flex items-center gap-0.5 flex-wrap shrink-0 select-none"
          style={{
            background: 'color-mix(in srgb, var(--bg-subtle) 65%, var(--bg-card))',
            borderBottom: '1px solid var(--hairline-soft)',
          }}
        >
          <button
            type="button"
            title="H1"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={btnCls(editor.isActive('heading', { level: 1 }))}
          >
            <Heading1 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t.richHeading2}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={btnCls(editor.isActive('heading', { level: 2 }))}
          >
            <Heading2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t.richHeading3}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={btnCls(editor.isActive('heading', { level: 3 }))}
          >
            <Heading3 className="w-3.5 h-3.5" />
          </button>

          <span className="w-px h-3.5 mx-1" style={{ background: 'var(--hairline)' }} />

          <button
            type="button"
            title={t.richBold}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={btnCls(editor.isActive('bold'))}
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t.richItalic}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={btnCls(editor.isActive('italic'))}
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t.richStrike}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={btnCls(editor.isActive('strike'))}
          >
            <Strikethrough className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t.richHighlight}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleHighlight().run()}
            className={btnCls(editor.isActive('highlight'))}
          >
            <Highlighter className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t.richCode}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={btnCls(editor.isActive('code'))}
          >
            <Code className="w-3.5 h-3.5" />
          </button>

          <span className="w-px h-3.5 mx-1" style={{ background: 'var(--hairline)' }} />

          <button
            type="button"
            title={t.richChecklist}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            className={btnCls(editor.isActive('taskList'))}
          >
            <CheckSquare className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t.richBullet}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={btnCls(editor.isActive('bulletList'))}
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t.richOrdered}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={btnCls(editor.isActive('orderedList'))}
          >
            <ListOrdered className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t.richQuote}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={btnCls(editor.isActive('blockquote'))}
          >
            <Quote className="w-3.5 h-3.5" />
          </button>

          <span className="w-px h-3.5 mx-1" style={{ background: 'var(--hairline)' }} />

          <button
            type="button"
            title={t.kbInsertCodeBlock}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={btnCls(editor.isActive('codeBlock'))}
          >
            <Code2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t.kbInsertTable}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            }
            className={btnCls(inTable)}
          >
            <Table2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t.kbInsertHr}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            className={btnCls(false)}
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t.richLink}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const cur = (editor.getAttributes('link').href as string | undefined) || '';
              setLinkDraft(cur);
              setEditingLink((v) => !v);
            }}
            className={btnCls(editor.isActive('link') || editingLink)}
          >
            <Link2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t.kbInsertImage}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void handlePickImage()}
            className={btnCls(false)}
          >
            <ImagePlus className="w-3.5 h-3.5" />
          </button>

          {inTable && (
            <>
              <span className="w-px h-3.5 mx-1" style={{ background: 'var(--hairline)' }} />
              <button
                type="button"
                title={t.kbAddRowBefore}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().addRowBefore().run()}
                className="px-1.5 h-6 rounded-[5px] text-[11px] font-medium hover:bg-[var(--bg-subtle-hover)]"
                style={{ color: 'var(--text-2)' }}
              >
                {t.kbAddRowBefore}
              </button>
              <button
                type="button"
                title={t.kbAddRow}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().addRowAfter().run()}
                className="px-1.5 h-6 rounded-[5px] text-[11px] font-medium hover:bg-[var(--bg-subtle-hover)]"
                style={{ color: 'var(--text-2)' }}
              >
                {t.kbAddRow}
              </button>
              <button
                type="button"
                title={t.kbDelRow}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().deleteRow().run()}
                className="px-1.5 h-6 rounded-[5px] text-[11px] font-medium hover:bg-[var(--status-red-soft)]"
                style={{ color: 'var(--status-red)' }}
              >
                {t.kbDelRow}
              </button>
              <span className="w-px h-3.5 mx-0.5" style={{ background: 'var(--hairline)' }} />
              <button
                type="button"
                title={t.kbAddColBefore}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().addColumnBefore().run()}
                className="px-1.5 h-6 rounded-[5px] text-[11px] font-medium hover:bg-[var(--bg-subtle-hover)]"
                style={{ color: 'var(--text-2)' }}
              >
                {t.kbAddColBefore}
              </button>
              <button
                type="button"
                title={t.kbAddCol}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().addColumnAfter().run()}
                className="px-1.5 h-6 rounded-[5px] text-[11px] font-medium hover:bg-[var(--bg-subtle-hover)]"
                style={{ color: 'var(--text-2)' }}
              >
                {t.kbAddCol}
              </button>
              <button
                type="button"
                title={t.kbDelCol}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().deleteColumn().run()}
                className="px-1.5 h-6 rounded-[5px] text-[11px] font-medium hover:bg-[var(--status-red-soft)]"
                style={{ color: 'var(--status-red)' }}
              >
                {t.kbDelCol}
              </button>
              <button
                type="button"
                title={t.kbDelTable}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().deleteTable().run()}
                className="h-6 px-1.5 rounded-[5px] inline-flex items-center hover:bg-[var(--status-red-soft)]"
                style={{ color: 'var(--status-red)' }}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          )}

          {editingLink && (
            <div
              className="w-full mt-1.5 pt-1.5 flex items-center gap-1.5"
              style={{ borderTop: '1px solid var(--hairline-soft)' }}
            >
              <input
                type="text"
                value={linkDraft}
                onChange={(e) => setLinkDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyLink();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditingLink(false);
                  }
                }}
                placeholder={t.richLinkPh}
                autoFocus
                className="ap-input flex-1 py-1 px-2 text-[12px]"
              />
              <button
                type="button"
                onClick={applyLink}
                className="ap-btn ap-btn-primary ap-btn-sm py-1 px-2"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              {editor.isActive('link') && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const href = sanitizeHref(
                        (editor.getAttributes('link').href as string | undefined) || '',
                      );
                      if (href) void storageApi.openExternalUrl(href);
                    }}
                    className="ap-btn ap-btn-sm py-1 px-2"
                    title={t.attOpen}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().extendMarkRange('link').unsetLink().run();
                      setEditingLink(false);
                    }}
                    className="ap-btn ap-btn-sm py-1 px-2"
                    title={t.delete}
                  >
                    <Unlink className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Hidden browser image picker fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void ingestImageFile(f);
          e.target.value = '';
        }}
      />

      {/* Main Editable Canvas */}
      <div
        ref={canvasScrollRef}
        onMouseDownCapture={() => {
          mouseDownRef.current = true;
          if (virtualAllSelectedRef.current) {
            exitVirtualAllSelect();
          }
        }}
        onKeyDownCapture={(e) => {
          const target = e.target as HTMLElement | null;
          if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
          const ed = editorRef.current;
          if (!ed || ed.isDestroyed || !ed.view) return;
          const mod = e.metaKey || e.ctrlKey;
          const lower = e.key.toLowerCase();

          // 1. Intercept Cmd/Ctrl + A before WebKit/ProseMirror builds a giant native DOM selection
          if (mod && !e.shiftKey && !e.altKey && lower === 'a') {
            if (ed.state.doc.content.size > 2) {
              e.preventDefault();
              e.stopPropagation();
              enterVirtualAllSelect(ed);
              return;
            }
          }

          // 2. Handle all interactions while Virtual AllSelection is active
          if (virtualAllSelectedRef.current) {
            if (e.key === 'Backspace' || e.key === 'Delete') {
              e.preventDefault();
              e.stopPropagation();
              clearDocFast(ed);
              return;
            }
            if (mod && !e.shiftKey && !e.altKey && lower === 'c') {
              e.preventDefault();
              e.stopPropagation();
              copyAllToClipboard(ed, true);
              return;
            }
            if (mod && !e.shiftKey && !e.altKey && lower === 'x') {
              e.preventDefault();
              e.stopPropagation();
              copyAllToClipboard(ed, false);
              clearDocFast(ed);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              exitVirtualAllSelect();
              return;
            }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'Home') {
              e.preventDefault();
              e.stopPropagation();
              exitVirtualAllSelect();
              ed.view.dispatch(
                ed.state.tr
                  .setSelection(TextSelection.atStart(ed.state.doc))
                  .setMeta('addToHistory', false)
                  .scrollIntoView(),
              );
              return;
            }
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'End') {
              e.preventDefault();
              e.stopPropagation();
              exitVirtualAllSelect();
              ed.view.dispatch(
                ed.state.tr
                  .setSelection(TextSelection.atEnd(ed.state.doc))
                  .setMeta('addToHistory', false)
                  .scrollIntoView(),
              );
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              clearDocFast(ed);
              return;
            }
            // Keep virtual-all active for modifier-only keys & Cmd+V/S (paste will replace all)
            if (
              e.key === 'Meta' ||
              e.key === 'Control' ||
              e.key === 'Shift' ||
              e.key === 'Alt' ||
              e.key === 'CapsLock' ||
              (mod && (lower === 'v' || lower === 's'))
            ) {
              return;
            }
            // Cmd+Z or other shortcuts: exit virtual-all and let default execute
            if (mod || e.altKey) {
              exitVirtualAllSelect();
              return;
            }
            // Printable character or IME input start: clear doc first, let character/IME insert
            if (e.key.length === 1 || e.key === 'Process' || e.keyCode === 229) {
              clearDocFast(ed);
              return;
            }
          }
        }}
        className="relative flex-1 min-h-0 overflow-y-auto px-8 py-6"
      >
        {/* Floating Inline Table Quick Controls */}
        {editor && inTable && !virtualAllSelected && tableBarPos && (
          <div
            style={{
              position: 'absolute',
              top: tableBarPos.top,
              left: tableBarPos.left,
              zIndex: 20,
              background: 'var(--bg-card)',
              border: '1px solid var(--hairline)',
              boxShadow: 'var(--shadow-md, 0 4px 14px rgba(0,0,0,0.08))',
            }}
            className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded-[8px] select-none"
          >
            <button
              type="button"
              title={t.kbAddRowBefore}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().addRowBefore().run()}
              className="px-1.5 h-6 rounded-[5px] text-[11px] font-medium hover:bg-[var(--bg-subtle)]"
              style={{ color: 'var(--text-2)' }}
            >
              ↑ {t.kbAddRowBefore}
            </button>
            <button
              type="button"
              title={t.kbAddRow}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().addRowAfter().run()}
              className="px-1.5 h-6 rounded-[5px] text-[11px] font-medium hover:bg-[var(--bg-subtle)]"
              style={{ color: 'var(--text-2)' }}
            >
              ↓ {t.kbAddRow}
            </button>
            <button
              type="button"
              title={t.kbDelRow}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().deleteRow().run()}
              className="px-1.5 h-6 rounded-[5px] text-[11px] font-medium hover:bg-[var(--status-red-soft)]"
              style={{ color: 'var(--status-red)' }}
            >
              {t.kbDelRow}
            </button>
            <span className="w-px h-3.5 mx-0.5" style={{ background: 'var(--hairline)' }} />
            <button
              type="button"
              title={t.kbAddColBefore}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().addColumnBefore().run()}
              className="px-1.5 h-6 rounded-[5px] text-[11px] font-medium hover:bg-[var(--bg-subtle)]"
              style={{ color: 'var(--text-2)' }}
            >
              ← {t.kbAddColBefore}
            </button>
            <button
              type="button"
              title={t.kbAddCol}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().addColumnAfter().run()}
              className="px-1.5 h-6 rounded-[5px] text-[11px] font-medium hover:bg-[var(--bg-subtle)]"
              style={{ color: 'var(--text-2)' }}
            >
              → {t.kbAddCol}
            </button>
            <button
              type="button"
              title={t.kbDelCol}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().deleteColumn().run()}
              className="px-1.5 h-6 rounded-[5px] text-[11px] font-medium hover:bg-[var(--status-red-soft)]"
              style={{ color: 'var(--status-red)' }}
            >
              {t.kbDelCol}
            </button>
            <span className="w-px h-3.5 mx-0.5" style={{ background: 'var(--hairline)' }} />
            <button
              type="button"
              title={t.kbDelTable}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().deleteTable().run()}
              className="h-6 px-1.5 rounded-[5px] inline-flex items-center hover:bg-[var(--status-red-soft)]"
              style={{ color: 'var(--status-red)' }}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="max-w-[780px] mx-auto">
          <EditorContent
            editor={editor}
            className={`ap-prose ap-prose-doc min-h-[420px]${virtualAllSelected ? ' ap-doc-all-selected' : ''}`}
          />
        </div>
      </div>
    </div>
  );
}
