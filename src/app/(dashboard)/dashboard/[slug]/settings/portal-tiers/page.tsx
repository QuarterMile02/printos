import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PortalTiersClient from './PortalTiersClient'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function PortalTiersPage({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  type OrgRow = { id: string; name: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }
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
