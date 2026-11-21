import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isTauriRuntime } from './services/storage';
import { App } from './App';
import { QuickCaptureWindow } from './components/QuickCaptureWindow';
import './styles/global.css';

function isQuickCaptureWindow(): boolean {
  if (typeof window !== 'undefined' && window.location.hash === '#quick-capture') {
    return true;
  }
  if (isTauriRuntime()) {
    try {
      return getCurrentWebviewWindow().label === 'quick-capture';
    } catch {
      return false;
    }
  }
  return false;
}

const standaloneQuickCapture = isQuickCaptureWindow();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {standaloneQuickCapture ? <QuickCaptureWindow standalone /> : <App />}
  </StrictMode>,
);
