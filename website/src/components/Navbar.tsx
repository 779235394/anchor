import { DownloadSimple, Moon, Sun, Translate } from '@phosphor-icons/react';
import type { SiteCopy, ThemeMode } from '@/i18n/copy';

interface NavbarProps {
  copy: SiteCopy;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onToggleLang: () => void;
  primaryCtaLabel: string;
}

export function Navbar({
  copy,
  theme,
  onToggleTheme,
  onToggleLang,
  primaryCtaLabel,
}: NavbarProps) {
  const iconSrc = `${import.meta.env.BASE_URL}app-icon.png`;

  return (
    <header className="site-glass-nav fixed inset-x-0 top-0 z-50 h-16">
      <div className="mx-auto flex h-full max-w-[1320px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <a
          href="#top"
          className="flex shrink-0 items-center gap-2.5 text-[15px] font-semibold tracking-tight"
          style={{ color: 'var(--text-1)' }}
        >
          <img
            src={iconSrc}
            alt="Anchor"
            width={30}
            height={30}
            className="h-[30px] w-[30px] rounded-[8px] shadow-sm"
          />
          <span className="whitespace-nowrap">Anchor</span>
        </a>

        <nav
          aria-label="Primary"
          className="hidden items-center gap-7 text-[13.5px] font-medium md:flex"
          style={{ color: 'var(--text-2)' }}
        >
          <a href="#showcase" className="whitespace-nowrap transition-colors hover:text-[var(--text-1)]">
            {copy.nav.showcase}
          </a>
          <a href="#principles" className="whitespace-nowrap transition-colors hover:text-[var(--text-1)]">
            {copy.nav.principles}
          </a>
          <a href="#highlights" className="whitespace-nowrap transition-colors hover:text-[var(--text-1)]">
            {copy.nav.highlights}
          </a>
          <a href="#download" className="whitespace-nowrap transition-colors hover:text-[var(--text-1)]">
            {copy.nav.download}
          </a>
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? copy.nav.themeToLight : copy.nav.themeToDark}
            title={theme === 'dark' ? copy.nav.themeToLight : copy.nav.themeToDark}
            className="flex h-9 w-9 items-center justify-center rounded-full border transition-colors hover:bg-[var(--bg-subtle-hover)]"
            style={{
              background: 'var(--bg-subtle)',
              borderColor: 'var(--hairline)',
              color: 'var(--text-1)',
            }}
          >
            {theme === 'dark' ? (
              <Sun size={16} weight="duotone" />
            ) : (
              <Moon size={16} weight="duotone" />
            )}
          </button>

          <button
            type="button"
            onClick={onToggleLang}
            aria-label="Switch language"
            className="flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium whitespace-nowrap transition-colors hover:bg-[var(--bg-subtle-hover)]"
            style={{
              background: 'var(--bg-subtle)',
              borderColor: 'var(--hairline)',
              color: 'var(--text-1)',
            }}
          >
            <Translate size={15} weight="duotone" />
            <span>{copy.nav.langLabel}</span>
          </button>

          <a
            href="#download"
            className="site-btn-primary h-9 px-4 text-[13px]"
          >
            <DownloadSimple size={15} weight="bold" />
            <span className="hidden sm:inline">{primaryCtaLabel}</span>
            <span className="sm:hidden">{copy.nav.download}</span>
          </a>
        </div>
      </div>
    </header>
  );
}
