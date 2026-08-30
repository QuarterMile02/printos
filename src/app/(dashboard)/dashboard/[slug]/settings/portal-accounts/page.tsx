import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import PortalAccountsClient, { type Account } from './portal-accounts-client'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('portal-accounts', err)
  }
}

type ContactRow = {
  id: string
  full_name: string
  email: string | null
  customer_id: string
  portal_user_id: string
  portal_invited_at: string | null
  portal_last_login_at: string | null
  customers: { company_name: string | null; first_name: string; last_name: string } | null
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <div className="p-8 text-red-600">Not authenticated</div>

  const memberRow = await dbOrThrow(
    supabase
      .from('organization_members').select('role')
      .eq('organization_id', org.id).eq('user_id', user.id).maybeSingle()
  ) as { role: string } | null

  // Same gate as Billing/SMS/Payment Gateway -- this page can delete a
  // customer's login entirely, same risk tier as those.
  const isOwnerOrAdmin = memberRow?.role === 'owner' || memberRow?.role === 'admin'
  if (!isOwnerOrAdmin) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900">Portal Accounts</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          Only owners and admins can manage portal accounts. Contact your organization owner.
        </div>
      </div>
    )
  }

  // Staff RLS already grants SELECT on customer_contacts (migration 041) --
  // no service-role read needed here, unlike the portal-side pages where
  // the SESSION is the portal contact itself with no such policy.
  const contactRows = await dbOrThrow(
    supabase
      .from('customer_contacts')
      .select('id, full_name, email, customer_id, portal_user_id, portal_invited_at, portal_last_login_at, customers ( company_name, first_name, last_name )')
      .eq('organization_id', org.id)
      .not('portal_user_id', 'is', null)
      .order('full_name')
  ) as unknown as ContactRow[] | null

  // Group by portal_user_id -- one login can span multiple customer_contacts
  // rows (explicit opt-in multi-customer design, rev. 2 plan).
  const byLogin = new Map<string, Account>()
  for (const r of contactRows ?? []) {
    const customerLabel = r.customers?.company_name?.trim()
      || `${r.customers?.first_name ?? ''} ${r.customers?.last_name ?? ''}`.trim()
      || 'Unnamed account'
    const existing = byLogin.get(r.portal_user_id)
    if (existing) {
      existing.customers.push({ id: r.customer_id, name: customerLabel })
      if (r.portal_invited_at && (!existing.invitedAt || r.portal_invited_at < existing.invitedAt)) existing.invitedAt = r.portal_invited_at
      if (r.portal_last_login_at && (!existing.lastLoginAt || r.portal_last_login_at > existing.lastLoginAt)) existing.lastLoginAt = r.portal_last_login_at
    } else {
      byLogin.set(r.portal_user_id, {
        portalUserId: r.portal_user_id,
        fullName: r.full_name,
        email: r.email,
        customers: [{ id: r.customer_id, name: customerLabel }],
        invitedAt: r.portal_invited_at,
        lastLoginAt: r.portal_last_login_at,
      })
    }
  }
  const accounts = [...byLogin.values()].sort((a, b) => a.fullName.localeCompare(b.fullName))

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Portal Accounts</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Portal Accounts</h1>
        <p className="mt-1 text-sm text-gray-500">
          Every Customer Portal login, and which customers it can access. Deleting a login here
          removes it entirely, across every customer relationship it has -- for revoking access
          to just one customer, use &quot;Revoke Portal Access&quot; on that customer&apos;s page instead.
        </p>
      </div>

      <PortalAccountsClient orgId={org.id} orgSlug={slug} initialAccounts={accounts} />
    </div>
  )
}
