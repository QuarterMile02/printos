import Link from 'next/link'
import type { ReactNode } from 'react'

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
// isn't the right behavior. `onClick` renders a <button> instead of a
// link entirely -- for actions that aren't navigation at all (e.g.
// Assets' "Add New Category", which toggles an inline input rather than
// going anywhere).
type Action = { label: string; href?: string; onClick?: () => void; external?: boolean }

type Props = {
  title: string
  count?: number
  description?: string
  primaryAction?: Action
  // Escapes the declarative primaryAction entirely when the trigger
  // itself needs to swap for other interactive content -- e.g. Assets'
  // "Add New Category" button turning into a text input in the same
  // slot. Still renders inside this header's standard action-row
  // position/spacing; only the control itself is caller-owned.
  primaryActionSlot?: ReactNode
  secondaryActions?: Action[]
}

const PLUS_ICON = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
)

function ActionButton({ action, className, icon }: { action: Action; className: string; icon?: boolean }) {
  const content = icon ? <>{PLUS_ICON}{action.label}</> : action.label
  if (action.onClick) {
    return <button type="button" onClick={action.onClick} className={className}>{content}</button>
  }
  if (action.external) {
    return <a href={action.href} className={className}>{content}</a>
  }
  return <Link href={action.href ?? '#'} className={className}>{content}</Link>
}

export function SettingsPageHeader({ title, count, description, primaryAction, primaryActionSlot, secondaryActions }: Props) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-extrabold text-qm-black">
          {title}
          {count !== undefined && <span className="text-sm font-normal text-gray-400"> ({count.toLocaleString()})</span>}
        </h1>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
      {(primaryAction || primaryActionSlot || (secondaryActions && secondaryActions.length > 0)) && (
        <div className="flex items-center gap-2">
          {secondaryActions?.map((a) => (
            <ActionButton
              key={a.href ?? a.label}
              action={a}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-qm-black hover:bg-gray-50 transition-colors"
            />
          ))}
          {primaryActionSlot ?? (primaryAction && (
            <ActionButton
              action={primaryAction}
              icon
              className="inline-flex items-center gap-1.5 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 transition-all"
            />
          ))}
        </div>
      )}
    </div>
  )
}
