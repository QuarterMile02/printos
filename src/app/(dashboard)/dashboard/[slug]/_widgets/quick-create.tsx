// Quick Create Bar — buttons for the actions a user starts most often.
// Role-gated: New Job for production/installer, New Sales Lead for sales,
// New Quote/Customer for everyone with the matching create permission.

import Link from 'next/link'
import type { Role } from '@/lib/permissions'

type Props = {
  orgSlug: string
  role: Role
  canCreateQuotes: boolean
  canCreateCustomers: boolean
}

export default function QuickCreate({ orgSlug, role, canCreateQuotes, canCreateCustomers }: Props) {
  const base = `/dashboard/${orgSlug}`
  const buttons: { label: string; href: string; primary?: boolean }[] = []

  if (canCreateQuotes) buttons.push({ label: '+ New Quote', href: `${base}/quotes/new`, primary: true })
  if (canCreateCustomers) buttons.push({ label: '+ New Customer', href: `${base}/customers` })
  if (role === 'production' || role === 'installer') {
    buttons.push({ label: '+ New Job', href: `${base}/jobs` })
  }
  if (role === 'sales') {
    // sales_leads table not modelled yet — placeholder routes to /quotes/new for now.
    buttons.push({ label: '+ New Sales Lead', href: `${base}/quotes/new` })
  }

  if (buttons.length === 0) return null

  return (
    <div className="col-span-12 flex flex-wrap gap-2">
      {buttons.map((b, i) => (
        <Link
          key={i}
          href={b.href}
          className={`inline-flex items-center rounded-md px-4 py-2 text-sm font-semibold ${
            b.primary
              ? 'bg-[#93ca3b] text-white hover:brightness-110'
              : 'border border-gray-300 bg-white text-[#1A1A1A] hover:bg-gray-50'
          }`}
        >
          {b.label}
        </Link>
      ))}
    </div>
  )
}
