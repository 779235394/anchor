import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileText, FolderKanban, Lightbulb, Search, X } from 'lucide-react';
import type { Lang, WorkspaceData } from '@/domain/types';
import { searchWorkspace } from '@/domain/search';
import { stripMdExtension, type DocSearchHit } from '@/domain/docs';
import { mobileApi } from './api';

interface MobileSearchModalProps {
  open: boolean;
  lang: Lang;
  workspace: WorkspaceData;
  onClose: () => void;
  onSelectTask: (taskId: string) => void;
  onSelectNote: () => void;
  onSelectDoc: (relPath: string) => void;
}

export function MobileSearchModal({
  open,
  lang,
  workspace,
  onClose,
  onSelectTask,
  onSelectNote,
  onSelectDoc,
}: MobileSearchModalProps) {
  const zh = lang !== 'en';
  const [query, setQuery] = useState('');
  const [docHits, setDocHits] = useState<DocSearchHit[]>([]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setDocHits([]);
    }
  }, [open]);

  const localHits = useMemo(() => {
    if (!query.trim()) return [];
    return searchWorkspace(workspace, query, 20).filter((h) => h.kind !== 'sticky');
  }, [workspace, query]);

  useEffect(() => {
    const q = query.trim();
    if (!open || !q) {
      setDocHits([]);
      return;
    }
    const timer = setTimeout(() => {
      void mobileApi
        .searchDocs(q)
        .then((hits) => setDocHits(hits.slice(0, 10)))
        .catch(() => setDocHits([]));
    }, 180);
    return () => clearTimeout(timer);
  }, [open, query]);

  if (!open) return null;

  const hasResults = localHits.length > 0 || docHits.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col m-safe-top"
      style={{
        backgroundColor: 'var(--bg-canvas)',
        backgroundImage: 'var(--bg-canvas-glow)',
      }}
    >
      {/* Top Search Bar */}
      <div
        className="px-4 py-3 flex items-center gap-2 shrink-0 m-glass-bar"
        style={{
          borderBottom: '1px solid var(--hairline-soft)',
        }}
      >
        <div className="relative flex-1">
          <Search
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-3)' }}
          />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={zh ? '全局搜索待办、项目、灵感、知识库…' : 'Search tasks, projects, notes, docs…'}
            className="ap-input w-full pl-9 pr-8 py-2 text-[14px]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-3)' }}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="px-2 py-1.5 text-[14px] font-medium shrink-0"
          style={{ color: 'var(--accent)' }}
        >
          {zh ? '关闭' : 'Close'}
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto m-scroll px-4 py-3 space-y-2 m-safe-bottom">
        {!query.trim() ? (
          <div className="py-16 text-center text-[13.5px]" style={{ color: 'var(--text-3)' }}>
            {zh ? '输入关键词跨全工作台即时检索' : 'Type keywords to search your entire workspace'}
          </div>
        ) : !hasResults ? (
          <div className="py-16 text-center text-[13.5px]" style={{ color: 'var(--text-3)' }}>
            {zh ? '未找到匹配内容' : 'No matching results'}
          </div>
        ) : (
          <>
            {localHits.map((hit) => {
              const Icon =
                hit.kind === 'task'
                  ? CheckCircle2
                  : hit.kind === 'project'
                    ? FolderKanban
                    : Lightbulb;
              return (
                <button
                  key={hit.id}
                  type="button"
                  onClick={() => {
                    onClose();
                    if (hit.kind === 'task') {
                      onSelectTask(hit.entityId);
                    } else if (hit.kind === 'note') {
                      onSelectNote();
                    }
                  }}
                  className="w-full text-left rounded-[14px] px-3.5 py-2.5 flex items-start gap-2.5 ap-card"
                >
                  <Icon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium truncate" style={{ color: 'var(--text-1)' }}>
                      {hit.title}
                    </div>
                    {hit.subtitle && (
                      <div className="text-[11.5px] truncate mt-0.5" style={{ color: 'var(--text-3)' }}>
                        {hit.subtitle}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}

            {docHits.map((doc) => (
              <button
                key={doc.relPath}
                type="button"
                onClick={() => {
                  onClose();
                  onSelectDoc(doc.relPath);
                }}
                className="w-full text-left rounded-[12px] px-3.5 py-2.5 flex items-start gap-2.5"
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--hairline-soft)',
                }}
              >
                <FileText className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--status-green)' }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium truncate" style={{ color: 'var(--text-1)' }}>
                    {stripMdExtension(doc.name)}
                  </div>
                  <div className="text-[11.5px] truncate mt-0.5" style={{ color: 'var(--text-3)' }}>
                    {doc.relPath}
                  </div>
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
