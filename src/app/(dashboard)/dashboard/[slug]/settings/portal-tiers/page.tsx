import { createClient } from '@/lib/supabase/server'
import { redirect, unstable_rethrow } from 'next/navigation'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import PortalTiersClient from './PortalTiersClient'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function PortalTiersPage(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('portal-tiers', err)
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
  const productTypeRows = await dbOrThrow(
    supabase
      .from('product_types')
      .select('id, name, sort_order')
      .eq('organization_id', org.id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
  ) as ProductTypeRow[] | null

  return (
    <PortalTiersClient
      slug={slug}
      productTypes={(productTypeRows ?? []).map((pt) => pt.name)}
    />
  )
}
