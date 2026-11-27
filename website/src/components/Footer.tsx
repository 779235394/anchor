import { CHANGELOG_URL, RELEASES_URL, REPO_URL, type SiteCopy } from '@/i18n/copy';

export function Footer({ copy }: { copy: SiteCopy }) {
  const iconSrc = `${import.meta.env.BASE_URL}app-icon.png`;

  return (
    <footer
      className="border-t py-10"
      style={{ borderColor: 'var(--hairline)' }}
    >
      <div className="mx-auto flex max-w-[1320px] flex-col items-start justify-between gap-6 px-4 sm:px-6 md:flex-row md:items-center lg:px-8">
        <div className="flex items-center gap-3">
          <img
            src={iconSrc}
            alt="Anchor"
            width={28}
            height={28}
            className="h-7 w-7 rounded-[7px]"
          />
          <div>
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text-1)' }}>
              Anchor
            </p>
            <p className="text-[12.5px]" style={{ color: 'var(--text-3)' }}>
              {copy.footer.tagline}
            </p>
          </div>
        </div>

        <div
          className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]"
          style={{ color: 'var(--text-2)' }}
        >
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-[var(--text-1)]"
          >
            {copy.footer.repo}
          </a>
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-[var(--text-1)]"
          >
            {copy.footer.releases}
          </a>
          <a
            href={CHANGELOG_URL}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-[var(--text-1)]"
          >
            {copy.footer.changelog}
          </a>
          <span style={{ color: 'var(--text-3)' }}>
            {copy.footer.copyright} · {copy.footer.rights}
          </span>
        </div>
      </div>
    </footer>
  );
}
