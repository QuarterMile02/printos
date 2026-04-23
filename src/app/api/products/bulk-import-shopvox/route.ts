import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export const dynamic = 'force-dynamic'

type ShopvoxModifier = { name: string; type: string; default?: unknown }
type ShopvoxDropdown = { name: string; kind?: string; category?: string | null; optional?: boolean | null }
type ShopvoxDefaultItem = {
  name: string
  kind: 'Material' | 'LaborRate' | 'MachineRate'
  formula?: string | null
  multiplier?: number | null
  per_li?: boolean | null
  modifier?: { kind: string; expression: string } | null
}
type ShopvoxData = {
  modifiers?: ShopvoxModifier[]
  dropdown_menus?: ShopvoxDropdown[]
  default_items?: ShopvoxDefaultItem[]
}
type ProductRow = {
  id: string
  name: string
  shopvox_data: ShopvoxData | null
  migration_status: string | null
}

type ErrorEntry = { id: string; name: string; error: string }

function nonEmpty<T>(a: T[] | undefined | null): a is T[] {
  return Array.isArray(a) && a.length > 0
}

function hasRealRecipeData(sv: ShopvoxData | null): boolean {
  if (!sv) return false
  return nonEmpty(sv.modifiers) || nonEmpty(sv.dropdown_menus) || nonEmpty(sv.default_items)
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { organization_id?: string }
    const orgId = body.organization_id
    if (!orgId) {
      return NextResponse.json({ error: 'organization_id is required' }, { status: 400 })
    }

    // Auth: require membership + non-viewer role.
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle()
    const role = (membership as { role: string } | null)?.role
    if (!role || role === 'viewer') {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    const { data: orgRow } = await supabase.from('organizations').select('slug').eq('id', orgId).single()
    const orgSlug = (orgRow as { slug: string } | null)?.slug ?? null

    const service = createServiceClient()

    // Pull eligible products — has shopvox_data, not already printos_ready.
    const { data: productRows, error: prodErr } = await service
      .from('products')
      .select('id, name, shopvox_data, migration_status')
      .eq('organization_id', orgId)
      .not('shopvox_data', 'is', null)
      .neq('migration_status', 'printos_ready')
    if (prodErr) throw new Error(`products: ${prodErr.message}`)
    const products = (productRows ?? []) as ProductRow[]

    // Load name catalogs for the org — build lowercase-name lookups.
    const [modsRes, matsRes, laborRes, machineRes] = await Promise.all([
      service.from('modifiers').select('id, display_name, system_lookup_name, name').eq('organization_id', orgId),
      service.from('materials').select('id, name, category_id, multiplier').eq('organization_id', orgId),
      service.from('labor_rates').select('id, name, category').eq('organization_id', orgId),
      service.from('machine_rates').select('id, name, category').eq('organization_id', orgId),
    ])
    if (modsRes.error) throw new Error(`modifiers: ${modsRes.error.message}`)
    if (matsRes.error) throw new Error(`materials: ${matsRes.error.message}`)
    if (laborRes.error) throw new Error(`labor_rates: ${laborRes.error.message}`)
    if (machineRes.error) throw new Error(`machine_rates: ${machineRes.error.message}`)

    const lc = (s: string | null | undefined) => (s ?? '').toLowerCase().trim()
    const modifierByName = new Map<string, { id: string }>()
    for (const m of ((modsRes.data ?? []) as { id: string; display_name: string | null; system_lookup_name: string | null; name: string | null }[])) {
      const keys = [m.system_lookup_name, m.display_name, m.name].filter(Boolean).map((s) => lc(s))
      for (const k of keys) if (!modifierByName.has(k)) modifierByName.set(k, { id: m.id })
    }
    const materialByName = new Map<string, { id: string; category_id: string | null; multiplier: number | null }>()
    for (const m of ((matsRes.data ?? []) as { id: string; name: string; category_id: string | null; multiplier: number | null }[])) {
      materialByName.set(lc(m.name), { id: m.id, category_id: m.category_id, multiplier: m.multiplier })
    }
    const laborByName = new Map<string, { id: string; category: string | null }>()
    for (const l of ((laborRes.data ?? []) as { id: string; name: string; category: string | null }[])) {
      laborByName.set(lc(l.name), { id: l.id, category: l.category })
    }
    const machineByName = new Map<string, { id: string; category: string | null }>()
    for (const m of ((machineRes.data ?? []) as { id: string; name: string; category: string | null }[])) {
      machineByName.set(lc(m.name), { id: m.id, category: m.category })
    }

    let processed = 0
    let skipped = 0
    const errors: ErrorEntry[] = []

    // Process each product sequentially so a partial failure doesn't cascade.
    for (const p of products) {
      if (!hasRealRecipeData(p.shopvox_data)) {
        skipped++
        continue
      }
      const sv = p.shopvox_data as ShopvoxData

      try {
        // 1. product_modifiers rows — match by name against the catalog.
        const modifierRows: Array<{
          organization_id: string; product_id: string; modifier_id: string
          is_required: boolean; default_value: string | null; sort_order: number
        }> = []
        const seenMods = new Set<string>()
        for (const m of (sv.modifiers ?? [])) {
          const match = modifierByName.get(lc(m.name))
          if (!match || seenMods.has(match.id)) continue
          seenMods.add(match.id)
          modifierRows.push({
            organization_id: orgId,
            product_id: p.id,
            modifier_id: match.id,
            is_required: false,
            default_value: m.default != null ? String(m.default) : null,
            sort_order: modifierRows.length,
          })
        }

        // 2. product_default_items — ALL items (Material + LaborRate +
        //    MachineRate) regardless of catalog match. FK columns are set
        //    when a name match exists, custom_item_name preserves the
        //    source ShopVOX name on every row.
        //    Labor/machine ALSO write to product_option_rates so the
        //    per-product migrate UI's labor/machine sections stay populated.
        const defaultItemRows: Array<Record<string, unknown>> = []
        const optionRateRows: Array<Record<string, unknown>> = []
        const seenLabor = new Set<string>()
        const seenMachine = new Set<string>()
        for (const it of (sv.default_items ?? [])) {
          const key = lc(it.name)
          if (it.kind === 'Material') {
            const match = materialByName.get(key)
            defaultItemRows.push({
              organization_id: orgId,
              product_id: p.id,
              item_type: 'Material',
              material_id: match?.id ?? null,
              labor_rate_id: null,
              machine_rate_id: null,
              custom_item_name: it.name ?? null,
              menu_name: null,
              system_formula: it.formula ?? null,
              charge_per_li_unit: !!it.per_li,
              include_in_base_price: true,
              is_optional: false,
              multiplier: it.multiplier ?? 1,
              workflow_step: false,
              modifier_formula: it.modifier?.expression ?? null,
              wastage_percent: 0,
              item_markup: match?.multiplier ?? 1,
              overrides_material_category_id: match?.category_id ?? null,
              sort_order: defaultItemRows.length,
            })
          } else if (it.kind === 'LaborRate') {
            const match = laborByName.get(key)
            defaultItemRows.push({
              organization_id: orgId,
              product_id: p.id,
              item_type: 'LaborRate',
              material_id: null,
              labor_rate_id: match?.id ?? null,
              machine_rate_id: null,
              custom_item_name: it.name ?? null,
              menu_name: null,
              system_formula: it.formula ?? null,
              charge_per_li_unit: !!it.per_li,
              include_in_base_price: false,
              is_optional: false,
              multiplier: it.multiplier ?? 1,
              workflow_step: true,
              modifier_formula: it.modifier?.expression ?? null,
              wastage_percent: null,
              item_markup: null,
              overrides_material_category_id: null,
              sort_order: defaultItemRows.length,
            })
            if (match && !seenLabor.has(match.id)) {
              seenLabor.add(match.id)
              optionRateRows.push({
                product_id: p.id,
                rate_type: 'labor_rate',
                rate_id: match.id,
                category: match.category,
                formula: it.formula ?? 'Area',
                multiplier: it.multiplier ?? 1,
                charge_per_li_unit: !!it.per_li,
                include_in_base_price: false,
                modifier_formula: it.modifier?.expression ?? null,
                workflow_step: true,
                sort_order: optionRateRows.length,
              })
            }
          } else if (it.kind === 'MachineRate') {
            const match = machineByName.get(key)
            defaultItemRows.push({
              organization_id: orgId,
              product_id: p.id,
              item_type: 'MachineRate',
              material_id: null,
              labor_rate_id: null,
              machine_rate_id: match?.id ?? null,
              custom_item_name: it.name ?? null,
              menu_name: null,
              system_formula: it.formula ?? null,
              charge_per_li_unit: !!it.per_li,
              include_in_base_price: false,
              is_optional: false,
              multiplier: it.multiplier ?? 1,
              workflow_step: true,
              modifier_formula: it.modifier?.expression ?? null,
              wastage_percent: null,
              item_markup: null,
              overrides_material_category_id: null,
              sort_order: defaultItemRows.length,
            })
            if (match && !seenMachine.has(match.id)) {
              seenMachine.add(match.id)
              optionRateRows.push({
                product_id: p.id,
                rate_type: 'machine_rate',
                rate_id: match.id,
                category: match.category,
                formula: it.formula ?? 'Area',
                multiplier: it.multiplier ?? 1,
                charge_per_li_unit: !!it.per_li,
                include_in_base_price: false,
                modifier_formula: it.modifier?.expression ?? null,
                workflow_step: true,
                sort_order: optionRateRows.length,
              })
            }
          }
        }

        // 3. product_dropdown_menus — one per shopvox menu, items left empty
        //    (shopvox_data doesn't carry the selected items). is_optional
        //    from the explicit flag OR the "(Optional)" substring.
        const dropdownMenus: Array<{ menu_name: string; is_optional: boolean }> = []
        for (const m of (sv.dropdown_menus ?? [])) {
          if (!m.name || !m.name.trim()) continue
          dropdownMenus.push({
            menu_name: m.name.trim(),
            is_optional: !!m.optional || /\(optional\)/i.test(m.name),
          })
        }

        // ── Replace existing rows in all 4 tables ──────────────────────

        // product_modifiers
        const modDelRes = await service.from('product_modifiers').delete().eq('product_id', p.id).eq('organization_id', orgId)
        if (modDelRes.error) throw new Error(`product_modifiers delete: ${modDelRes.error.message}`)
        if (modifierRows.length > 0) {
          const modInsRes = await service.from('product_modifiers').insert(modifierRows)
          if (modInsRes.error) throw new Error(`product_modifiers insert: ${modInsRes.error.message}`)
        }

        // product_default_items
        const diDelRes = await service.from('product_default_items').delete().eq('product_id', p.id).eq('organization_id', orgId)
        if (diDelRes.error) throw new Error(`product_default_items delete: ${diDelRes.error.message}`)
        if (defaultItemRows.length > 0) {
          const diInsRes = await service.from('product_default_items').insert(defaultItemRows)
          if (diInsRes.error) throw new Error(`product_default_items insert: ${diInsRes.error.message}`)
        }

        // product_option_rates
        const orDelRes = await service.from('product_option_rates').delete().eq('product_id', p.id)
        if (orDelRes.error) throw new Error(`product_option_rates delete: ${orDelRes.error.message}`)
        if (optionRateRows.length > 0) {
          const orInsRes = await service.from('product_option_rates').insert(optionRateRows)
          if (orInsRes.error) throw new Error(`product_option_rates insert: ${orInsRes.error.message}`)
        }

        // product_dropdown_menus (+ items) — existing menus/items get wiped.
        const { data: existing } = await service
          .from('product_dropdown_menus')
          .select('id')
          .eq('product_id', p.id)
          .eq('organization_id', orgId)
        const existingIds = ((existing ?? []) as { id: string }[]).map((r) => r.id)
        if (existingIds.length > 0) {
          await service.from('product_dropdown_items').delete().in('dropdown_menu_id', existingIds)
          await service.from('product_dropdown_menus').delete().in('id', existingIds)
        }
        for (let i = 0; i < dropdownMenus.length; i++) {
          const menu = dropdownMenus[i]
          const insRes = await service
            .from('product_dropdown_menus')
            .insert({
              organization_id: orgId,
              product_id: p.id,
              menu_name: menu.menu_name,
              is_optional: menu.is_optional,
              sort_order: i,
            })
          if (insRes.error) throw new Error(`product_dropdown_menus insert: ${insRes.error.message}`)
        }

        // 4. Flip the product into 'in_progress'.
        const upRes = await service
          .from('products')
          .update({ migration_status: 'in_progress', updated_by: user.id })
          .eq('id', p.id)
          .eq('organization_id', orgId)
        if (upRes.error) throw new Error(`products update: ${upRes.error.message}`)

        processed++
      } catch (e) {
        errors.push({
          id: p.id,
          name: p.name,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }

    if (orgSlug) revalidatePath(`/dashboard/${orgSlug}/products`)

    return NextResponse.json({ processed, skipped, errors })
  } catch (err) {
    console.error('[/api/products/bulk-import-shopvox] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}
