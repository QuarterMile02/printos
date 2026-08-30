'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { revalidatePath } from 'next/cache'

function revalidate(orgSlug: string) {
  revalidatePath(`/dashboard/${orgSlug}/settings/materials/families`)
  revalidatePath(`/dashboard/${orgSlug}/settings/materials`)
}

// Moves an already-picked-up batch of variants onto an EXISTING material
// (a real family, or "Not in a family"/single-variant material becoming
// one). One call = migration 188's move_variants_to_material, one
// transaction, all-or-nothing. Never called for the holding pen itself --
// the pen writes nothing; this only fires the moment a pen (or
// directly-ticked) variant lands on a real target.
export async function moveVariants(input: { orgId: string; orgSlug: string; variantIds: string[]; targetMaterialId: string }) {
  const { allowed } = await checkPermission(input.orgId, 'materials.edit')
  if (!allowed) return { error: 'Not permitted to edit materials.' }
  if (input.variantIds.length === 0) return { error: 'Nothing to move.' }

  const sb = createServiceClient()
  const { error } = await sb.rpc('move_variants_to_material', {
    p_variant_ids: input.variantIds,
    p_target_material_id: input.targetMaterialId,
  })
  if (error) return { error: error.message }

  revalidate(input.orgSlug)
  return { ok: true }
}

// The "+ New family..." target: no empty-family primitive exists on
// purpose (migration 188 raises on an empty variant array) -- creating
// the family and moving the first batch into it are the same call.
export async function createFamilyAndMoveVariants(input: { orgId: string; orgSlug: string; variantIds: string[]; name: string; typeId: string | null }) {
  const { allowed } = await checkPermission(input.orgId, 'materials.edit')
  if (!allowed) return { error: 'Not permitted to edit materials.' }
  if (input.variantIds.length === 0) return { error: 'Nothing to move.' }
  if (!input.name.trim()) return { error: 'Name the new family first.' }

  const sb = createServiceClient()
  const { data: materialId, error } = await sb.rpc('create_material_family_from_variants', {
    p_variant_ids: input.variantIds,
    p_name: input.name.trim(),
    p_type_id: input.typeId,
  })
  if (error) return { error: error.message }

  revalidate(input.orgSlug)
  return { ok: true, materialId: materialId as string }
}

export async function renameFamily(input: { orgId: string; orgSlug: string; materialId: string; name: string }) {
  const { allowed } = await checkPermission(input.orgId, 'materials.edit')
  if (!allowed) return { error: 'Not permitted to edit materials.' }
  if (!input.name.trim()) return { error: 'Name cannot be blank.' }

  const sb = createServiceClient()
  const { error } = await sb.from('materials').update({ name: input.name.trim() }).eq('id', input.materialId).eq('organization_id', input.orgId)
  if (error) return { error: error.message }

  revalidate(input.orgSlug)
  return { ok: true }
}

// Renames one material_colors row -- scoped to that colour, on that one
// material, only. Not global: material_colors rows are already per-
// material by schema (migration 174, material_id NOT NULL), so a rename
// by id can never touch a same-named colour on a different material --
// there's nothing extra to scope here, the id already pins it to one
// material. Affects every variant of that colour on this family (they
// all share the same color_id) -- the UI says so in the rename prompt
// itself, since that's the one thing this action's own scope doesn't
// make obvious on its own.
//
// Rejects a name that already exists on ANOTHER colour of the SAME
// material -- move_variants_to_material (188) matches a target colour by
// exact `name =` within one material; two colours sharing a name on one
// material would make that match ambiguous the next time a variant moves
// in. The duplicate check below uses the same exact match, not a
// case-insensitive one, so it can't reject a name the RPC would treat as
// genuinely different.
export async function renameColour(input: { orgId: string; orgSlug: string; colourId: string; name: string }) {
  const { allowed } = await checkPermission(input.orgId, 'materials.edit')
  if (!allowed) return { error: 'Not permitted to edit materials.' }
  const name = input.name.trim()
  if (!name) return { error: 'Name cannot be blank.' }

  const sb = createServiceClient()

  const { data: colour, error: fetchErr } = await sb
    .from('material_colors')
    .select('id, material_id')
    .eq('id', input.colourId)
    .eq('organization_id', input.orgId)
    .maybeSingle()
  if (fetchErr) return { error: fetchErr.message }
  if (!colour) return { error: 'Colour not found.' }

  const { data: existing } = await sb
    .from('material_colors')
    .select('id')
    .eq('material_id', colour.material_id)
    .eq('name', name)
    .neq('id', input.colourId)
    .maybeSingle()
  if (existing) return { error: `"${name}" already exists as a colour on this material -- pick a different name.` }

  const { error } = await sb.from('material_colors').update({ name }).eq('id', input.colourId)
  if (error) return { error: error.message }

  revalidate(input.orgSlug)
  return { ok: true }
}

export async function deactivateMaterials(input: { orgId: string; orgSlug: string; materialIds: string[] }) {
  const { allowed } = await checkPermission(input.orgId, 'materials.edit')
  if (!allowed) return { error: 'Not permitted to edit materials.' }
  if (input.materialIds.length === 0) return { error: 'Nothing selected.' }

  const sb = createServiceClient()
  const { error } = await sb.from('materials').update({ active: false }).in('id', input.materialIds).eq('organization_id', input.orgId)
  if (error) return { error: error.message }

  revalidate(input.orgSlug)
  return { ok: true }
}

export async function reactivateMaterials(input: { orgId: string; orgSlug: string; materialIds: string[] }) {
  const { allowed } = await checkPermission(input.orgId, 'materials.edit')
  if (!allowed) return { error: 'Not permitted to edit materials.' }
  if (input.materialIds.length === 0) return { error: 'Nothing selected.' }

  const sb = createServiceClient()
  const { error } = await sb.from('materials').update({ active: true }).in('id', input.materialIds).eq('organization_id', input.orgId)
  if (error) return { error: error.message }

  revalidate(input.orgSlug)
  return { ok: true }
}

// Delete is only ever offered client-side for rows already computed
// "Safe" -- re-verified here anyway, live, the same two reference checks
// (product_default_items, material_vendors) settings/materials/
// actions-sr.ts's single-material deleteMaterial already uses, plus the
// same active=false precondition -- never trust a client-computed status
// for something irreversible. Silently skips (does not error on) any id
// that fails re-verification, and reports exactly which ones were
// skipped and why, rather than either failing the whole batch or
// pretending every id succeeded.
export async function deleteMaterials(input: { orgId: string; orgSlug: string; materialIds: string[] }) {
  const { allowed } = await checkPermission(input.orgId, 'materials.edit')
  if (!allowed) return { error: 'Not permitted to edit materials.' }
  if (input.materialIds.length === 0) return { error: 'Nothing selected.' }

  const sb = createServiceClient()

  const { data: mats } = await sb.from('materials').select('id, name, active').in('id', input.materialIds).eq('organization_id', input.orgId)
  const rows = (mats ?? []) as { id: string; name: string; active: boolean }[]

  const { data: recipeRows } = await sb.from('product_default_items').select('material_id').in('material_id', input.materialIds).eq('item_type', 'Material')
  const recipeCount = new Map<string, number>()
  for (const r of (recipeRows ?? []) as { material_id: string }[]) recipeCount.set(r.material_id, (recipeCount.get(r.material_id) ?? 0) + 1)

  const { data: vendorRows } = await sb.from('material_vendors').select('material_id').in('material_id', input.materialIds)
  const vendorCount = new Map<string, number>()
  for (const r of (vendorRows ?? []) as { material_id: string }[]) vendorCount.set(r.material_id, (vendorCount.get(r.material_id) ?? 0) + 1)

  const safeIds: string[] = []
  const skipped: { name: string; reason: string }[] = []
  for (const m of rows) {
    if (m.active) { skipped.push({ name: m.name, reason: 'not deactivated' }); continue }
    const refs = recipeCount.get(m.id) ?? 0
    if (refs > 0) { skipped.push({ name: m.name, reason: `used in ${refs} product${refs === 1 ? '' : 's'}` }); continue }
    safeIds.push(m.id)
    if ((vendorCount.get(m.id) ?? 0) > 0) {
      // Safe to delete (no recipe reference), but flagged Check/hold
      // client-side for exactly this reason -- vendor rows cascade-
      // delete silently. Still deletable; not blocked.
    }
  }

  if (safeIds.length > 0) {
    const { error } = await sb.from('materials').delete().in('id', safeIds)
    if (error) return { error: error.message }
  }

  revalidate(input.orgSlug)
  return { ok: true, deleted: safeIds.length, skipped }
}

// Bulk edit, variant-level fields (Cost -> base_cost, Markup -> multiplier).
// Blank means unchanged -- only the fields actually provided are ever
// included in the UPDATE, so an empty bulk-edit field can never write a
// zero. Applies to whichever variant ids are ticked, in either slot.
export async function bulkEditVariants(input: { orgId: string; orgSlug: string; variantIds: string[]; baseCost?: number; multiplier?: number }) {
  const { allowed } = await checkPermission(input.orgId, 'materials.edit')
  if (!allowed) return { error: 'Not permitted to edit materials.' }
  if (input.variantIds.length === 0) return { error: 'Nothing ticked.' }

  const patch: Record<string, number> = {}
  if (input.baseCost !== undefined) patch.base_cost = input.baseCost
  if (input.multiplier !== undefined) patch.multiplier = input.multiplier
  if (Object.keys(patch).length === 0) return { error: 'Nothing to apply -- every field was left blank.' }

  const sb = createServiceClient()
  const { error } = await sb.from('material_variants').update(patch).in('id', input.variantIds).eq('organization_id', input.orgId)
  if (error) return { error: error.message }

  revalidate(input.orgSlug)
  return { ok: true }
}

// Bulk edit, material-level fields (Pricing axis -> formula, Internal
// only -> show_external). formula/show_external live on the PARENT
// material, not the variant -- applied once per DISTINCT material owning
// a ticked variant, not once per variant (a family with 3 ticked variants
// gets one UPDATE for its one material row, not three redundant ones).
// Blank means unchanged, same rule as bulkEditVariants.
export async function bulkEditMaterials(input: { orgId: string; orgSlug: string; materialIds: string[]; formula?: string; showExternal?: boolean }) {
  const { allowed } = await checkPermission(input.orgId, 'materials.edit')
  if (!allowed) return { error: 'Not permitted to edit materials.' }
  if (input.materialIds.length === 0) return { error: 'Nothing ticked.' }

  const patch: Record<string, string | boolean> = {}
  if (input.formula !== undefined) patch.formula = input.formula
  if (input.showExternal !== undefined) patch.show_external = input.showExternal
  if (Object.keys(patch).length === 0) return { error: 'Nothing to apply -- every field was left blank.' }

  const sb = createServiceClient()
  const { error } = await sb.from('materials').update(patch).in('id', input.materialIds).eq('organization_id', input.orgId)
  if (error) return { error: error.message }

  revalidate(input.orgSlug)
  return { ok: true }
}
