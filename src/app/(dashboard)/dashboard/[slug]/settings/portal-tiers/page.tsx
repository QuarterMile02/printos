import { createClient } from '@/lib/supabase/server'
import { redirect, unstable_rethrow } from 'next/navigation'
import { dbOrThrow } from '@/lib/db'
import PortalTiersClient from './PortalTiersClient'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function PortalTiersPage(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[portal-tiers] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (portal-tiers)</h1>
        <div><strong>Message:</strong> {message}</div>
        {stack && <pre style={{ fontSize: '0.75rem', overflowX: 'auto', marginTop: '1rem' }}>{stack}</pre>}
      </div>
    )
  }
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  type OrgRow = { id: string; name: string }
  const org = await dbOrThrow(
    supabase
      .from('organizations')
      .select('id, name')
      .eq('slug', slug)
      .maybeSingle()
  ) as OrgRow | null
  if (!org) redirect('/login')

  type ProductTypeRow = { id: string; name: string; sort_order: number | null }
  const { data: productTypeRows } = await supabase
    .from('product_types')
    .select('id, name, sort_order')
    .eq('organization_id', org.id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true }) as { data: ProductTypeRow[] | null; error: unknown }

  return (
    <PortalTiersClient
      slug={slug}
      productTypes={(productTypeRows ?? []).map((pt) => pt.name)}
    />
  )
}
