import Link from 'next/link'

type DiscountCardRow = {
  id: string
  name: string
  discount_type: string | null
  applies_to: string | null
  active: boolean | null
}

export function DiscountCard({ discount, orgSlug, tierCount }: { discount: DiscountCardRow; orgSlug: string; tierCount: number }) {
  const href = `/dashboard/${orgSlug}/settings/discounts/${discount.id}`

  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-qm-lime hover:shadow-md transition-all"
    >
      {discount.discount_type && (
        <span className={`self-start inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
          discount.discount_type === 'Volume' ? 'bg-blue-50 text-blue-700' :
          discount.discount_type === 'Range' ? 'bg-amber-50 text-amber-700' :
          'bg-gray-100 text-gray-600'
        }`}>{discount.discount_type}</span>
      )}

      <div className="font-semibold text-sm text-qm-black truncate" title={discount.name}>
        {discount.name}
      </div>

      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{discount.applies_to ?? '—'}</span>
        <span>{tierCount} {tierCount === 1 ? 'tier' : 'tiers'}</span>
      </div>

      <div className="mt-auto pt-1">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            discount.active !== false ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {discount.active !== false ? 'Active' : 'Inactive'}
        </span>
      </div>
    </Link>
  )
}
