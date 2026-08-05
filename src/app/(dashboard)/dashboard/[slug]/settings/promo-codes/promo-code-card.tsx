import Link from 'next/link'

type PromoCodeCardRow = {
  id: string
  name: string
  code: string
  discount_type: string | null
  value: number | null
  minimum_requirement: number | null
  is_active: boolean
}

export function PromoCodeCard({ promo, orgSlug }: { promo: PromoCodeCardRow; orgSlug: string }) {
  const href = `/dashboard/${orgSlug}/settings/promo-codes/${promo.id}`

  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-qm-lime hover:shadow-md transition-all"
    >
      <div className="font-semibold text-sm text-qm-black truncate" title={promo.name}>
        {promo.name}
      </div>

      <div className="self-start rounded-md bg-gray-50 px-2 py-1 font-mono text-xs text-gray-600">
        {promo.code}
      </div>

      <div className="text-sm text-gray-500">
        {promo.discount_type === 'Percentage' ? `${promo.value ?? 0}% off` : (promo.value ?? '—')}
        {promo.minimum_requirement != null && (
          <span> · min ${Number(promo.minimum_requirement).toFixed(2)}</span>
        )}
      </div>

      <div className="mt-auto pt-1">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            promo.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {promo.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
    </Link>
  )
}
