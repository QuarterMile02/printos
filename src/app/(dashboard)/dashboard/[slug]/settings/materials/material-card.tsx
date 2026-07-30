import Link from 'next/link'

type MaterialCardRow = {
  id: string
  name: string
  external_name: string | null
  cost: number | null
  price: number | null
  selling_units: string | null
  material_type_id: string | null
  active: boolean | null
}

const formatMoney = (v: number | null) => v == null ? '—' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function MaterialCard({ material, orgSlug, typeName }: { material: MaterialCardRow; orgSlug: string; typeName: string | null }) {
  const href = `/dashboard/${orgSlug}/settings/materials/${material.id}`

  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-qm-lime hover:shadow-md transition-all"
    >
      {/* Type */}
      {typeName && (
        <div className="text-xs font-semibold text-qm-fuchsia">{typeName}</div>
      )}

      {/* Name */}
      <div className="font-semibold text-sm text-qm-black truncate" title={material.name}>
        {material.name}
      </div>
      {material.external_name && (
        <div className="text-xs text-gray-500 truncate">{material.external_name}</div>
      )}

      {/* Cost / Price */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500">Cost {formatMoney(material.cost)}</span>
        <span className="font-semibold text-gray-900">{formatMoney(material.price)}</span>
      </div>

      {/* Status + Units */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            material.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {material.active ? 'Active' : 'Inactive'}
        </span>
        {material.selling_units && <span className="text-xs text-gray-400 shrink-0">{material.selling_units}</span>}
      </div>
    </Link>
  )
}
