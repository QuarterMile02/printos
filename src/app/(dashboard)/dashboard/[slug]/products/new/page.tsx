import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type {
  ProductCategory, WorkflowTemplate, PricingFormula, Discount,
  Material, LaborRate, MachineRate, Modifier,
} from '@/types/product-builder'
import ProductForm from '../product-form'

type PageProps = { params: Promise<{ slug: string }> }

export default async function NewProductPage({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

  const [
    categoriesRes,
    workflowsRes,
    pricingFormulasRes,
    discountsRes,
    materialsRes,
    laborRatesRes,
    machineRatesRes,
    modifiersRes,
  ] = await Promise.all([
    supabase.from('product_categories').select('*').eq('organization_id', org.id).order('name'),
    supabase.from('workflow_templates').select('*').eq('organization_id', org.id).order('name'),
    supabase.from('pricing_formulas').select('*').or(`organization_id.eq.${org.id},is_system.eq.true`).order('name'),
    supabase.from('discounts').select('*').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('materials').select('id, name, cost, price, selling_units, material_type_id, category_id, active').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('labor_rates').select('id, name, cost, price, units, formula, active').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('machine_rates').select('id, name, cost, price, units, formula, active').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('modifiers').select('*').eq('organization_id', org.id).eq('active', true).order('display_name'),
  ])

  return (
    <div className="p-8">
      <ProductForm
        orgId={org.id}
        orgSlug={slug}
        product={null}
        categories={(categoriesRes.data ?? []) as ProductCategory[]}
        workflows={(workflowsRes.data ?? []) as WorkflowTemplate[]}
        pricingFormulas={(pricingFormulasRes.data ?? []) as PricingFormula[]}
        discounts={(discountsRes.data ?? []) as Discount[]}
        materials={(materialsRes.data ?? []) as Pick<Material, 'id' | 'name' | 'cost' | 'price' | 'selling_units' | 'material_type_id' | 'category_id' | 'active'>[]}
        laborRates={(laborRatesRes.data ?? []) as Pick<LaborRate, 'id' | 'name' | 'cost' | 'price' | 'units' | 'formula' | 'active'>[]}
        machineRates={(machineRatesRes.data ?? []) as Pick<MachineRate, 'id' | 'name' | 'cost' | 'price' | 'units' | 'formula' | 'active'>[]}
        modifiersList={(modifiersRes.data ?? []) as Modifier[]}
        existingDefaultItems={[]}
        existingModifiers={[]}
        existingDropdownMenus={[]}
        existingCustomFields={[]}
      />
    </div>
  )
}
