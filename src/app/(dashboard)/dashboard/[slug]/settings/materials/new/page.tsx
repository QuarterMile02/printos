import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import MaterialForm from '../material-form'
import { checkPermission } from '@/lib/check-permission'

export const dynamic = 'force-dynamic'

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { allowed: canEditInventory } = await checkPermission(org.id, 'materials.edit_inventory')

  const [typesRes, catsRes, dRes] = await Promise.all([
    supabase
      .from('material_types')
      .select('id, name')
      .eq('organization_id', org.id)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('material_categories')
      .select('id, name')
      .eq('organization_id', org.id)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('discounts')
      .select('id, name')
      .eq('organization_id', org.id)
      .order('name'),
  ])
  const materialTypes = (typesRes.data ?? []) as { id: string; name: string }[]
  const materialCategories = (catsRes.data ?? []) as { id: string; name: string }[]
  const discounts = (dRes.data ?? []) as { id: string; name: string }[]

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/settings/materials`} className="hover:text-gray-700">Materials</Link>
        <span>/</span>
        <span className="text-gray-700">New</span>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Material</h1>

      {sp.error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {decodeURIComponent(sp.error)}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <MaterialForm
          material={null}
          orgId={org.id}
          orgSlug={slug}
          canEditInventory={canEditInventory}
          materialTypes={materialTypes}
          materialCategories={materialCategories}
          discounts={discounts}
        />
      </div>
    </div>
  )
}
