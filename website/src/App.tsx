import { useState } from 'react';
import { motion, MotionConfig, useScroll, useSpring } from 'motion/react';
import { SITE_COPY } from '@/i18n/copy';
import { useLatestRelease } from '@/hooks/useLatestRelease';
import { useSitePrefs } from '@/hooks/useSitePrefs';
import { useLenisSmoothScroll } from '@/hooks/useLenisSmoothScroll';
import { OpticalCausticsCanvas } from '@/components/OpticalCausticsCanvas';
import { Navbar } from '@/components/Navbar';
import { HeroCinema } from '@/components/HeroCinema';
import { StickyDesktopCinema } from '@/components/StickyDesktopCinema';
import { ExplodedGlassLayers } from '@/components/ExplodedGlassLayers';
import { FeatureBento } from '@/components/FeatureBento';
import { DownloadCenter } from '@/components/DownloadCenter';
import { Footer } from '@/components/Footer';

export function App() {
  const { theme, toggleTheme, accent, setAccent, lang, toggleLang } = useSitePrefs();
  const { release, visitorOS } = useLatestRelease();
  const [playgroundFullscreen, setPlaygroundFullscreen] = useState(false);

  useLenisSmoothScroll(playgroundFullscreen);

  const { scrollYProgress } = useScroll();
  const scrollRailScaleX = useSpring(scrollYProgress, {
    stiffness: 200,
    damping: 30,
    restDelta: 0.001,
  });

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
        {/* Living 60fps Optical Refraction Background */}
        <OpticalCausticsCanvas theme={theme} accent={accent} />

        {/* Hairline Scroll Progress Aurora Laser */}
        <motion.div
          aria-hidden="true"
          style={{
            scaleX: scrollRailScaleX,
            transformOrigin: '0% 50%',
            background: 'var(--accent)',
          }}
          className="pointer-events-none fixed inset-x-0 top-16 z-[60] h-[2px] opacity-85"
        />

        <Navbar
          copy={copy}
          theme={theme}
          onToggleTheme={toggleTheme}
          onToggleLang={toggleLang}
          primaryCtaLabel={primaryCtaLabel}
        />

        <main className="relative z-10">
          <HeroCinema
            copy={copy}
            lang={lang}
            theme={theme}
            primaryCtaLabel={primaryCtaLabel}
          />
          <StickyDesktopCinema
            lang={lang}
            theme={theme}
            accent={accent}
            onFullscreenChange={setPlaygroundFullscreen}
          />
          <ExplodedGlassLayers copy={copy} lang={lang} />
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
