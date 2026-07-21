import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import AccountingClient, { type Props as ClientProps } from './accounting-client'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[accounting-settings] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (accounting settings)</h1>
        <div>{message}</div>
      </div>
    )
  }
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: orgRow } = await supabase
    .from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <div className="p-8 text-red-600">Not authenticated</div>

  const { data: memberRow } = await supabase
    .from('organization_members').select('role')
    .eq('organization_id', org.id).eq('user_id', user.id).maybeSingle() as { data: { role: string } | null; error: unknown }

  const isOwnerOrAdmin = memberRow?.role === 'owner' || memberRow?.role === 'admin'
  if (!isOwnerOrAdmin) {
    return (
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900">Accounting</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          Only owners and admins can manage accounting settings. Contact your organization owner.
        </div>
      </div>
    )
  }

  const { data: acctSettingsRow } = await supabase.from('accounting_settings').select('*').eq('organization_id', org.id).maybeSingle().catch(() => ({ data: null }))
  const { data: salesTaxes } = await supabase.from('sales_taxes').select('*').eq('organization_id', org.id).order('sort_order').catch(() => ({ data: null }))
  const { data: termCodes } = await supabase.from('term_codes').select('*').eq('organization_id', org.id).order('sort_order').catch(() => ({ data: null }))
  const { data: paymentMethods } = await supabase.from('payment_methods').select('*').eq('organization_id', org.id).order('sort_order').catch(() => ({ data: null }))
  const { data: chartOfAccounts } = await supabase.from('chart_of_accounts').select('*').eq('organization_id', org.id).order('sort_order').catch(() => ({ data: null }))
  const { data: accountMappingRow } = await supabase.from('account_mapping').select('*').eq('organization_id', org.id).maybeSingle().catch(() => ({ data: null }))
  const { data: txNumsRow } = await supabase.from('transaction_numbers').select('*').eq('organization_id', org.id).maybeSingle().catch(() => ({ data: null }))

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Accounting</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Accounting</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure taxes, terms, payment methods, chart of accounts, and QB Desktop integration.
        </p>
      </div>

      <AccountingClient
        orgId={org.id}
        orgSlug={slug}
        initialAcctSettings={(acctSettingsRow ?? {}) as ClientProps['initialAcctSettings']}
        initialSalesTaxes={(salesTaxes ?? []) as ClientProps['initialSalesTaxes']}
        initialTermCodes={(termCodes ?? []) as ClientProps['initialTermCodes']}
        initialPaymentMethods={(paymentMethods ?? []) as ClientProps['initialPaymentMethods']}
        initialChartOfAccounts={(chartOfAccounts ?? []) as ClientProps['initialChartOfAccounts']}
        initialAccountMapping={(accountMappingRow ?? {}) as ClientProps['initialAccountMapping']}
        initialTxNums={(txNumsRow ?? {}) as ClientProps['initialTxNums']}
      />
    </div>
  )
}
