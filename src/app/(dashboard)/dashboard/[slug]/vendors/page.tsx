import { createClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import CreateVendorForm from './create-vendor-form'
import VendorsListClient from './vendors-list-client'
import { VENDORS_PAGE_SIZE } from './constants'
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

  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? ''

  const [vendorsRes, countRes, memberRows] = await Promise.all([
    supabase
      .from('vendors')
      .select('id, name, primary_contact, primary_phone, primary_email, city, state, is_active, created_at')
      .eq('organization_id', org.id)
      .order('name', { ascending: true })
      .limit(VENDORS_PAGE_SIZE),

    supabase
      .from('vendors')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id),

    supabase
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', org.id),
  ])

  if (vendorsRes.error) throw new DbError(vendorsRes.error)
  if (countRes.error) throw new DbError(countRes.error)
  if (memberRows.error) throw new DbError(memberRows.error)

  const vendors = (vendorsRes.data ?? []) as VendorListRow[]
  const totalCount = countRes.count ?? 0

  // Derive current user's role — needed by useSavedView (My/Shared views split)
  type MemberRow = { user_id: string; role: string }
  const userRole = ((memberRows.data ?? []) as MemberRow[]).find((m) => m.user_id === userId)?.role ?? 'member'

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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-qm-black">Vendors</h1>
            <p className="mt-1 text-sm text-gray-500">
              {totalCount === 0 ? 'No vendors yet.' : `${totalCount.toLocaleString()} vendor${totalCount === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CreateVendorForm orgId={org.id} orgSlug={org.slug} />
          </div>
        </div>
      </div>

      <VendorsListClient
        initialRows={vendors}
        initialTotalCount={totalCount}
        orgSlug={slug}
        orgId={org.id}
        userId={userId}
        userRole={userRole}
      />
    </div>
  )
}
