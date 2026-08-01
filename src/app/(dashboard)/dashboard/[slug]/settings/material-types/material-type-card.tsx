import Link from 'next/link'
import type { MaterialTypeRow } from './material-types-list-client'

export function MaterialTypeCard({ type, orgSlug, count }: { type: MaterialTypeRow; orgSlug: string; count: number }) {
  const href = `/dashboard/${orgSlug}/settings/material-types?edit=${type.id}`

  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-qm-lime hover:shadow-md transition-all"
    >
      <div className="font-semibold text-sm text-qm-black truncate" title={type.name}>
        {type.name}
      </div>
      <div className="text-sm text-gray-500">{count} material{count !== 1 ? 's' : ''}</div>

      <div className="mt-auto pt-1">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            type.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {type.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
    </Link>
  )
}
