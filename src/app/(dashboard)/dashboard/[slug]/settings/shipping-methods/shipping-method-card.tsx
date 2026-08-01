import Link from 'next/link'
import type { MethodRow } from './shipping-methods-list-client'

const CARRIER_BADGE: Record<string, string> = {
  fedex: 'bg-purple-50 text-purple-700', ups: 'bg-amber-50 text-amber-800', usps: 'bg-blue-50 text-blue-700',
  easypost: 'bg-indigo-50 text-indigo-700', local: 'bg-green-50 text-green-700', pickup: 'bg-teal-50 text-teal-700',
  freight: 'bg-orange-50 text-orange-700', other: 'bg-gray-100 text-gray-600',
}
const CARRIER_LABEL: Record<string, string> = {
  fedex: 'FedEx', ups: 'UPS', usps: 'USPS', easypost: 'EasyPost', local: 'Local', pickup: 'Pickup', freight: 'Freight', other: 'Other',
}

export function ShippingMethodCard({ method, orgSlug }: { method: MethodRow; orgSlug: string }) {
  const href = `/dashboard/${orgSlug}/settings/shipping-methods?edit=${method.id}`

  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-qm-lime hover:shadow-md transition-all"
    >
      {method.carrier && (
        <span className={`self-start inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${CARRIER_BADGE[method.carrier] ?? 'bg-gray-100 text-gray-600'}`}>
          {CARRIER_LABEL[method.carrier] ?? method.carrier}
        </span>
      )}

      <div className="font-semibold text-sm text-qm-black truncate" title={method.name}>
        {method.name}
      </div>

      <div className="mt-auto pt-1">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            method.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {method.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
    </Link>
  )
}
