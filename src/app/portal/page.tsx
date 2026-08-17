import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { portalSignOut } from './actions'

// Minimum landing page proving the session works end to end (build plan
// rev. 2, step 3). No real portal UI yet -- that's a later, separate phase.
export default async function PortalHomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/portal/login')

  // No RLS policy lets a portal contact read customer_contacts yet (step 6
  // is deliberately deferred) -- service client, scoped to this session's
  // OWN uid only, same pattern as portalSignIn's post-login check.
  const service = createServiceClient()
  const { data: rows } = await service
    .from('customer_contacts')
    .select('id, full_name, customer_id, customers ( company_name, first_name, last_name )')
    .eq('portal_user_id', user.id) as {
      data: { id: string; full_name: string; customer_id: string; customers: { company_name: string | null; first_name: string; last_name: string } | null }[] | null
    }

  if (!rows || rows.length === 0) {
    // A session exists but isn't a portal contact (shouldn't happen --
    // portalSignIn already guards this — but defends against a stale
    // session from before an account was fully unlinked/deleted).
    await supabase.auth.signOut()
    redirect('/portal/login?error=' + encodeURIComponent('This login is not associated with a Customer Portal account.'))
  }

  const name = rows[0].full_name
  const customerLabels = rows.map((r) =>
    r.customers?.company_name?.trim()
    || `${r.customers?.first_name ?? ''} ${r.customers?.last_name ?? ''}`.trim()
    || 'Unnamed account'
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-qm-surface">
      <div className="w-full max-w-md space-y-6 rounded-xl bg-white p-8 shadow-sm border border-gray-200">
        <div>
          <h1 className="text-2xl font-extrabold uppercase text-qm-black">Customer <span className="text-qm-lime">Portal</span></h1>
          <p className="mt-1 text-sm text-qm-gray">Logged in as <span className="font-semibold text-qm-black">{name}</span></p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-qm-gray mb-2">
            You have access to {customerLabels.length === 1 ? 'this account' : `${customerLabels.length} accounts`}
          </p>
          <ul className="space-y-1">
            {customerLabels.map((label, i) => (
              <li key={rows[i].id} className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-qm-black">{label}</li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-qm-gray">
          Quotes, orders, invoices, and payments aren&apos;t viewable here yet — that&apos;s coming in a later update.
        </p>

        <form action={portalSignOut}>
          <button
            type="submit"
            className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-qm-black hover:bg-gray-50"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  )
}
