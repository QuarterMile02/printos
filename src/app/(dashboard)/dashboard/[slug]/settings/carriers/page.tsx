import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import CarriersClient, { type CarrierConnectionRow } from './carriers-client'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[carriers-settings] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (carriers settings)</h1>
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
      <div className="p-8 max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900">Carriers</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          Only owners and admins can manage carrier connections. Contact your organization owner.
        </div>
      </div>
    )
  }

  let connections: CarrierConnectionRow[] = []
  try {
    const { data } = await supabase
      .from('carrier_connections')
      .select('carrier, is_connected, credentials, use_test_mode')
      .eq('organization_id', org.id)
    // Never send decrypted (or even encrypted) credential values to the browser --
    // only whether each field already has a saved value, so the form can render a
    // masked placeholder instead of the real secret.
    connections = ((data ?? []) as { carrier: string; is_connected: boolean; credentials: Record<string, string>; use_test_mode: boolean }[])
      .map((row) => ({
        carrier: row.carrier,
        is_connected: row.is_connected,
        use_test_mode: row.use_test_mode,
        savedFields: Object.fromEntries(
          Object.entries(row.credentials ?? {}).map(([key, value]) => [key, Boolean(value)]),
        ),
      }))
  } catch {}

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Carriers</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Carriers</h1>
        <p className="mt-1 text-sm text-gray-500">
          Connect your own carrier accounts for rate quoting and label purchase. Each carrier connects
          independently — nothing here is shared across organizations.
        </p>
      </div>

      <CarriersClient orgId={org.id} orgSlug={slug} initialConnections={connections} />
    </div>
  )
}
