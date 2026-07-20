import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import TransactionsClient from './transactions-client'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[transactions-settings] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (transactions settings)</h1>
        <div>{message}</div>
      </div>
    )
  }
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: orgRow } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', slug)
    .single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <div className="p-8 text-red-600">Not authenticated</div>

  const { data: memberRow } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', org.id)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  const isOwnerOrAdmin = memberRow?.role === 'owner' || memberRow?.role === 'admin'
  if (!isOwnerOrAdmin) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-bold text-gray-900">Transactions</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          Only owners and admins can manage transaction settings. Contact your organization owner.
        </div>
      </div>
    )
  }

  let initialSettings: Record<string, unknown> = {}
  try {
    const { data } = await supabase
      .from('transaction_settings')
      .select('*')
      .eq('organization_id', org.id)
      .maybeSingle()
    if (data) {
      initialSettings = data as Record<string, unknown>
    }
  } catch {
    // table not yet migrated — render with defaults
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Transactions</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Transactions</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure defaults and behavior for quotes, sales orders, invoices, jobs, and customers. Changes save automatically.
        </p>
      </div>

      <TransactionsClient orgId={org.id} orgSlug={slug} initialSettings={initialSettings} />
    </div>
  )
}
