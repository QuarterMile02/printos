import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { Material, MaterialType, MaterialCategory, MaterialVendor, Discount } from '@/types/product-builder'
import MaterialsClient from './materials-client'

type PageProps = { params: Promise<{ slug: string }> }

export default async function MaterialsPage({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

  const { data: materials } = await supabase
    .from('materials')
    .select('*')
    .eq('organization_id', org.id)
    .order('name', { ascending: true }) as { data: Material[] | null; error: unknown }

  const { data: materialTypes } = await supabase
    .from('material_types')
    .select('id, organization_id, name, created_at, created_by, updated_at')
    .eq('organization_id', org.id)
    .order('name') as { data: MaterialType[] | null; error: unknown }

  const { data: materialCategories } = await supabase
    .from('material_categories')
    .select('id, organization_id, name, material_type_id, created_at, updated_at')
    .eq('organization_id', org.id)
    .order('name') as { data: MaterialCategory[] | null; error: unknown }

  const { data: discounts } = await supabase
    .from('discounts')
    .select('id, name, discount_type, applies_to, discount_by, active')
    .eq('organization_id', org.id)
    .order('name') as { data: Pick<Discount, 'id' | 'name' | 'discount_type' | 'applies_to' | 'discount_by' | 'active'>[] | null; error: unknown }

  const materialIds = (materials ?? []).map((m) => m.id)
  const vendorsByMaterial: Record<string, MaterialVendor[]> = {}
  if (materialIds.length > 0) {
    const { data: vendors } = await supabase
      .from('material_vendors')
      .select('*')
      .eq('organization_id', org.id)
      .in('material_id', materialIds)
      .order('rank', { ascending: true }) as { data: MaterialVendor[] | null; error: unknown }

    for (const v of vendors ?? []) {
      if (!v.material_id) continue
      if (!vendorsByMaterial[v.material_id]) vendorsByMaterial[v.material_id] = []
      vendorsByMaterial[v.material_id].push(v)
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
          <span>/</span>
          <a href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</a>
          <span>/</span>
          <span className="text-gray-500">Settings</span>
          <span>/</span>
          <span className="text-gray-700">Materials</span>
        </div>
      </div>

      <MaterialsClient
        orgId={org.id}
        orgSlug={slug}
        initialMaterials={materials ?? []}
        materialTypes={materialTypes ?? []}
        materialCategories={materialCategories ?? []}
        discounts={discounts ?? []}
        vendorsByMaterial={vendorsByMaterial}
      />
    </div>
  )
}
