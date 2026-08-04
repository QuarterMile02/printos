import { createClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import type {
  ProductCategory, WorkflowTemplate, Discount,
  Material, LaborRate, MachineRate, Modifier,
} from '@/types/product-builder'
import ProductForm from '../product-form'

type PageProps = { params: Promise<{ slug: string }> }

export default async function NewProductPage(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('products-new', err)
  }
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as OrgRow | null

  if (!org) notFound()

  const [
    categoriesRes,
    productTypesRes,
    workflowsRes,
    discountsRes,
    materialsRes,
    laborRatesRes,
    machineRatesRes,
    modifiersRes,
    secondaryCategoriesRes,
  ] = await Promise.all([
    dbOrThrow(supabase.from('product_categories').select('*').eq('organization_id', org.id).order('name')),
    dbOrThrow(supabase.from('product_types').select('id, name, sort_order').eq('organization_id', org.id).eq('is_active', true).order('sort_order', { ascending: true })),
    dbOrThrow(supabase.from('workflow_templates').select('*').eq('organization_id', org.id).order('name')),
    dbOrThrow(supabase.from('discounts').select('*').eq('organization_id', org.id).eq('active', true).order('name')),
    dbOrThrow(supabase.from('materials').select('id, name, cost, price, selling_units, material_type_id, category_id, active').eq('organization_id', org.id).eq('active', true).order('name')),
    dbOrThrow(supabase.from('labor_rates').select('id, name, cost, price, units, formula, active').eq('organization_id', org.id).eq('active', true).order('name')),
    dbOrThrow(supabase.from('machine_rates').select('id, name, cost, price, units, formula, active').eq('organization_id', org.id).eq('active', true).order('name')),
    dbOrThrow(supabase.from('modifiers').select('*').eq('organization_id', org.id).eq('active', true).order('display_name')),
    dbOrThrow(supabase.from('products').select('secondary_category').eq('organization_id', org.id).not('secondary_category', 'is', null)),
  ])

  const secondaryCategoryOptions = Array.from(
    new Set(((secondaryCategoriesRes ?? []) as { secondary_category: string | null }[])
      .map((r) => r.secondary_category)
      .filter((v): v is string => Boolean(v && v.trim())))
  ).sort((a, b) => a.localeCompare(b))

  return (
    <div className="p-8">
      <ProductForm
        orgId={org.id}
        orgSlug={slug}
        product={null}
        productTypes={(productTypesRes ?? []) as { id: string; name: string; sort_order: number }[]}
        categories={(categoriesRes ?? []) as ProductCategory[]}
        workflows={(workflowsRes ?? []) as WorkflowTemplate[]}
        discounts={(discountsRes ?? []) as Discount[]}
        materials={(materialsRes ?? []) as Pick<Material, 'id' | 'name' | 'cost' | 'price' | 'selling_units' | 'material_type_id' | 'category_id' | 'active'>[]}
        laborRates={(laborRatesRes ?? []) as Pick<LaborRate, 'id' | 'name' | 'cost' | 'price' | 'units' | 'formula' | 'active'>[]}
        machineRates={(machineRatesRes ?? []) as Pick<MachineRate, 'id' | 'name' | 'cost' | 'price' | 'units' | 'formula' | 'active'>[]}
        modifiersList={(modifiersRes ?? []) as Modifier[]}
        existingDefaultItems={[]}
        existingModifiers={[]}
        existingDropdownMenus={[]}
        existingCustomFields={[]}
        secondaryCategoryOptions={secondaryCategoryOptions}
      />
    </div>
  )
}
