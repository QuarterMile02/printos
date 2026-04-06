import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type {
  Product, ProductCategory, WorkflowTemplate, PricingFormula, Discount,
  Material, LaborRate, MachineRate, Modifier,
  ProductDefaultItem, ProductModifier, ProductDropdownMenu, ProductDropdownItem,
} from '@/types/product-builder'
import ProductForm, { type ExistingDropdownMenu } from '../product-form'

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

  const { data: product } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .eq('organization_id', org.id)
    .maybeSingle() as { data: Product | null; error: unknown }

  if (!product) notFound()

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
  ] = await Promise.all([
    supabase.from('product_categories').select('*').eq('organization_id', org.id).order('name'),
    supabase.from('workflow_templates').select('*').eq('organization_id', org.id).order('name'),
    supabase.from('pricing_formulas').select('*').or(`organization_id.eq.${org.id},is_system.eq.true`).order('name'),
    supabase.from('discounts').select('*').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('materials').select('id, name, cost, price, selling_units, material_type_id, category_id, active').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('labor_rates').select('id, name, cost, price, units, formula, active').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('machine_rates').select('id, name, cost, price, units, formula, active').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('modifiers').select('*').eq('organization_id', org.id).eq('active', true).order('display_name'),
    supabase.from('product_default_items').select('*').eq('product_id', id).eq('organization_id', org.id).order('sort_order'),
    supabase.from('product_modifiers').select('*').eq('product_id', id).eq('organization_id', org.id).order('sort_order'),
    supabase.from('product_dropdown_menus').select('*').eq('product_id', id).eq('organization_id', org.id).order('sort_order'),
  ])

  const categories = (categoriesRes.data ?? []) as ProductCategory[]
  const workflows = (workflowsRes.data ?? []) as WorkflowTemplate[]
  const pricingFormulas = (pricingFormulasRes.data ?? []) as PricingFormula[]
  const discounts = (discountsRes.data ?? []) as Discount[]
  const materials = (materialsRes.data ?? []) as Pick<Material, 'id' | 'name' | 'cost' | 'price' | 'selling_units' | 'material_type_id' | 'category_id' | 'active'>[]
  const laborRates = (laborRatesRes.data ?? []) as Pick<LaborRate, 'id' | 'name' | 'cost' | 'price' | 'units' | 'formula' | 'active'>[]
  const machineRates = (machineRatesRes.data ?? []) as Pick<MachineRate, 'id' | 'name' | 'cost' | 'price' | 'units' | 'formula' | 'active'>[]
  const modifiers = (modifiersRes.data ?? []) as Modifier[]
  const defaultItems = (defaultItemsRes.data ?? []) as ProductDefaultItem[]
  const productModifiers = (productModifiersRes.data ?? []) as ProductModifier[]
  const dropdownMenus = (dropdownMenusRes.data ?? []) as ProductDropdownMenu[]

  // Fetch dropdown items for all the menus in one query
  const menuIds = dropdownMenus.map((m) => m.id)
  let dropdownItems: ProductDropdownItem[] = []
  if (menuIds.length > 0) {
    const { data } = await supabase
      .from('product_dropdown_items')
      .select('*')
      .in('dropdown_menu_id', menuIds)
      .order('sort_order')
    dropdownItems = (data ?? []) as ProductDropdownItem[]
  }

  // Group items by menu
  const existingDropdownMenus: ExistingDropdownMenu[] = dropdownMenus.map((menu) => ({
    menu_name: menu.menu_name,
    is_optional: menu.is_optional ?? false,
    items: dropdownItems
      .filter((i) => i.dropdown_menu_id === menu.id)
      .map((i) => ({
        item_type: (i.item_type as 'Material' | 'LaborRate' | 'MachineRate') ?? 'Material',
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
        product={product}
        categories={categories}
        workflows={workflows}
        pricingFormulas={pricingFormulas}
        discounts={discounts}
        materials={materials}
        laborRates={laborRates}
        machineRates={machineRates}
        modifiersList={modifiers}
        existingDefaultItems={defaultItems}
        existingModifiers={productModifiers}
        existingDropdownMenus={existingDropdownMenus}
      />
    </div>
  )
}
