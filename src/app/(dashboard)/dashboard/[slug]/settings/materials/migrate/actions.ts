'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { revalidatePath } from 'next/cache'

export type AcceptVariantInput = {
  height: number | null
  width: number | null
  lengthIncrement: number | null
  isDefault: boolean
  baseCost: number | null
  multiplier: number | null
}

export type AcceptColourInput = {
  name: string | null // null = no colour/finish group -- variants get color_id NULL
  code: string | null
  isStocked: boolean
  variants: AcceptVariantInput[]
}

export type AcceptFamilyProposalInput = {
  orgId: string
  orgSlug: string
  familyName: string // full material name -- line + axis value, e.g. "Acrylic .118in - 1/8""
  materialTypeId: string | null
  categoryId: string | null
  sourceRowIds: string[] // shopvox_materials.id, every source row folded into this family
  colours: AcceptColourInput[]
  vendorSeed: {
    vendorName: string
    vendorPrice: number | null
    partNumber: string | null
    rank: number | null
  } | null
  // Best-available legacy pricing fields, seeded from the accepted
  // proposal's source rows -- materials.cost/price/sheet_cost/etc. are
  // NOT retired by this build -- they're what the existing pricing
  // engine reads today, same rationale as Build 1.
  legacyFields: {
    cost: number | null
    price: number | null
    sheetCost: number | null
    multiplier: number | null
    weight: number | null
    partNumber: string | null
    sku: string | null
    poDescription: string | null
    infoUrl: string | null
    description: string | null
  }
}

// Accepts one family proposal (line + axis value, with colour/finish
// groups and their size variants). Creates the material, its
// material_colors rows, its material_variants (color_id set per
// group), an optional seeded material_vendors row, and links every
// contributing shopvox_materials row to the new material -- ALL IN ONE
// DB TRANSACTION via the accept_family_proposal Postgres function
// (migration 182). PostgREST/Supabase has no client-side multi-
// statement transaction API; a single function call is the only way to
// get true atomicity here -- if anything fails (e.g. the one-default-
// per-colour unique index from migration 181 firing), NOTHING lands,
// not a partial material with no colours or an orphaned variant.
//
// Nothing here runs until this is called -- the proposal screen only
// writes on explicit accept, per instruction.
export async function acceptSubstrateProposal(input: AcceptFamilyProposalInput) {
  const { allowed } = await checkPermission(input.orgId, 'materials.edit')
  if (!allowed) return { error: 'Not permitted to create materials.' }

  if (!input.familyName.trim()) return { error: 'Family name is required.' }
  if (input.colours.length === 0) return { error: 'At least one colour/finish group is required.' }
  for (const c of input.colours) {
    if (c.variants.length === 0) return { error: `Colour/finish "${c.name ?? '(none)'}" has no size variants.` }
    const defaultCount = c.variants.filter((v) => v.isDefault).length
    if (defaultCount > 1) return { error: `Colour/finish "${c.name ?? '(none)'}" has more than one default variant.` }
  }

  const sb = createServiceClient()

  const payload = {
    organization_id: input.orgId,
    material: {
      name: input.familyName,
      material_type_id: input.materialTypeId,
      category_id: input.categoryId,
      length_uom: 'in',
      cost: input.legacyFields.cost,
      price: input.legacyFields.price,
      sheet_cost: input.legacyFields.sheetCost,
      // No ?? 2 fallback -- materials.multiplier is nullable (confirmed
      // against migration 010's own CREATE TABLE and every later
      // migration touching it; no NOT NULL was ever added), so leaving
      // it NULL when unknown is a legal, honest DB state. Inventing 2
      // here would price silently and look plausible -- same failure
      // shape the tax-rate incident was.
      multiplier: input.legacyFields.multiplier,
      weight: input.legacyFields.weight,
      part_number: input.legacyFields.partNumber,
      sku: input.legacyFields.sku,
      po_description: input.legacyFields.poDescription,
      info_url: input.legacyFields.infoUrl,
      description: input.legacyFields.description,
      preferred_vendor: input.vendorSeed?.vendorName ?? null,
    },
    colours: input.colours.map((c) => ({
      name: c.name,
      code: c.code,
      is_stocked: c.isStocked,
      variants: c.variants.map((v, i) => ({
        height: v.height,
        width: v.width,
        length_increment: v.lengthIncrement,
        is_default: v.isDefault,
        base_cost: v.baseCost,
        // No ?? 2 fallback -- material_variants.multiplier is NOT NULL
        // (migration 173), so a missing value here must FAIL the accept
        // (accept_family_proposal raises loudly on a null variant
        // multiplier) rather than silently insert an invented 2. Send
        // the raw value through, null and all, so that check actually
        // gets a chance to fire.
        multiplier: v.multiplier,
        sort_order: i,
      })),
    })),
    vendor_seed: input.vendorSeed
      ? { vendor_name: input.vendorSeed.vendorName, vendor_price: input.vendorSeed.vendorPrice, part_number: input.vendorSeed.partNumber, rank: input.vendorSeed.rank, po_description: input.legacyFields.poDescription }
      : null,
    source_row_ids: input.sourceRowIds,
  }

  const { data: materialId, error } = await sb.rpc('accept_family_proposal', { payload })
  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${input.orgSlug}/settings/materials/migrate`)
  revalidatePath(`/dashboard/${input.orgSlug}/settings/materials`)
  return { materialId: materialId as string }
}

// CHANGED review: applies only the fields Ruben checked ("carry this
// change over") to the already-linked material, then re-syncs
// migrated_source_hash so the row goes back to MIGRATED. Called with an
// empty fieldsToApply to just dismiss/acknowledge a CHANGED row without
// changing anything in PrintOS. Unaffected by the family/colour rework
// -- this operates on an already-migrated material's plain columns.
export async function applyChangedFields(input: {
  orgId: string
  orgSlug: string
  shopvoxMaterialId: string
  materialId: string
  fieldsToApply: Record<string, string | number | boolean | null>
}) {
  const { allowed } = await checkPermission(input.orgId, 'materials.edit')
  if (!allowed) return { error: 'Not permitted to edit materials.' }

  const sb = createServiceClient()

  if (Object.keys(input.fieldsToApply).length > 0) {
    const { error: updErr } = await sb
      .from('materials')
      .update(input.fieldsToApply)
      .eq('id', input.materialId)
      .eq('organization_id', input.orgId)
    if (updErr) return { error: updErr.message }
  }

  const { data: row } = await sb.from('shopvox_materials').select('source_hash').eq('id', input.shopvoxMaterialId).maybeSingle()
  if (row) {
    await sb.from('shopvox_materials').update({ migrated_source_hash: row.source_hash }).eq('id', input.shopvoxMaterialId)
  }

  revalidatePath(`/dashboard/${input.orgSlug}/settings/materials/migrate`)
  return { ok: true }
}

export type AddToExistingColourInput = {
  existingColorId: string | null // null = create a new colour/finish
  name: string | null
  code: string | null
  isStocked: boolean
  variants: {
    height: number | null
    width: number | null
    lengthIncrement: number | null
    baseCost: number | null
    multiplier: number | null
    isDefault: boolean
    sourceRowId: string // shopvox_materials.id this variant was folded in from
  }[]
}

export type AddToExistingMaterialInput = {
  orgId: string
  orgSlug: string
  materialId: string // the existing material being added to
  colours: AddToExistingColourInput[]
}

// Folds an ENTIRE proposed family -- one row or many, any number of
// colours -- into an EXISTING (already accepted) material, in one DB
// transaction via add_variant_to_existing_material (migration 185,
// which generalizes 183's single-row shape to a colours/variants array
// -- 183 alone cannot take more than one row per call, confirmed by
// reading it directly, not assumed). Same PostgREST-has-no-client-
// transaction reasoning as acceptSubstrateProposal: every colour and
// every variant in the payload either all land or none do.
export async function addVariantToExistingMaterial(input: AddToExistingMaterialInput) {
  const { allowed } = await checkPermission(input.orgId, 'materials.edit')
  if (!allowed) return { error: 'Not permitted to edit materials.' }

  if (input.colours.length === 0) return { error: 'At least one colour/finish group is required.' }
  for (const c of input.colours) {
    if (!c.existingColorId && !c.name?.trim() && !c.code?.trim()) {
      return { error: 'Pick an existing colour/finish or name the new one.' }
    }
    if (c.variants.length === 0) return { error: `Colour/finish "${c.name ?? '(existing)'}" has no size variants.` }
    const defaultCount = c.variants.filter((v) => v.isDefault).length
    if (defaultCount > 1) return { error: `Colour/finish "${c.name ?? '(existing)'}" has more than one default variant.` }
  }

  const sb = createServiceClient()

  const payload = {
    organization_id: input.orgId,
    material_id: input.materialId,
    colours: input.colours.map((c) => ({
      existing_color_id: c.existingColorId,
      name: c.name,
      code: c.code,
      is_stocked: c.isStocked,
      variants: c.variants.map((v) => ({
        height: v.height,
        width: v.width,
        length_increment: v.lengthIncrement,
        base_cost: v.baseCost,
        // No fallback here -- material_variants.multiplier is NOT NULL,
        // and a multiplier of 0 is ALSO refused (RPC-side, migration
        // 185) rather than treated as a legal value. Send the raw
        // value through, 0 and all, so that check actually fires.
        multiplier: v.multiplier,
        is_default: v.isDefault,
        source_row_id: v.sourceRowId,
      })),
    })),
  }

  const { data: materialId, error } = await sb.rpc('add_variant_to_existing_material', { payload })
  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${input.orgSlug}/settings/materials/migrate`)
  revalidatePath(`/dashboard/${input.orgSlug}/settings/materials`)
  return { materialId: materialId as string }
}

// Dismiss / restore -- reversible, never a delete. dismissed_at set now
// pulls a row out of the NEW queue into its own DISMISSED tab;
// restoring clears it back to whatever status it would otherwise read
// as (NEW, unless it was also separately migrated/changed).
export async function dismissRows(input: { orgId: string; orgSlug: string; shopvoxMaterialIds: string[] }) {
  const { allowed } = await checkPermission(input.orgId, 'materials.edit')
  if (!allowed) return { error: 'Not permitted to edit materials.' }
  if (input.shopvoxMaterialIds.length === 0) return { error: 'Nothing to dismiss.' }

  const sb = createServiceClient()
  const { error } = await sb
    .from('shopvox_materials')
    .update({ dismissed_at: new Date().toISOString() })
    .in('id', input.shopvoxMaterialIds)
    .eq('organization_id', input.orgId)
  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${input.orgSlug}/settings/materials/migrate`)
  return { ok: true }
}

export async function restoreDismissedRow(input: { orgId: string; orgSlug: string; shopvoxMaterialId: string }) {
  const { allowed } = await checkPermission(input.orgId, 'materials.edit')
  if (!allowed) return { error: 'Not permitted to edit materials.' }

  const sb = createServiceClient()
  const { error } = await sb
    .from('shopvox_materials')
    .update({ dismissed_at: null })
    .eq('id', input.shopvoxMaterialId)
    .eq('organization_id', input.orgId)
  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${input.orgSlug}/settings/materials/migrate`)
  return { ok: true }
}
