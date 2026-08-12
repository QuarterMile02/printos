import Link from 'next/link'
import type { VendorListRow } from './actions'

export function VendorCard({ v, orgSlug }: { v: VendorListRow; orgSlug: string }) {
  const href = `/dashboard/${orgSlug}/vendors/${v.id}`
  const cityState = [v.city, v.state].filter(Boolean).join(', ')
  const isInactive = v.is_active === false

  return (
    <Link
      href={href}
      className={`flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-qm-lime hover:shadow-md transition-all ${isInactive ? 'opacity-60' : ''}`}
    >
      <div className="font-semibold text-sm text-qm-black truncate" title={v.name ?? undefined}>
        {v.name}
      </div>
      {v.primary_contact && (
        <div className="text-xs text-qm-gray truncate">{v.primary_contact}</div>
      )}
      <div className="flex flex-col gap-1 text-xs text-gray-500">
        {v.primary_phone && (
          <a
            href={`tel:${v.primary_phone}`}
            onClick={(e) => e.stopPropagation()}
            className="truncate hover:underline"
          >
            {v.primary_phone}
          </a>
        )}
        {v.primary_email && <div className="truncate">{v.primary_email}</div>}
        {cityState && <div className="truncate">{cityState}</div>}
      </div>
      <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
        {isInactive ? (
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
            Disabled
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-qm-lime-light px-2 py-0.5 text-xs font-semibold text-qm-lime-dark">
            Active
          </span>
        )}
      </div>
    </Link>
  )
}
