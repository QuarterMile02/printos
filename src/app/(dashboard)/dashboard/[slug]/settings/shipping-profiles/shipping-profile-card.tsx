import Link from 'next/link'
import type { ProfileRow } from './shipping-profiles-list-client'

function dims(p: ProfileRow): string {
  const parts = [p.length_in, p.width_in, p.height_in]
  if (parts.every((v) => v == null)) return '—'
  return parts.map((v) => v ?? '?').join(' × ') + '"'
}

export function ShippingProfileCard({ profile, orgSlug }: { profile: ProfileRow; orgSlug: string }) {
  const href = `/dashboard/${orgSlug}/settings/shipping-profiles?edit=${profile.id}`

  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-qm-lime hover:shadow-md transition-all"
    >
      <div className="font-semibold text-sm text-qm-black truncate" title={profile.name}>
        {profile.name}
      </div>
      <div className="text-sm text-gray-600 font-mono">{dims(profile)}</div>
      <div className="text-xs text-gray-500">
        {profile.max_weight_lbs != null ? `Max ${profile.max_weight_lbs} lbs` : 'No max weight'}
      </div>

      <div className="mt-auto pt-1">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            profile.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {profile.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
    </Link>
  )
}
