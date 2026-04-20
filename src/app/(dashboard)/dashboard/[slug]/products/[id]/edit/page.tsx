import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type {
  Product, ProductCategory, WorkflowTemplate, PricingFormula, Discount,
  Material, LaborRate, MachineRate, Modifier,
  ProductDefaultItem, ProductModifier, ProductCustomField,
} from '@/types/product-builder'
import ProductForm, { type ExistingDropdownMenu } from '../../product-form'
import type { DropdownItemInput } from '../../actions'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string; id: string }> }

export default async function EditProductPage({ params }: PageProps) {
  const { slug, id } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

  const { data: productRow } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .eq('organization_id', org.id)
    .maybeSingle() as { data: Product | null; error: unknown }

  if (!productRow) notFound()

  const [
    categoriesRes,
    workflowsRes,
    pricingFormulasRes,
    discountsRes,
    materialsRes,
    laborRatesRes,
    machineRatesRes,
    modifiersRes,
    defaultItemsRes,
    productModifiersRes,
    dropdownMenusRes,
    dropdownItemsRes,
    customFieldsRes,
  ] = await Promise.all([
    supabase.from('product_categories').select('*').eq('organization_id', org.id).order('name'),
    supabase.from('workflow_templates').select('*').eq('organization_id', org.id).order('name'),
    supabase.from('pricing_formulas').select('*').or(`organization_id.eq.${org.id},is_system.eq.true`).order('name'),
    supabase.from('discounts').select('*').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('materials').select('id, name, cost, price, selling_units, material_type_id, category_id, active').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('labor_rates').select('id, name, cost, price, units, formula, active').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('machine_rates').select('id, name, cost, price, units, formula, active').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('modifiers').select('*').eq('organization_id', org.id).eq('active', true).order('display_name'),
    supabase.from('product_default_items').select('*').eq('product_id', id).order('sort_order'),
    supabase.from('product_modifiers').select('*').eq('product_id', id).order('sort_order'),
    supabase.from('product_dropdown_menus').select('*').eq('product_id', id).order('sort_order'),
    supabase.from('product_dropdown_items').select('*'),
    supabase.from('product_custom_fields').select('*').eq('product_id', id).order('sort_order'),
  ])

  const menus = (dropdownMenusRes.data ?? []) as { id: string; menu_name: string; is_optional: boolean | null }[]
  const items = (dropdownItemsRes.data ?? []) as {
    dropdown_menu_id: string | null
    item_type: 'Material' | 'LaborRate' | 'MachineRate' | null
    material_id: string | null
    labor_rate_id: string | null
    machine_rate_id: string | null
    system_formula: string | null
    charge_per_li_unit: boolean | null
    is_optional: boolean | null
    sort_order: number | null
  }[]
  const existingDropdownMenus: ExistingDropdownMenu[] = menus.map((m) => ({
    menu_name: m.menu_name,
    is_optional: m.is_optional ?? false,
    items: items
      .filter((i) => i.dropdown_menu_id === m.id && i.item_type)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map<DropdownItemInput>((i) => ({
        item_type: i.item_type as 'Material' | 'LaborRate' | 'MachineRate',
        material_id: i.material_id,
        labor_rate_id: i.labor_rate_id,
        machine_rate_id: i.machine_rate_id,
        system_formula: i.system_formula,
        charge_per_li_unit: i.charge_per_li_unit ?? false,
        is_optional: i.is_optional ?? false,
      })),
  }))

  return (
    <div className="p-8">
      <ProductForm
        orgId={org.id}
        orgSlug={slug}
        product={productRow}
        categories={(categoriesRes.data ?? []) as ProductCategory[]}
        workflows={(workflowsRes.data ?? []) as WorkflowTemplate[]}
        pricingFormulas={(pricingFormulasRes.data ?? []) as PricingFormula[]}
        discounts={(discountsRes.data ?? []) as Discount[]}
        materials={(materialsRes.data ?? []) as Pick<Material, 'id' | 'name' | 'cost' | 'price' | 'selling_units' | 'material_type_id' | 'category_id' | 'active'>[]}
        laborRates={(laborRatesRes.data ?? []) as Pick<LaborRate, 'id' | 'name' | 'cost' | 'price' | 'units' | 'formula' | 'active'>[]}
        machineRates={(machineRatesRes.data ?? []) as Pick<MachineRate, 'id' | 'name' | 'cost' | 'price' | 'units' | 'formula' | 'active'>[]}
        modifiersList={(modifiersRes.data ?? []) as Modifier[]}
        existingDefaultItems={(defaultItemsRes.data ?? []) as ProductDefaultItem[]}
        existingModifiers={(productModifiersRes.data ?? []) as ProductModifier[]}
        existingDropdownMenus={existingDropdownMenus}
        existingCustomFields={(customFieldsRes.data ?? []) as ProductCustomField[]}
      />
    </div>
  )
}
