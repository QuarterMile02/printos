import { createClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import type {
  Product, ProductCategory, WorkflowTemplate, Discount,
  Modifier, ProductDefaultItem, ProductModifier, MaterialCategory,
} from '@/types/product-builder'
import MigrateClient, {
  type ExistingDropdownMenu, type ShopvoxData,
  type MaterialOption, type LaborRateOption, type MachineRateOption,
  type ExistingOptionRate,
} from './migrate-client'
import type { QuoteModifierInput } from '@/components/products/shopvox-quote-preview'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string; id: string }> }

export default async function MigrateProductPage(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('products-migrate', err)
  }
}

async function PageInner({ params }: PageProps) {
  const { slug, id } = await params
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string; slug: string } | null
  if (!org) notFound()

  const productRow = await dbOrThrow(
    supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .eq('organization_id', org.id)
      .maybeSingle()
  ) as (Product & { migration_status: string | null; shopvox_data: ShopvoxData | null }) | null
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
    quoteModifiersRes,
  ] = await Promise.all([
    dbOrThrow(supabase.from('product_categories').select('*').eq('organization_id', org.id).order('name')),
    dbOrThrow(supabase.from('workflow_templates').select('*').eq('organization_id', org.id).order('name')),
    dbOrThrow(supabase.from('discounts').select('*').eq('organization_id', org.id).eq('active', true).order('name')),
    dbOrThrow(supabase.from('materials').select('id, name, category_id, multiplier, wastage_markup').eq('organization_id', org.id).eq('active', true).order('name')),
    dbOrThrow(supabase.from('material_categories').select('id, name').eq('organization_id', org.id).order('name')),
    dbOrThrow(supabase.from('labor_rates').select('id, name, category, cost, markup').eq('organization_id', org.id).eq('active', true).order('name')),
    dbOrThrow(supabase.from('machine_rates').select('id, name, category, cost, markup').eq('organization_id', org.id).eq('active', true).order('name')),
    dbOrThrow(supabase.from('modifiers').select('*').eq('organization_id', org.id).eq('active', true).order('display_name')),
    dbOrThrow(supabase.from('product_default_items').select('*').eq('product_id', id).order('sort_order')),
    dbOrThrow(supabase.from('product_option_rates').select('*').eq('product_id', id).order('sort_order')),
    dbOrThrow(supabase.from('product_modifiers').select('*').eq('product_id', id).order('sort_order')),
    dbOrThrow(supabase.from('product_dropdown_menus').select('*').eq('product_id', id).order('sort_order')),
    dbOrThrow(supabase.from('product_dropdown_items').select('*')),
    // For Quote Preview -- the product's REAL recipe modifiers, joined to
    // the modifiers catalog for display_name/modifier_type, so Quote
    // Preview can render them as usable inputs (Numeric -> number field,
    // Boolean -> checkbox) seeded from their own Default. Separate from
    // productModifiersRes above, which the right-panel builder UI owns.
    dbOrThrow(
      supabase
        .from('product_modifiers')
        .select('default_value, sort_order, modifiers(id, system_lookup_name, display_name, modifier_type)')
        .eq('product_id', id)
        .order('sort_order')
    ),
  ])

  const menus = (dropdownMenusRes ?? []) as { id: string; menu_name: string; is_optional: boolean | null }[]
  const items = (dropdownItemsRes ?? []) as {
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
  type QuoteModifierRow = {
    default_value: string | null
    modifiers: { id: string; system_lookup_name: string | null; display_name: string; modifier_type: string } | { id: string; system_lookup_name: string | null; display_name: string; modifier_type: string }[] | null
  }
  const productModifiers: QuoteModifierInput[] = ((quoteModifiersRes ?? []) as QuoteModifierRow[])
    .map((r) => {
      const mod = Array.isArray(r.modifiers) ? r.modifiers[0] : r.modifiers
      if (!mod) return null
      return {
        id: mod.id,
        system_lookup_name: mod.system_lookup_name,
        display_name: mod.display_name,
        modifier_type: mod.modifier_type,
        default_value: r.default_value,
      }
    })
    .filter((m): m is QuoteModifierInput => m !== null)

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
      categories={(categoriesRes ?? []) as ProductCategory[]}
      workflows={(workflowsRes ?? []) as WorkflowTemplate[]}
      discounts={(discountsRes ?? []) as Discount[]}
      materials={(materialsRes ?? []) as MaterialOption[]}
      materialCategories={(materialCategoriesRes ?? []) as Pick<MaterialCategory, 'id' | 'name'>[]}
      laborRates={(laborRatesRes ?? []) as LaborRateOption[]}
      machineRates={(machineRatesRes ?? []) as MachineRateOption[]}
      modifiersList={(modifiersRes ?? []) as Modifier[]}
      existingDefaultItems={(defaultItemsRes ?? []) as ProductDefaultItem[]}
      existingOptionRates={(optionRatesRes ?? []) as ExistingOptionRate[]}
      existingModifiers={(productModifiersRes ?? []) as ProductModifier[]}
      existingDropdownMenus={existingDropdownMenus}
      productModifiers={productModifiers}
    />
  )
}
