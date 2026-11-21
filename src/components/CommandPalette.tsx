import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  FolderKanban,
  Lightbulb,
  Paperclip,
  Search,
} from 'lucide-react';
import { searchWorkspace, type SearchHit } from '@/domain/search';
import { getDict } from '@/i18n';
import { useWorkbenchStore } from '@/store/workbenchStore';

export function CommandPalette() {
  const {
    config,
    data,
    commandPaletteOpen,
    setCommandPaletteOpen,
    setView,
    openInspector,
  } = useWorkbenchStore();
  const t = getDict(config.lang);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const hits = useMemo(() => searchWorkspace(data, query, 24), [data, query]);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [commandPaletteOpen]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  if (!commandPaletteOpen) return null;

  const activate = (hit: SearchHit) => {
    setView(hit.view);
    if (hit.kind !== 'note') {
      openInspector({ kind: hit.kind, id: hit.entityId });
    }
    setCommandPaletteOpen(false);
  };

  const kindIcon = (kind: SearchHit['kind']) => {
    switch (kind) {
      case 'task':
        return <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />;
      case 'project':
        return <FolderKanban className="w-4 h-4 shrink-0" style={{ color: 'var(--status-orange)' }} />;
      case 'note':
        return <Lightbulb className="w-4 h-4 shrink-0" style={{ color: 'var(--status-sky)' }} />;
    }
  };

  const kindLabel = (kind: SearchHit['kind']) => {
    switch (kind) {
      case 'task':
        return t.navTasks;
      case 'project':
        return t.navProjects;
      case 'note':
        return t.navNotes;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4"
      style={{ background: 'var(--backdrop-mask)', backdropFilter: 'blur(6px)' }}
      onClick={() => setCommandPaletteOpen(false)}
    >
      <div
        className="w-full max-w-[580px] rounded-[16px] overflow-hidden"
        style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setCommandPaletteOpen(false);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((c) => (hits.length ? (c + 1) % hits.length : 0));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((c) => (hits.length ? (c - 1 + hits.length) % hits.length : 0));
          } else if (e.key === 'Enter' && hits[cursor]) {
            e.preventDefault();
            activate(hits[cursor]);
          }
        }}
      >
        {/* Spotlight Input */}
        <div
          className="flex items-center gap-3 px-4 py-3.5"
          style={{ borderBottom: '1px solid var(--hairline)' }}
        >
          <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--text-3)' }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="flex-1 bg-transparent border-0 outline-none text-[14.5px]"
            style={{ color: 'var(--text-1)' }}
          />
          <kbd
            className="text-[11px] px-1.5 py-0.5 rounded-[5px] font-medium"
            style={{ background: 'var(--bg-subtle)', color: 'var(--text-3)' }}
          >
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[400px] overflow-y-auto p-2">
          {!query.trim() ? (
            <div className="py-10 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
              {t.searchHint}
            </div>
          ) : hits.length === 0 ? (
            <div className="py-10 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
              {t.searchEmpty}
            </div>
          ) : (
            <div className="space-y-0.5">
              {hits.map((hit, idx) => {
                const active = idx === cursor;
                return (
                  <button
                    key={hit.id}
                    type="button"
                    onMouseEnter={() => setCursor(idx)}
                    onClick={() => activate(hit)}
                    className="w-full px-3 py-2.5 rounded-[10px] flex items-center gap-3 text-left ap-ease"
                    style={{
                      background: active ? 'var(--accent-soft)' : 'transparent',
                    }}
                  >
                    {kindIcon(hit.kind)}
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-[13.5px] font-medium truncate"
                        style={{ color: active ? 'var(--accent)' : 'var(--text-1)' }}
                      >
                        {hit.title}
                      </div>
                      {(hit.subtitle || hit.matchedAttachment) && (
                        <div
                          className="text-[11.5px] mt-0.5 flex items-center gap-1.5 truncate"
                          style={{ color: 'var(--text-3)' }}
                        >
                          {hit.matchedAttachment && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0 rounded-full text-[11px]"
                              style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
                            >
                              <Paperclip className="w-2.5 h-2.5" />
                              {hit.matchedAttachment}
                            </span>
                          )}
                          <span className="truncate">{hit.subtitle}</span>
                        </div>
                      )}
                    </div>
                    <span
                      className="text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0"
                      style={{
                        background: active ? 'var(--bg-card)' : 'var(--bg-subtle)',
                        color: 'var(--text-3)',
                      }}
                    >
                      {kindLabel(hit.kind)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
