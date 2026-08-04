import { createClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import VendorsListClient from './vendors-list-client'
import type { VendorListRow } from './actions'
import { dbOrThrow, DbError } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'

type PageProps = { params: Promise<{ slug: string }> }

export default async function VendorsPage(props: PageProps) {
  try {
    return await VendorsPageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('vendors-list', err)
  }
}

async function VendorsPageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as OrgRow | null
  if (!org) notFound()

  const [vendorsRes, countRes] = await Promise.all([
    supabase
      .from('vendors')
      .select('id, name, primary_contact, primary_phone, primary_email, city, state, is_active, created_at')
      .eq('organization_id', org.id)
      .order('name', { ascending: true })
      .range(0, 49),

    supabase
      .from('vendors')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id),
  ])

  if (vendorsRes.error) throw new DbError(vendorsRes.error)
  if (countRes.error) throw new DbError(countRes.error)

  const vendors = (vendorsRes.data ?? []) as VendorListRow[]
  const totalCount = countRes.count ?? 0

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
          <span>/</span>
          <a href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</a>
          <span>/</span>
          <span className="text-gray-700">Vendors</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Vendors</h1>
        <p className="mt-1 text-sm text-gray-500">
          {totalCount === 0 ? 'No vendors yet.' : `${totalCount.toLocaleString()} vendor${totalCount === 1 ? '' : 's'}`}
        </p>
      </div>

      <VendorsListClient
        initialRows={vendors}
        totalCount={totalCount}
        orgSlug={slug}
        orgId={org.id}
      />
    </div>
  )
}
