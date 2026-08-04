import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { dbOrThrow } from '@/lib/db'
import type {
  Product, ProductCategory, WorkflowTemplate, Discount,
  Modifier, ProductDefaultItem, ProductModifier, MaterialCategory,
} from '@/types/product-builder'
import MigrateClient, {
  type ExistingDropdownMenu, type ShopvoxData,
  type MaterialOption, type LaborRateOption, type MachineRateOption,
  type ExistingOptionRate,
} from './migrate-client'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string; id: string }> }

export default async function MigrateProductPage(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[products-migrate] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (products-migrate)</h1>
        <div><strong>Message:</strong> {message}</div>
        {stack && <pre style={{ fontSize: '0.75rem', overflowX: 'auto', marginTop: '1rem' }}>{stack}</pre>}
      </div>
    )
  }
}

async function PageInner({ params }: PageProps) {
  const { slug, id } = await params
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string; slug: string } | null
  if (!org) notFound()

  const { data: productRow } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .eq('organization_id', org.id)
    .maybeSingle() as { data: (Product & { migration_status: string | null; shopvox_data: ShopvoxData | null }) | null; error: unknown }
  if (!productRow) notFound()

  const [
    categoriesRes,
    workflowsRes,
    discountsRes,
    materialsRes,
    materialCategoriesRes,
    laborRatesRes,
    machineRatesRes,
    modifiersRes,
    defaultItemsRes,
    optionRatesRes,
    productModifiersRes,
    dropdownMenusRes,
    dropdownItemsRes,
  ] = await Promise.all([
    supabase.from('product_categories').select('*').eq('organization_id', org.id).order('name'),
    supabase.from('workflow_templates').select('*').eq('organization_id', org.id).order('name'),
    supabase.from('discounts').select('*').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('materials').select('id, name, category_id, multiplier, wastage_markup').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('material_categories').select('id, name').eq('organization_id', org.id).order('name'),
    supabase.from('labor_rates').select('id, name, category, cost, markup').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('machine_rates').select('id, name, category, cost, markup').eq('organization_id', org.id).eq('active', true).order('name'),
    supabase.from('modifiers').select('*').eq('organization_id', org.id).eq('active', true).order('display_name'),
    supabase.from('product_default_items').select('*').eq('product_id', id).order('sort_order'),
    supabase.from('product_option_rates').select('*').eq('product_id', id).order('sort_order'),
    supabase.from('product_modifiers').select('*').eq('product_id', id).order('sort_order'),
    supabase.from('product_dropdown_menus').select('*').eq('product_id', id).order('sort_order'),
    supabase.from('product_dropdown_items').select('*'),
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
      .map((i) => ({
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
    <MigrateClient
      orgId={org.id}
      orgName={org.name}
      orgSlug={slug}
      product={productRow}
      shopvoxData={productRow.shopvox_data ?? null}
      migrationStatus={productRow.migration_status ?? 'shopvox_reference'}
      categories={(categoriesRes.data ?? []) as ProductCategory[]}
      workflows={(workflowsRes.data ?? []) as WorkflowTemplate[]}
      discounts={(discountsRes.data ?? []) as Discount[]}
      materials={(materialsRes.data ?? []) as MaterialOption[]}
      materialCategories={(materialCategoriesRes.data ?? []) as Pick<MaterialCategory, 'id' | 'name'>[]}
      laborRates={(laborRatesRes.data ?? []) as LaborRateOption[]}
      machineRates={(machineRatesRes.data ?? []) as MachineRateOption[]}
      modifiersList={(modifiersRes.data ?? []) as Modifier[]}
      existingDefaultItems={(defaultItemsRes.data ?? []) as ProductDefaultItem[]}
      existingOptionRates={(optionRatesRes.data ?? []) as ExistingOptionRate[]}
      existingModifiers={(productModifiersRes.data ?? []) as ProductModifier[]}
      existingDropdownMenus={existingDropdownMenus}
    />
  )
}
