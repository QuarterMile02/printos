import Link from 'next/link'
import type { CustomerListRow } from './actions'

const STATUS_STYLES: Record<string, string> = {
  lead:     'bg-gray-100 text-gray-700',
  sold:     'bg-qm-lime-light text-qm-lime-dark',
  closable: 'bg-blue-50 text-blue-700',
  prospect: 'bg-yellow-50 text-yellow-700',
}
const STATUS_LABELS: Record<string, string> = {
  lead: 'Lead', sold: 'Sold', closable: 'Closable', prospect: 'Prospect',
}

export function CustomerCard({ c, orgSlug }: { c: CustomerListRow; orgSlug: string }) {
  const href = `/dashboard/${orgSlug}/customers/${c.id}`
  const contactName = [c.first_name, c.last_name].filter(Boolean).join(' ')
  const cityState = [c.city, c.state].filter(Boolean).join(', ')
  const isInactive = c.is_active === false
  const status = c.status ?? 'lead'

  return (
    <Link
      href={href}
      className={`flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-qm-lime hover:shadow-md transition-all ${isInactive ? 'opacity-60' : ''}`}
    >
      <div className="font-semibold text-sm text-qm-black truncate" title={c.company_name ?? undefined}>
        {c.company_name ?? <span className="font-normal text-gray-400">—</span>}
      </div>
      {contactName && (
        <div className="text-xs text-qm-gray truncate">{contactName}</div>
      )}
      <div className="flex flex-col gap-1 text-xs text-gray-500">
        {c.phone && (
          <a
            href={`tel:${c.phone}`}
            onClick={(e) => e.stopPropagation()}
            className="truncate hover:underline"
          >
            {c.phone}
          </a>
        )}
        {c.email && <div className="truncate">{c.email}</div>}
        {cityState && <div className="truncate">{cityState}</div>}
        {c.terms && <div className="truncate text-gray-400">{c.terms}</div>}
      </div>
      <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
        {isInactive ? (
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
            Disabled
          </span>
        ) : (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'}`}>
            {STATUS_LABELS[status] ?? status}
          </span>
        )}
      </div>
    </Link>
  )
}
