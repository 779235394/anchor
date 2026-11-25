import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isStickyColor } from './domain/stickies';
import type { StickyColor } from './domain/types';
import { isTauriRuntime } from './services/storage';
import { App } from './App';
import { QuickCaptureWindow } from './components/QuickCaptureWindow';
import { StickyNoteWindow } from './components/StickyNoteWindow';
import './styles/global.css';

type WindowRoute =
  | { kind: 'main' }
  | { kind: 'quick-capture' }
  | { kind: 'sticky'; stickyId: string; draft: boolean; initialColor: StickyColor };

function resolveWindowRoute(): WindowRoute {
  if (typeof window !== 'undefined') {
    const hash = window.location.hash || '';
    if (hash === '#quick-capture') {
      return { kind: 'quick-capture' };
    }
    if (hash.startsWith('#sticky/')) {
      const rest = hash.slice('#sticky/'.length);
      const [rawId, rawQuery] = rest.split('?');
      const id = decodeURIComponent(rawId || '').trim();
      const params = new URLSearchParams(rawQuery || '');
      const draft = params.get('draft') === '1';
      const rawColor = params.get('color');
      const initialColor: StickyColor = isStickyColor(rawColor) ? rawColor : 'yellow';
      if (id) return { kind: 'sticky', stickyId: id, draft, initialColor };
    }
  }
  if (isTauriRuntime()) {
    try {
      const label = getCurrentWebviewWindow().label;
      if (label === 'quick-capture') return { kind: 'quick-capture' };
      if (label.startsWith('sticky-')) {
        const id = label.slice('sticky-'.length).trim();
        if (id) return { kind: 'sticky', stickyId: id, draft: false, initialColor: 'yellow' };
      }
    } catch {
      // fallback to main
    }
  }
  return { kind: 'main' };
}

const route = resolveWindowRoute();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {route.kind === 'quick-capture' ? (
      <QuickCaptureWindow standalone />
    ) : route.kind === 'sticky' ? (
      <StickyNoteWindow
        stickyId={route.stickyId}
        draft={route.draft}
        initialColor={route.initialColor}
      />
    ) : (
      <App />
    )}
  </StrictMode>,
);
