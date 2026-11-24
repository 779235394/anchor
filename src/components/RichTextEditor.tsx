import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { Extension, wrappingInputRule } from '@tiptap/core';
import {
  chainCommands,
  createParagraphNear,
  liftEmptyBlock,
  newlineInCode,
  splitBlock as pmSplitBlock,
} from '@tiptap/pm/commands';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold,
  Check,
  CheckSquare,
  Code,
  ExternalLink,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Paperclip,
  Quote,
  Strikethrough,
  Unlink,
} from 'lucide-react';
import type { Attachment } from '@/domain/types';
import { markdownToHtml, sanitizeHref, tiptapJsonToMarkdown } from '@/domain/markdown';
import { getDict } from '@/i18n';
import { registerNativeDropZone, storageApi } from '@/services/storage';
import { useWorkbenchStore } from '@/store/workbenchStore';
import {
  ingestBrowserFilesToAttachments,
  ingestLocalPathsToAttachments,
  interceptSmartPaste,
} from './AttachmentPanel';

export interface RichTextEditorHandle {
  focus: () => void;
}

interface RichTextEditorProps {
  id?: string;
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  minHeight?: number;
  maxHeight?: number;
  submitOnEnter?: boolean;
  onSubmit?: () => void;
  onAddAttachment?: (att: Attachment) => void;
  dropPriority?: number;
  autoFocus?: boolean;
  variant?: 'plain' | 'input';
  showToolbar?: boolean;
  className?: string;
  editorRef?: MutableRefObject<RichTextEditorHandle | null>;
}

interface BubblePos {
  top: number;
  left: number;
}

export function RichTextEditor({
  id,
  value,
  onChange,
  placeholder = '',
  minHeight = 68,
  maxHeight = 260,
  submitOnEnter = false,
  onSubmit,
  onAddAttachment,
  dropPriority = 1,
  autoFocus = false,
  variant = 'plain',
  showToolbar = false,
  className = '',
  editorRef,
}: RichTextEditorProps) {
  const { config, pushToast } = useWorkbenchStore();
  const t = getDict(config.lang);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorInstanceRef = useRef<ReturnType<typeof useEditor>>(null);
  const lastEmittedRef = useRef<string>(value);
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const onAddAttRef = useRef(onAddAttachment);
  const submitOnEnterRef = useRef(submitOnEnter);
  const dictRef = useRef(t);

  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;
  onAddAttRef.current = onAddAttachment;
  submitOnEnterRef.current = submitOnEnter;
  dictRef.current = t;

  const [dragOver, setDragOver] = useState(false);
  const [bubblePos, setBubblePos] = useState<BubblePos | null>(null);
  const [editingLink, setEditingLink] = useState(false);
  const [toolbarEditingLink, setToolbarEditingLink] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');

  const composerKeymap = useMemo(
    () =>
      Extension.create({
        name: 'anchorComposerKeymap',
        priority: 1000,
        addKeyboardShortcuts() {
          return {
            'Mod-Enter': () => {
              if (onSubmitRef.current) {
                onSubmitRef.current();
                return true;
              }
              return false;
            },
            'Shift-Enter': ({ editor: ed }) => {
              if (!submitOnEnterRef.current) return false;
              if (ed.isActive('taskItem')) {
                return ed.commands.splitListItem('taskItem') || ed.commands.liftListItem('taskItem');
              }
              if (ed.isActive('listItem')) {
                return ed.commands.splitListItem('listItem') || ed.commands.liftListItem('listItem');
              }
              return ed.commands.command(({ state, dispatch }) =>
                chainCommands(newlineInCode, createParagraphNear, liftEmptyBlock, pmSplitBlock)(
                  state,
                  dispatch,
                ),
              );
            },
            Enter: ({ editor: ed }) => {
              if (!submitOnEnterRef.current || !onSubmitRef.current) return false;
              if (ed.view.composing) return false;
              onSubmitRef.current();
              return true;
            },
          };
        },
      }),
    [],
  );

  const editor = useEditor({
    extensions: [
      composerKeymap,
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        hardBreak: submitOnEnter ? false : {},
        trailingNode: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: {
            rel: 'noopener noreferrer',
            target: '_blank',
          },
        },
      }),
      Highlight,
      TaskList,
      TaskItem.extend({
        addInputRules() {
          return [
            wrappingInputRule({
              find: /^\s*(?:[-*]\s+)?\[([ xX]?)\]\s$/,
              type: this.type,
              getAttributes: (match) => ({
                checked: (match[1] || '').toLowerCase() === 'x',
              }),
            }),
          ];
        },
      }).configure({ nested: true }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: markdownToHtml(value),
    editorProps: {
      attributes: {
        ...(id ? { id } : {}),
        class: 'outline-none',
        spellcheck: 'false',
      },
      handlePaste: (_view, event) => {
        const addAtt = onAddAttRef.current;
        if (!addAtt) return false;
        return interceptSmartPaste(
          event,
          addAtt,
          pushToast,
          dictRef.current.attAdded,
          dictRef.current.attLargeWarn,
          (fallbackText) => {
            editorInstanceRef.current?.chain().focus().insertContent(fallbackText).run();
          },
        );
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement | null;
        const anchor = target?.closest('a') as HTMLAnchorElement | null;
        if (anchor && (event.metaKey || event.ctrlKey)) {
          const safe = sanitizeHref(anchor.getAttribute('href') || '');
          if (safe) {
            event.preventDefault();
            void storageApi.openExternalUrl(safe);
            return true;
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const md = tiptapJsonToMarkdown(ed.getJSON());
      lastEmittedRef.current = md;
      onChangeRef.current(md);
    },
  });

  editorInstanceRef.current = editor;

  // Expose focus handle to parent (e.g. Shift+Enter from task title bar)
  useEffect(() => {
    if (!editorRef) return;
    editorRef.current = {
      focus: () => {
        editor?.commands.focus('end');
      },
    };
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

  useEffect(() => {
    if (autoFocus && editor) {
      setTimeout(() => editor.commands.focus('end'), 15);
    }
  }, [autoFocus, editor]);

  // Keep controlled Markdown value synced when switched/cleared externally
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    editor.commands.setContent(markdownToHtml(value), { emitUpdate: false });
  }, [editor, value]);

  // Register Tauri native OS file drag-drop target
  useEffect(() => {
    if (!onAddAttachment) return;
    return registerNativeDropZone({
      getElement: () => containerRef.current,
      priority: dropPriority,
      onHoverChange: (hover) => setDragOver(hover),
      onDropPaths: (paths) => {
        const addAtt = onAddAttRef.current;
        if (!addAtt) return;
        void ingestLocalPathsToAttachments(
          paths,
          addAtt,
          pushToast,
          dictRef.current.attAdded,
          dictRef.current.attLargeWarn,
        );
      },
    });
  }, [onAddAttachment, dropPriority, pushToast]);

  // Track text selection to position the Apple floating Bubble Toolbar
  useEffect(() => {
    if (!editor) return;

    const updateBubble = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || from === to || !editor.isFocused) {
        if (!editingLink) setBubblePos(null);
        return;
      }
      try {
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        const centerX = (start.left + end.right) / 2;
        const clampedX = Math.max(150, Math.min(window.innerWidth - 150, centerX));
        const top = Math.max(12, Math.min(start.top, end.top) - 46);
        setBubblePos({ top, left: clampedX });
      } catch {
        setBubblePos(null);
      }
    };

    const handleBlur = () => {
      // Allow clicking link editor inside the portal without hiding immediately
      setTimeout(() => {
        if (!editor.isFocused && !editingLink) {
          setBubblePos(null);
        }
      }, 120);
    };

    editor.on('selectionUpdate', updateBubble);
    editor.on('focus', updateBubble);
    editor.on('blur', handleBlur);
    return () => {
      editor.off('selectionUpdate', updateBubble);
      editor.off('focus', updateBubble);
      editor.off('blur', handleBlur);
    };
  }, [editor, editingLink]);

  const applyLink = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!editor) return;
    const raw = linkDraft.trim();
    if (!raw) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      setEditingLink(false);
      setBubblePos(null);
      return;
    }
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const safe = sanitizeHref(candidate);
    if (!safe) {
      pushToast(t.attBadUrl, 'err');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: safe }).run();
    setEditingLink(false);
    setLinkDraft('');
  };

  const openLinkPrompt = () => {
    if (!editor) return;
    const existing = (editor.getAttributes('link').href as string | undefined) || '';
    setLinkDraft(existing);
    setEditingLink(true);
  };

  const activeLinkHref = editor?.getAttributes('link').href as string | undefined;

  return (
    <div
      ref={containerRef}
      onDragOver={(e) => {
        if (!onAddAttachment) return;
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!onAddAttachment) return;
        const files = e.dataTransfer?.files;
        setDragOver(false);
        if (files && files.length > 0) {
          e.preventDefault();
          void ingestBrowserFilesToAttachments(
            files,
            onAddAttachment,
            pushToast,
            t.attAdded,
            t.attLargeWarn,
          );
        }
      }}
      className={`relative ${
        variant === 'input'
          ? showToolbar
            ? 'rounded-[9px] border overflow-hidden ap-ease'
            : 'ap-input w-full cursor-text ap-prose'
          : showToolbar
            ? 'w-full'
            : 'w-full cursor-text ap-prose'
      } ${className}`}
      style={
        showToolbar
          ? variant === 'input'
            ? {
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--hairline-soft)',
              }
            : undefined
          : {
              minHeight,
              maxHeight,
              overflowY: 'auto',
            }
      }
      onClick={() => {
        if (!showToolbar && editor && !editor.isFocused) {
          editor.commands.focus();
        }
      }}
    >
      {/* Permanent Compact Rich-Text Formatting Toolbar */}
      {showToolbar && editor && (
        <div
          className={`flex flex-wrap items-center gap-0.5 ${
            variant === 'input' ? 'px-2 py-1.5' : 'pb-1.5 mb-1.5'
          }`}
          style={{
            background: variant === 'input' ? 'var(--bg-card)' : 'transparent',
            borderBottom: '1px solid var(--hairline-soft)',
          }}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).tagName !== 'INPUT') {
              e.preventDefault();
            }
          }}
        >
          <ToolbarBtn
            compact
            active={editor.isActive('bold')}
            title={`${t.richBold} (⌘B)`}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="w-3.5 h-3.5" />
          </ToolbarBtn>
          <ToolbarBtn
            compact
            active={editor.isActive('italic')}
            title={`${t.richItalic} (⌘I)`}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="w-3.5 h-3.5" />
          </ToolbarBtn>
          <ToolbarBtn
            compact
            active={editor.isActive('strike')}
            title={t.richStrike}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough className="w-3.5 h-3.5" />
          </ToolbarBtn>
          <ToolbarBtn
            compact
            active={editor.isActive('highlight')}
            title={t.richHighlight}
            onClick={() => editor.chain().focus().toggleHighlight().run()}
          >
            <Highlighter className="w-3.5 h-3.5" />
          </ToolbarBtn>
          <ToolbarBtn
            compact
            active={editor.isActive('code')}
            title={t.richCode}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <Code className="w-3.5 h-3.5" />
          </ToolbarBtn>

          <span className="w-[1px] h-3.5 mx-1" style={{ background: 'var(--hairline)' }} />

          <ToolbarBtn
            compact
            active={editor.isActive('heading', { level: 2 })}
            title={t.richHeading2}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 className="w-3.5 h-3.5" />
          </ToolbarBtn>
          <ToolbarBtn
            compact
            active={editor.isActive('heading', { level: 3 })}
            title={t.richHeading3}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            <Heading3 className="w-3.5 h-3.5" />
          </ToolbarBtn>
          <ToolbarBtn
            compact
            active={editor.isActive('taskList')}
            title={t.richChecklist}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          >
            <CheckSquare className="w-3.5 h-3.5" />
          </ToolbarBtn>
          <ToolbarBtn
            compact
            active={editor.isActive('bulletList')}
            title={t.richBullet}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="w-3.5 h-3.5" />
          </ToolbarBtn>
          <ToolbarBtn
            compact
            active={editor.isActive('orderedList')}
            title={t.richOrdered}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="w-3.5 h-3.5" />
          </ToolbarBtn>
          <ToolbarBtn
            compact
            active={editor.isActive('blockquote')}
            title={t.richQuote}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Quote className="w-3.5 h-3.5" />
          </ToolbarBtn>

          <span className="w-[1px] h-3.5 mx-1" style={{ background: 'var(--hairline)' }} />

          <ToolbarBtn
            compact
            active={editor.isActive('link') || toolbarEditingLink}
            title={t.richLink}
            onClick={() => {
              const prev = (editor.getAttributes('link').href as string | undefined) || '';
              setLinkDraft(prev);
              setToolbarEditingLink((v) => !v);
            }}
          >
            <Link2 className="w-3.5 h-3.5" />
          </ToolbarBtn>

          {activeLinkHref && !toolbarEditingLink && (
            <>
              <ToolbarBtn
                compact
                active={false}
                title={t.attOpen}
                onClick={() => void storageApi.openExternalUrl(activeLinkHref)}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </ToolbarBtn>
              <ToolbarBtn
                compact
                active={false}
                title={t.delete}
                onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
              >
                <Unlink className="w-3.5 h-3.5" />
              </ToolbarBtn>
            </>
          )}

          {toolbarEditingLink && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = linkDraft.trim();
                if (!trimmed) {
                  editor.chain().focus().extendMarkRange('link').unsetLink().run();
                } else {
                  const normalized = /^https?:\/\//i.test(trimmed)
                    ? trimmed
                    : `https://${trimmed}`;
                  const safe = sanitizeHref(normalized);
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
                }
                setToolbarEditingLink(false);
                setLinkDraft('');
              }}
              className="flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded-[6px] border"
              style={{ background: 'var(--bg-subtle)', borderColor: 'var(--hairline)' }}
            >
              <input
                type="text"
                autoFocus
                value={linkDraft}
                onChange={(e) => setLinkDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setToolbarEditingLink(false);
                    editor.commands.focus();
                  }
                }}
                placeholder={t.richLinkPh}
                className="bg-transparent border-0 outline-none text-[11.5px] w-[150px]"
                style={{ color: 'var(--text-1)' }}
              />
              <button
                type="submit"
                className="w-5 h-5 rounded-[5px] inline-flex items-center justify-center"
                style={{ background: 'var(--accent)', color: '#fff' }}
                title={t.confirm}
              >
                <Check className="w-3 h-3" />
              </button>
            </form>
          )}
        </div>
      )}

      {showToolbar ? (
        <div
          className={`ap-prose cursor-text ${variant === 'input' ? 'px-3 py-2' : ''}`}
          style={{
            minHeight,
            maxHeight,
            overflowY: 'auto',
          }}
          onClick={() => {
            if (editor && !editor.isFocused) {
              editor.commands.focus();
            }
          }}
        >
          <EditorContent editor={editor} />
        </div>
      ) : (
        <EditorContent editor={editor} />
      )}

      {/* Drag-Drop Apple Highlight Overlay */}
      {dragOver && (
        <div
          className="pointer-events-none absolute inset-0 rounded-[9px] flex items-center justify-center gap-1.5 text-[12.5px] font-medium z-10"
          style={{
            background: 'color-mix(in srgb, var(--accent) 12%, var(--bg-card))',
            border: '1.5px dashed var(--accent)',
            color: 'var(--accent)',
          }}
        >
          <Paperclip className="w-3.5 h-3.5" />
          {t.richDropHint}
        </div>
      )}

      {/* Apple Floating Selection Bubble Toolbar */}
      {editor &&
        bubblePos &&
        createPortal(
          <div
            className="fixed z-50 -translate-x-1/2 flex items-center gap-0.5 px-1.5 py-1 rounded-[10px] border ap-toast-enter"
            style={{
              top: bubblePos.top,
              left: bubblePos.left,
              background: 'var(--bg-card)',
              borderColor: 'var(--hairline)',
              boxShadow: 'var(--shadow-modal)',
            }}
            onMouseDown={(e) => {
              // Keep TipTap text selection alive unless clicking inside link URL input
              if ((e.target as HTMLElement).tagName !== 'INPUT') {
                e.preventDefault();
              }
            }}
          >
            {editingLink ? (
              <form onSubmit={applyLink} className="flex items-center gap-1 px-1">
                <input
                  type="text"
                  autoFocus
                  value={linkDraft}
                  onChange={(e) => setLinkDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setEditingLink(false);
                      editor.commands.focus();
                    }
                  }}
                  placeholder={t.richLinkPh}
                  className="bg-transparent border-0 outline-none text-[12px] w-[190px]"
                  style={{ color: 'var(--text-1)' }}
                />
                <button
                  type="submit"
                  className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                  title={t.confirm}
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </form>
            ) : (
              <>
                <ToolbarBtn
                  active={editor.isActive('bold')}
                  title={t.richBold}
                  onClick={() => editor.chain().focus().toggleBold().run()}
                >
                  <Bold className="w-3.5 h-3.5" />
                </ToolbarBtn>
                <ToolbarBtn
                  active={editor.isActive('italic')}
                  title={t.richItalic}
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                >
                  <Italic className="w-3.5 h-3.5" />
                </ToolbarBtn>
                <ToolbarBtn
                  active={editor.isActive('highlight')}
                  title={t.richHighlight}
                  onClick={() => editor.chain().focus().toggleHighlight().run()}
                >
                  <Highlighter className="w-3.5 h-3.5" />
                </ToolbarBtn>
                <ToolbarBtn
                  active={editor.isActive('code')}
                  title={t.richCode}
                  onClick={() => editor.chain().focus().toggleCode().run()}
                >
                  <Code className="w-3.5 h-3.5" />
                </ToolbarBtn>
                <span
                  className="w-[1px] h-4 mx-0.5"
                  style={{ background: 'var(--hairline)' }}
                />
                <ToolbarBtn
                  active={editor.isActive('link')}
                  title={t.richLink}
                  onClick={openLinkPrompt}
                >
                  <Link2 className="w-3.5 h-3.5" />
                </ToolbarBtn>
                {activeLinkHref && (
                  <>
                    <ToolbarBtn
                      active={false}
                      title={t.attOpen}
                      onClick={() => void storageApi.openExternalUrl(activeLinkHref)}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </ToolbarBtn>
                    <ToolbarBtn
                      active={false}
                      title={t.delete}
                      onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
                    >
                      <Unlink className="w-3.5 h-3.5" />
                    </ToolbarBtn>
                  </>
                )}
                <span
                  className="w-[1px] h-4 mx-0.5"
                  style={{ background: 'var(--hairline)' }}
                />
                <ToolbarBtn
                  active={editor.isActive('taskList')}
                  title={t.richChecklist}
                  onClick={() => editor.chain().focus().toggleTaskList().run()}
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                </ToolbarBtn>
                <ToolbarBtn
                  active={editor.isActive('bulletList')}
                  title={t.richBullet}
                  onClick={() => editor.chain().focus().toggleBulletList().run()}
                >
                  <List className="w-3.5 h-3.5" />
                </ToolbarBtn>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

function ToolbarBtn({
  active,
  compact = false,
  title,
  onClick,
  children,
}: {
  active: boolean;
  compact?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`${
        compact ? 'w-6 h-6 rounded-[6px]' : 'w-7 h-7 rounded-[7px]'
      } inline-flex items-center justify-center ap-ease hover:bg-[var(--bg-subtle-hover)]`}
      style={{
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-2)',
      }}
    >
      {children}
    </button>
  );
}
