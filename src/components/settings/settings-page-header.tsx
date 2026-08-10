import Link from 'next/link'

// Canonical settings-page header -- title + count, one primary "+ New X"
// action (SVG plus icon, rounded-lg), plus room for secondary actions
// (Materials' "Export CSV"/"Import CSV") without special-casing them.
// This is Email Templates'/Materials' button shape, not the plain-text
// "+ New X" / rounded-md shape the other 6 pages currently use -- those
// are the ones that need to change to match this, per the canonical
// choice (header button style unchanged from the earlier recommendation).

// `external: true` renders a plain <a> instead of next/link's <Link> --
// needed for actions like a CSV export that hit an API route directly
// (Content-Disposition download), where Link's client-side navigation
// isn't the right behavior.
type Action = { label: string; href: string; external?: boolean }

type Props = {
  title: string
  count?: number
  description?: string
  primaryAction?: Action
  secondaryActions?: Action[]
}

export function SettingsPageHeader({ title, count, description, primaryAction, secondaryActions }: Props) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-extrabold text-qm-black">
          {title}
          {count !== undefined && <span className="text-sm font-normal text-gray-400"> ({count.toLocaleString()})</span>}
        </h1>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
      {(primaryAction || (secondaryActions && secondaryActions.length > 0)) && (
        <div className="flex items-center gap-2">
          {secondaryActions?.map((a) => {
            const cls = "inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-qm-black hover:bg-gray-50 transition-colors"
            return a.external ? (
              <a key={a.href} href={a.href} className={cls}>{a.label}</a>
            ) : (
              <Link key={a.href} href={a.href} className={cls}>{a.label}</Link>
            )
          })}
          {primaryAction && (
            <Link
              href={primaryAction.href}
              className="inline-flex items-center gap-1.5 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 transition-all"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {primaryAction.label}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
