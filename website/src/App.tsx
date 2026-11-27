import { MotionConfig } from 'motion/react';
import { SITE_COPY } from '@/i18n/copy';
import { useLatestRelease } from '@/hooks/useLatestRelease';
import { useSitePrefs } from '@/hooks/useSitePrefs';
import { Navbar } from '@/components/Navbar';
import { HeroStage } from '@/components/HeroStage';
import { ShowcaseShell } from '@/components/InteractiveShowcase/ShowcaseShell';
import { StickyPrinciples } from '@/components/StickyPrinciples';
import { FeatureBento } from '@/components/FeatureBento';
import { DownloadCenter } from '@/components/DownloadCenter';
import { Footer } from '@/components/Footer';

export function App() {
  const { theme, toggleTheme, accent, setAccent, lang, toggleLang } = useSitePrefs();
  const { release, visitorOS } = useLatestRelease();
  const copy = SITE_COPY[lang];

  const primaryCtaLabel =
    visitorOS === 'windows'
      ? copy.cta.downloadWin
      : visitorOS === 'mac'
        ? copy.cta.downloadMac
        : copy.cta.downloadDefault;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-[100dvh]">
        <Navbar
          copy={copy}
          theme={theme}
          onToggleTheme={toggleTheme}
          onToggleLang={toggleLang}
          primaryCtaLabel={primaryCtaLabel}
        />

        <main>
          <HeroStage copy={copy} theme={theme} primaryCtaLabel={primaryCtaLabel} />
          <ShowcaseShell copy={copy} lang={lang} />
          <StickyPrinciples copy={copy} lang={lang} />
          <FeatureBento
            copy={copy}
            lang={lang}
            theme={theme}
            accent={accent}
            onSelectAccent={setAccent}
            primaryCtaLabel={primaryCtaLabel}
          />
          <DownloadCenter copy={copy} release={release} visitorOS={visitorOS} />
        </main>

        <Footer copy={copy} />
      </div>
    </MotionConfig>
  );
}

export default App;
