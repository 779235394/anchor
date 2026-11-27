import { useEffect, useState } from 'react';
import type { AccentKey, Lang, ThemeMode } from '@/i18n/copy';

const THEME_KEY = 'anchor_site_theme';
const ACCENT_KEY = 'anchor_site_accent';
const LANG_KEY = 'anchor_site_lang';

const VALID_ACCENTS: AccentKey[] = ['blue', 'indigo', 'teal', 'graphite'];

function getInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Ignore storage failures
  }
  return 'dark';
}

function getInitialAccent(): AccentKey {
  try {
    const saved = localStorage.getItem(ACCENT_KEY) as AccentKey | null;
    if (saved && VALID_ACCENTS.includes(saved)) return saved;
  } catch {
    // Ignore
  }
  return 'blue';
}

function getInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    // Ignore
  }
  if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('en')) {
    return 'en';
  }
  return 'zh';
}

export function useSitePrefs() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [accent, setAccent] = useState<AccentKey>(getInitialAccent);
  const [lang, setLang] = useState<Lang>(getInitialLang);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-accent', accent);
    root.lang = lang === 'zh' ? 'zh-CN' : 'en';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'light' ? '#E6ECF5' : '#080A10');
    }
    try {
      localStorage.setItem(THEME_KEY, theme);
      localStorage.setItem(ACCENT_KEY, accent);
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // Ignore
    }
  }, [theme, accent, lang]);

  return {
    theme,
    setTheme,
    toggleTheme: () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark')),
    accent,
    setAccent,
    lang,
    setLang,
    toggleLang: () => setLang((prev) => (prev === 'zh' ? 'en' : 'zh')),
  };
}
