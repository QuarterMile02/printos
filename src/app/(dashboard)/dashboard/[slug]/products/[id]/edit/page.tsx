import { createClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import { dbOrThrow } from '@/lib/db'
import type {
  Product, ProductCategory, WorkflowTemplate, Discount,
  Material, LaborRate, MachineRate, Modifier,
  ProductDefaultItem, ProductModifier, ProductCustomField,
} from '@/types/product-builder'
import ProductForm, { type ExistingDropdownMenu } from '../../product-form'
import type { DropdownItemInput } from '../../actions'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string; id: string }> }

export default async function EditProductPage(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[products-edit] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (products-edit)</h1>
        <div><strong>Message:</strong> {message}</div>
        {stack && <pre style={{ fontSize: '0.75rem', overflowX: 'auto', marginTop: '1rem' }}>{stack}</pre>}
      </div>
    )
  }
}

async function PageInner({ params }: PageProps) {
  const { slug, id } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as OrgRow | null

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
    productTypesRes,
    workflowsRes,
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
    supabase.from('product_default_items').select('*').eq('product_id', id).order('sort_order'),
    supabase.from('product_modifiers').select('*').eq('product_id', id).order('sort_order'),
    supabase.from('product_dropdown_menus').select('*').eq('product_id', id).order('sort_order'),
    supabase.from('product_dropdown_items').select('*'),
    supabase.from('product_custom_fields').select('*').eq('product_id', id).order('sort_order'),
    supabase.from('products').select('secondary_category').eq('organization_id', org.id).not('secondary_category', 'is', null),
  ])

  const secondaryCategoryOptions = Array.from(
    new Set(((secondaryCategoriesRes.data ?? []) as { secondary_category: string | null }[])
      .map((r) => r.secondary_category)
      .filter((v): v is string => Boolean(v && v.trim())))
  ).sort((a, b) => a.localeCompare(b))

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
        productTypes={(productTypesRes.data ?? []) as { id: string; name: string; sort_order: number }[]}
        categories={(categoriesRes.data ?? []) as ProductCategory[]}
        workflows={(workflowsRes.data ?? []) as WorkflowTemplate[]}
        discounts={(discountsRes.data ?? []) as Discount[]}
        materials={(materialsRes.data ?? []) as Pick<Material, 'id' | 'name' | 'cost' | 'price' | 'selling_units' | 'material_type_id' | 'category_id' | 'active'>[]}
        laborRates={(laborRatesRes.data ?? []) as Pick<LaborRate, 'id' | 'name' | 'cost' | 'price' | 'units' | 'formula' | 'active'>[]}
        machineRates={(machineRatesRes.data ?? []) as Pick<MachineRate, 'id' | 'name' | 'cost' | 'price' | 'units' | 'formula' | 'active'>[]}
        modifiersList={(modifiersRes.data ?? []) as Modifier[]}
        existingDefaultItems={(defaultItemsRes.data ?? []) as ProductDefaultItem[]}
        existingModifiers={(productModifiersRes.data ?? []) as ProductModifier[]}
        existingDropdownMenus={existingDropdownMenus}
        existingCustomFields={(customFieldsRes.data ?? []) as ProductCustomField[]}
        secondaryCategoryOptions={secondaryCategoryOptions}
      />
    </div>
  )
}
