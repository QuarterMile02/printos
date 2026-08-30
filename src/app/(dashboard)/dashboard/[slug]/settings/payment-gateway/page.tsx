import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import PaymentGatewayClient, { type Props as ClientProps } from './payment-gateway-client'

// payment_gateway_settings (per-org, AES-256-GCM encrypted since Session
// 12) is the ONLY source of Authorize.net credentials -- the locked
// franchise decision is that each org configures its own gateway here,
// not via .env. AUTHORIZENET_API_LOGIN_ID/AUTHORIZENET_TRANSACTION_KEY
// env vars (added before this page existed) were removed for exactly
// this reason.
//
// For whoever builds the actual charge route (explicitly deferred, not
// this session): there must be NO env-var fallback when an org hasn't
// configured a gateway here. Unlike EasyPost (acceptable to fall back
// for orgs that haven't connected shipping), a payment-gateway fallback
// means a misconfigured franchise silently charges customer cards onto
// QMI's own merchant account. Missing/incomplete config must fail
// loudly with "gateway not configured" -- never fall back to a
// different org's credentials or a shared env var.

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('payment-gateway-settings', err)
  }
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

  const isOwnerOrAdmin = memberRow?.role === 'owner' || memberRow?.role === 'admin'
  if (!isOwnerOrAdmin) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900">Payment Gateway</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          Only owners and admins can manage payment gateway settings. Contact your organization owner.
        </div>
      </div>
    )
  }

  let settingsRow: {
    gateway_type?: string
    use_test_mode?: boolean
    is_connected?: boolean
    hasApiLoginId?: boolean
    hasTransactionKey?: boolean
  } | null = null
  try {
    const { data } = await supabase.from('payment_gateway_settings').select('*').eq('organization_id', org.id).maybeSingle()
    const row = data as { gateway_type?: string; use_test_mode?: boolean; is_connected?: boolean; api_login_id?: string | null; transaction_key?: string | null } | null
    // Never send the decrypted (or even encrypted) credential values to the browser --
    // only whether each one already has a saved value, so the form can render a masked
    // placeholder instead of the real secret.
    if (row) {
      settingsRow = {
        gateway_type: row.gateway_type,
        use_test_mode: row.use_test_mode,
        is_connected: row.is_connected,
        hasApiLoginId: Boolean(row.api_login_id),
        hasTransactionKey: Boolean(row.transaction_key),
      }
    }
  } catch {}

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Payment Gateway</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Payment Gateway</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure your payment processor for online invoice payments and deposits.
        </p>
      </div>

      <PaymentGatewayClient
        orgId={org.id}
        orgSlug={slug}
        initialSettings={(settingsRow ?? {}) as ClientProps['initialSettings']}
      />
    </div>
  )
}
