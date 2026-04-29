// Smart Material Selection Engine — roll materials only (Phase 1).
//
// Run when a job/sales order is created from an approved quote.
// Picks the narrowest roll that fits the print, flags 2-up opportunities,
// assigns a printer based on roll width, computes material used in sqft,
// and surfaces low-stock warnings when inventory tracking is wired up.
//
// The engine is stateless — pass in a service-role Supabase client and
// the order context. No writes, no mutation. The caller persists the
// returned result onto jobs.material_selection.

import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

const ROLL_MATERIAL_TYPE_NAME = 'Roll Materials'
const EPSON_MAX_WIDTH = 54  // inches — anything ≤ 54" prints on Epson
const SWISSQ_MAX_WIDTH = 98 // inches — anything (54", 98"] prints on Swiss Q

export type MaterialSelectionInput = {
  organization_id: string
  // Order dimensions (inches), pre-hem
  width_inches: number
  height_inches: number
  quantity: number
  // True for banner products. Caller decides via product name match
  // ("Banner") or product category = "Banners". Engine doesn't peek
  // at the product; it just applies the hem rule.
  is_banner: boolean
  // Categories listed on the product's recipe. Empty array means
  // "no category restriction" — engine searches all roll materials in the org.
  allowed_material_category_ids: string[]
}

export type MaterialSelectionResult = {
  selected_material_id: string | null
  selected_material_name: string | null
  roll_width_inches: number | null
  actual_print_width: number
  actual_print_height: number
  hem_allowance_applied: boolean
  assigned_printer: 'Epson' | 'Swiss Q' | null
  two_up_candidate: boolean
  two_up_roll_width: number | null
  material_used_sqft: number
  low_stock_warning: boolean
  low_stock_message: string | null
  // Diagnostics — non-spec fields the UI can use to render fallback states.
  no_material_found: boolean
  reason: string | null
}

type RollMaterialRow = {
  id: string
  name: string
  width: number
  category_id: string | null
}

// STEP 1 — hem allowance. Applies only to banners. Threshold is on the
// pre-hem height: ≤48 → +1 all around; >48 → +1.5 all around.
export function applyHemAllowance(
  width: number,
  height: number,
  isBanner: boolean,
): { actual_width: number; actual_height: number; applied: boolean } {
  if (!isBanner) {
    return { actual_width: width, actual_height: height, applied: false }
  }
  const margin = height <= 48 ? 1 : 1.5
  return {
    actual_width: width + margin * 2,
    actual_height: height + margin * 2,
    applied: true,
  }
}

// STEP 4 — printer assignment from the chosen roll width.
export function assignPrinter(rollWidth: number | null): 'Epson' | 'Swiss Q' | null {
  if (rollWidth == null) return null
  if (rollWidth <= EPSON_MAX_WIDTH) return 'Epson'
  if (rollWidth <= SWISSQ_MAX_WIDTH) return 'Swiss Q'
  return null
}

export async function selectMaterial(
  service: ServiceClient,
  input: MaterialSelectionInput,
): Promise<MaterialSelectionResult> {
  // STEP 1 — hem allowance
  const { actual_width, actual_height, applied } = applyHemAllowance(
    input.width_inches,
    input.height_inches,
    input.is_banner,
  )

  const empty = (reason: string): MaterialSelectionResult => ({
    selected_material_id: null,
    selected_material_name: null,
    roll_width_inches: null,
    actual_print_width: actual_width,
    actual_print_height: actual_height,
    hem_allowance_applied: applied,
    assigned_printer: null,
    two_up_candidate: false,
    two_up_roll_width: null,
    material_used_sqft: 0,
    low_stock_warning: false,
    low_stock_message: null,
    no_material_found: true,
    reason,
  })

  if (!Number.isFinite(actual_width) || actual_width <= 0) return empty('Invalid width.')
  if (!Number.isFinite(actual_height) || actual_height <= 0) return empty('Invalid height.')
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return empty('Invalid quantity.')

  // Resolve "Roll Materials" type id for this org. Returns empty if no
  // material type with that name exists yet — surfaces a clear reason
  // rather than silently picking sheet materials.
  const { data: rollType } = await service
    .from('material_types')
    .select('id')
    .eq('organization_id', input.organization_id)
    .ilike('name', ROLL_MATERIAL_TYPE_NAME)
    .maybeSingle() as { data: { id: string } | null; error: unknown }

  if (!rollType) {
    return empty(`No material_type named "${ROLL_MATERIAL_TYPE_NAME}" in this org.`)
  }

  // STEP 2 — fetch candidate roll materials. Filter to the product's
  // allowed categories if any were provided. Order by width ASC so the
  // narrowest fitting roll is first.
  type Builder = ReturnType<ReturnType<ServiceClient['from']>['select']>
  let query = service
    .from('materials')
    .select('id, name, width, category_id')
    .eq('organization_id', input.organization_id)
    .eq('active', true)
    .eq('material_type_id', rollType.id)
    .not('width', 'is', null)
    .order('width', { ascending: true }) as unknown as Builder

  if (input.allowed_material_category_ids.length > 0) {
    query = query.in('category_id', input.allowed_material_category_ids) as unknown as Builder
  }

  const { data: rollsRaw, error } = await query as { data: RollMaterialRow[] | null; error: { message: string } | null }
  if (error) return empty(`Material lookup failed: ${error.message}`)
  const rolls = (rollsRaw ?? []).filter((r) => Number.isFinite(Number(r.width)) && Number(r.width) > 0)
  if (rolls.length === 0) return empty('No active roll materials in the allowed categories.')

  // STEP 2 cont. — narrowest roll where width ≥ actual_width
  const fitting = rolls.filter((r) => Number(r.width) >= actual_width)
  if (fitting.length === 0) {
    return empty(`No roll wide enough for ${actual_width}″ print (widest available: ${rolls[rolls.length - 1].width}″).`)
  }
  const chosen = fitting[0]
  const chosenWidth = Number(chosen.width)

  // STEP 3 — 2-up check. Look for the narrowest roll in the catalog
  // where (actual_width × 2) fits. Must be a different (wider) roll
  // than the chosen one — otherwise 2-up is just a re-statement of
  // single-up on the same roll, not an opportunity.
  const twoUpWidth = actual_width * 2
  const twoUpCandidate = rolls.find((r) => Number(r.width) >= twoUpWidth && Number(r.width) > chosenWidth)
  const two_up_candidate = !!twoUpCandidate
  const two_up_roll_width = twoUpCandidate ? Number(twoUpCandidate.width) : null

  // STEP 4 — printer assignment
  const assigned_printer = assignPrinter(chosenWidth)

  // STEP 5 — material used (sqft). Default = print bbox × qty. If
  // 2-up suggested AND caller eventually applies it, the wider roll's
  // width × height × ceil(qty/2) is what gets consumed. Engine reports
  // the SINGLE-UP usage as the source of truth (`material_used_sqft`)
  // because two_up is only a suggestion, not auto-applied. UI can
  // compute the savings: single-up sqft − two-up sqft.
  const material_used_sqft = (actual_width / 12) * (actual_height / 12) * input.quantity

  // STEP 6 — low-stock probe. materials.current_stock and
  // materials.min_stock_level may not exist (older schemas). Try the
  // query and degrade silently if the columns are missing.
  let low_stock_warning = false
  let low_stock_message: string | null = null
  try {
    const stockRes = await service
      .from('materials')
      .select('current_stock, min_stock_level')
      .eq('id', chosen.id)
      .maybeSingle() as { data: { current_stock: number | null; min_stock_level: number | null } | null; error: { message: string } | null }

    if (!stockRes.error && stockRes.data) {
      const cur = Number(stockRes.data.current_stock ?? NaN)
      const min = Number(stockRes.data.min_stock_level ?? NaN)
      if (Number.isFinite(cur) && Number.isFinite(min) && cur > 0) {
        const after = cur - material_used_sqft
        if (after < min) {
          low_stock_warning = true
          low_stock_message = `${chosen.name} stock will drop to ${after.toFixed(1)} sqft (below min ${min}).`
        }
      }
    }
  } catch {
    // current_stock / min_stock_level aren't on the schema — leave warning off.
  }

  return {
    selected_material_id: chosen.id,
    selected_material_name: chosen.name,
    roll_width_inches: chosenWidth,
    actual_print_width: actual_width,
    actual_print_height: actual_height,
    hem_allowance_applied: applied,
    assigned_printer,
    two_up_candidate,
    two_up_roll_width,
    material_used_sqft,
    low_stock_warning,
    low_stock_message,
    no_material_found: false,
    reason: null,
  }
}

// ---- Caller helpers ----

// Determine whether a product is a banner. The engine takes is_banner
// directly; this helper centralizes the "name contains Banner OR
// category name = Banners" rule so callers don't drift.
export function isBannerProduct(
  productName: string | null | undefined,
  productCategoryName: string | null | undefined,
): boolean {
  const name = (productName ?? '').toLowerCase()
  const cat = (productCategoryName ?? '').toLowerCase().trim()
  return name.includes('banner') || cat === 'banners'
}

// Pull a product's allowed material category ids from
// product_default_items. Empty array means "no restriction".
export async function getProductMaterialCategories(
  service: ServiceClient,
  productId: string,
): Promise<string[]> {
  const { data } = await service
    .from('product_default_items')
    .select('overrides_material_category_id')
    .eq('product_id', productId)
    .eq('item_type', 'Material') as {
      data: { overrides_material_category_id: string | null }[] | null
      error: unknown
    }

  const ids = new Set<string>()
  for (const row of data ?? []) {
    if (row.overrides_material_category_id) ids.add(row.overrides_material_category_id)
  }
  return Array.from(ids)
}
