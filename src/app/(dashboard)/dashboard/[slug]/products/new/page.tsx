import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { dbOrThrow } from '@/lib/db'
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
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[products-new] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (products-new)</h1>
        <div><strong>Message:</strong> {message}</div>
        {stack && <pre style={{ fontSize: '0.75rem', overflowX: 'auto', marginTop: '1rem' }}>{stack}</pre>}
      </div>
    )
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
    supabase.from('product_categories').select('*').eq('organization_id', org.id).order('name'),
    supabase.from('product_types').select('id, name, sort_order').eq('organization_id', org.id).eq('is_active', true).order('sort_order', { ascending: true }),
    supabase.from('workflow_templates').select('*').eq('organization_id', org.id).order('name'),
    supabase.from('discounts').select('*').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('materials').select('id, name, cost, price, selling_units, material_type_id, category_id, active').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('labor_rates').select('id, name, cost, price, units, formula, active').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('machine_rates').select('id, name, cost, price, units, formula, active').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('modifiers').select('*').eq('organization_id', org.id).eq('active', true).order('display_name'),
    supabase.from('products').select('secondary_category').eq('organization_id', org.id).not('secondary_category', 'is', null),
  ])

  const secondaryCategoryOptions = Array.from(
    new Set(((secondaryCategoriesRes.data ?? []) as { secondary_category: string | null }[])
      .map((r) => r.secondary_category)
      .filter((v): v is string => Boolean(v && v.trim())))
  ).sort((a, b) => a.localeCompare(b))

  return (
    <div className="p-8">
      <ProductForm
        orgId={org.id}
        orgSlug={slug}
        product={null}
        productTypes={(productTypesRes.data ?? []) as { id: string; name: string; sort_order: number }[]}
        categories={(categoriesRes.data ?? []) as ProductCategory[]}
        workflows={(workflowsRes.data ?? []) as WorkflowTemplate[]}
        discounts={(discountsRes.data ?? []) as Discount[]}
        materials={(materialsRes.data ?? []) as Pick<Material, 'id' | 'name' | 'cost' | 'price' | 'selling_units' | 'material_type_id' | 'category_id' | 'active'>[]}
        laborRates={(laborRatesRes.data ?? []) as Pick<LaborRate, 'id' | 'name' | 'cost' | 'price' | 'units' | 'formula' | 'active'>[]}
        machineRates={(machineRatesRes.data ?? []) as Pick<MachineRate, 'id' | 'name' | 'cost' | 'price' | 'units' | 'formula' | 'active'>[]}
        modifiersList={(modifiersRes.data ?? []) as Modifier[]}
        existingDefaultItems={[]}
        existingModifiers={[]}
        existingDropdownMenus={[]}
        existingCustomFields={[]}
        secondaryCategoryOptions={secondaryCategoryOptions}
      />
    </div>
  )
}
