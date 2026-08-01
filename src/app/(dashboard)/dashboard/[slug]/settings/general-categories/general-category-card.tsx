import Link from 'next/link'
import type { CategoryRow } from './general-categories-list-client'

const TYPE_BADGE: Record<string, string> = {
  asset: 'bg-purple-50 text-purple-700',
  job: 'bg-amber-50 text-amber-700',
  quote: 'bg-blue-50 text-blue-700',
  all: 'bg-gray-100 text-gray-600',
}
const TYPE_LABEL: Record<string, string> = { asset: 'Asset', job: 'Job', quote: 'Quote', all: 'All' }
const SUBTYPE_LABEL: Record<string, string> = {
  asset: 'Asset', industry: 'Industry', lead_source: 'Lead Source', machine: 'Machine',
  note: 'Note', pricing_level: 'Pricing Level', tag: 'Tag',
}

export function GeneralCategoryCard({ category, orgSlug }: { category: CategoryRow; orgSlug: string }) {
  const href = `/dashboard/${orgSlug}/settings/general-categories?edit=${category.id}`

  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-qm-lime hover:shadow-md transition-all"
    >
      <span className={`self-start inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TYPE_BADGE[category.type] ?? 'bg-gray-100 text-gray-600'}`}>
        {TYPE_LABEL[category.type] ?? category.type}
      </span>

      <div className="font-semibold text-sm text-qm-black truncate" title={category.name}>
        {category.name}
      </div>
      {category.sub_type && (
        <div className="text-xs text-gray-500 truncate">{SUBTYPE_LABEL[category.sub_type] ?? category.sub_type}</div>
      )}

      <div className="mt-auto pt-1">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            category.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {category.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
    </Link>
  )
}
