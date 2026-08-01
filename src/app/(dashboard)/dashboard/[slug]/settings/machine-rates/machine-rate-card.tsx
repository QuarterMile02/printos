import Link from 'next/link'

type MachineRateCardRow = {
  id: string
  name: string
  external_name: string | null
  cost: number | null
  price: number | null
  units: string | null
  active: boolean | null
}

const formatMoney = (v: number | null) => v == null ? '—' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function MachineRateCard({ rate, orgSlug, deptLabel }: { rate: MachineRateCardRow; orgSlug: string; deptLabel: string | null }) {
  const href = `/dashboard/${orgSlug}/settings/machine-rates?edit=${rate.id}`

  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-qm-lime hover:shadow-md transition-all"
    >
      {deptLabel && (
        <div className="text-xs font-semibold text-qm-fuchsia">{deptLabel}</div>
      )}

      <div className="font-semibold text-sm text-qm-black truncate" title={rate.name}>
        {rate.name}
      </div>
      {rate.external_name && (
        <div className="text-xs text-gray-500 truncate">{rate.external_name}</div>
      )}

      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500">Cost {formatMoney(rate.cost)}</span>
        <span className="font-semibold text-gray-900">{formatMoney(rate.price)}</span>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            rate.active !== false ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {rate.active !== false ? 'Active' : 'Inactive'}
        </span>
        {rate.units && <span className="text-xs text-gray-400 shrink-0">{rate.units}</span>}
      </div>
    </Link>
  )
}
