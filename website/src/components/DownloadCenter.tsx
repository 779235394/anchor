import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  AppleLogo,
  ArrowSquareOut,
  CaretDown,
  DownloadSimple,
  WindowsLogo,
} from '@phosphor-icons/react';
import { CHANGELOG_URL, RELEASES_URL, type SiteCopy } from '@/i18n/copy';
import type { ReleaseInfo, VisitorOS } from '@/hooks/useLatestRelease';

interface DownloadCenterProps {
  copy: SiteCopy;
  release: ReleaseInfo;
  visitorOS: VisitorOS;
}

export function DownloadCenter({ copy, release, visitorOS }: DownloadCenterProps) {
  const reduceMotion = useReducedMotion();
  const [showNotes, setShowNotes] = useState(false);

  const macRecommended = visitorOS !== 'windows';
  const winRecommended = visitorOS === 'windows';

  const noteLines = release.body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('---'))
    .slice(0, 14);

  return (
    <section id="download" className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-[660px]"
        >
          <h2
            className="text-[30px] font-bold tracking-[-0.03em] leading-[1.15] sm:text-[42px]"
            style={{ color: 'var(--text-1)' }}
          >
            {copy.downloads.heading}
          </h2>
          <p className="mt-3.5 text-[15.5px] leading-[1.65]" style={{ color: 'var(--text-2)' }}>
            {copy.downloads.subtext}
          </p>
        </motion.div>

        {/* Live Version Status Strip */}
        <div
          className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border px-4 py-3 text-[13px]"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--hairline)' }}
        >
          <div className="flex flex-wrap items-center gap-3">
            {release.loading ? (
              <span className="inline-flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
                <span className="h-3.5 w-28 animate-pulse rounded bg-[var(--bg-subtle-hover)]" />
                <span>{copy.downloads.loadingRelease}</span>
              </span>
            ) : (
              <>
                <span style={{ color: 'var(--text-2)' }}>{copy.downloads.latestLabel}</span>
                <span
                  className="tabular-nums rounded-full px-2.5 py-0.5 font-mono text-[12.5px] font-semibold"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  {release.tagName}
                </span>
                {release.publishedAt && (
                  <span className="tabular-nums" style={{ color: 'var(--text-3)' }}>
                    {release.publishedAt}
                  </span>
                )}
                {!release.isLive && (
                  <span style={{ color: 'var(--text-3)' }}>{copy.downloads.fallbackNotice}</span>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {noteLines.length > 0 && (
              <button
                type="button"
                onClick={() => setShowNotes((s) => !s)}
                className="inline-flex items-center gap-1.5 font-medium transition-colors hover:text-[var(--accent)]"
                style={{ color: 'var(--text-2)' }}
              >
                <span>
                  {showNotes
                    ? copy.downloads.releaseNotesHide
                    : copy.downloads.releaseNotesToggle}
                </span>
                <CaretDown
                  size={14}
                  className={`transition-transform ${showNotes ? 'rotate-180' : ''}`}
                />
              </button>
            )}
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium transition-colors hover:text-[var(--accent)]"
              style={{ color: 'var(--text-2)' }}
            >
              <span>{copy.cta.allReleases}</span>
              <ArrowSquareOut size={14} />
            </a>
          </div>
        </div>

        {/* Expandable Release Notes */}
        <AnimatePresence>
          {showNotes && noteLines.length > 0 && (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div
                className="site-card mt-3 space-y-1.5 rounded-[16px] p-5 text-[13px] leading-[1.65]"
                style={{ color: 'var(--text-2)' }}
              >
                {noteLines.map((line, i) => (
                  <p key={i} className={line.startsWith('#') ? 'font-semibold text-[var(--text-1)]' : ''}>
                    {line.replace(/^#+\s*/, '')}
                  </p>
                ))}
                <a
                  href={CHANGELOG_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 font-medium"
                  style={{ color: 'var(--accent)' }}
                >
                  <span>{copy.footer.changelog}</span>
                  <ArrowSquareOut size={13} />
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Platform Installer Cards */}
        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* macOS Card */}
          <div
            className="site-glass-shell flex flex-col justify-between rounded-[22px] p-7"
            style={{
              borderColor: macRecommended
                ? 'color-mix(in srgb, var(--accent) 45%, var(--bg-shell-border))'
                : 'var(--bg-shell-border)',
            }}
          >
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-12 w-12 items-center justify-center rounded-[14px]"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    <AppleLogo size={26} weight="duotone" />
                  </span>
                  <div>
                    <h3 className="text-[20px] font-bold" style={{ color: 'var(--text-1)' }}>
                      {copy.downloads.macTitle}
                    </h3>
                    <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
                      {copy.downloads.macFileNote}
                    </p>
                  </div>
                </div>
                {macRecommended && (
                  <span
                    className="rounded-full px-3 py-1 text-[11.5px] font-semibold whitespace-nowrap"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    {copy.downloads.recommended}
                  </span>
                )}
              </div>
              <p className="mt-4 text-[14.5px] leading-[1.6]" style={{ color: 'var(--text-2)' }}>
                {copy.downloads.macDesc}
              </p>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href={release.macDmgUrl}
                target="_blank"
                rel="noreferrer"
                className={`${macRecommended ? 'site-btn-primary' : 'site-btn-secondary'} h-11 px-6 text-[14px]`}
              >
                <DownloadSimple size={17} weight="bold" />
                <span>{copy.cta.downloadMac}</span>
              </a>
            </div>
          </div>

          {/* Windows Card */}
          <div
            className="site-glass-shell flex flex-col justify-between rounded-[22px] p-7"
            style={{
              borderColor: winRecommended
                ? 'color-mix(in srgb, var(--accent) 45%, var(--bg-shell-border))'
                : 'var(--bg-shell-border)',
            }}
          >
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-12 w-12 items-center justify-center rounded-[14px]"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    <WindowsLogo size={26} weight="duotone" />
                  </span>
                  <div>
                    <h3 className="text-[20px] font-bold" style={{ color: 'var(--text-1)' }}>
                      {copy.downloads.winTitle}
                    </h3>
                    <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
                      {copy.downloads.winFileNote}
                    </p>
                  </div>
                </div>
                {winRecommended && (
                  <span
                    className="rounded-full px-3 py-1 text-[11.5px] font-semibold whitespace-nowrap"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    {copy.downloads.recommended}
                  </span>
                )}
              </div>
              <p className="mt-4 text-[14.5px] leading-[1.6]" style={{ color: 'var(--text-2)' }}>
                {copy.downloads.winDesc}
              </p>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href={release.winExeUrl}
                target="_blank"
                rel="noreferrer"
                className={`${winRecommended ? 'site-btn-primary' : 'site-btn-secondary'} h-11 px-6 text-[14px]`}
              >
                <DownloadSimple size={17} weight="bold" />
                <span>{copy.cta.downloadWin}</span>
              </a>
              <a
                href={release.winMsiUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] font-medium underline-offset-4 hover:underline"
                style={{ color: 'var(--text-2)' }}
              >
                {copy.downloads.msiAlt}
              </a>
            </div>
          </div>
        </div>

        {/* Clean 3-Step Onboarding Strip (No repetitive card wrappers) */}
        <div
          className="mt-14 border-t pt-10"
          style={{ borderColor: 'var(--hairline)' }}
        >
          <h3 className="text-[16px] font-semibold" style={{ color: 'var(--text-1)' }}>
            {copy.downloads.stepsTitle}
          </h3>
          <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-3">
            {copy.downloads.steps.map((step, idx) => (
              <div key={step.title} className="space-y-2">
                <span
                  className="tabular-nums font-mono text-[13px] font-semibold"
                  style={{ color: 'var(--accent)' }}
                >
                  0{idx + 1}
                </span>
                <h4 className="text-[16px] font-semibold" style={{ color: 'var(--text-1)' }}>
                  {step.title}
                </h4>
                <p className="text-[14px] leading-[1.65]" style={{ color: 'var(--text-2)' }}>
                  {step.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
