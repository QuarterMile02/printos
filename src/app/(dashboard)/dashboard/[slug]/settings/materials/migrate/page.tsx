import { createClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import { dbOrThrow, dbAllOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import MigrateClient from './migrate-client'
import { buildFamilyProposals, buildChannelLetterFamilyProposals, CHANNEL_LETTER_TYPE_NAME, FAMILY_CONFIGS } from '@/lib/material-family-proposals'
import type { ShopvoxMaterialRow } from '@/lib/material-migrate-proposals'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }>; searchParams: Promise<{ type?: string }> }

export default async function MaterialsMigratePage(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('materials-migrate', err)
  }
}

async function PageInner({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string; slug: string } | null
  if (!org) notFound()

  // ── Type-aware screen ────────────────────────────────────────────
  // This screen used to hardcode ONE material type (Substrates) — any
  // row of any other type was invisible, not filtered-and-shown-as-
  // zero, just never fetched at all. That hid 5 real "Substrates" (a
  // different type from "Rigid Substrates- Sheets") rows behind a tab
  // that read "NEW (1)" — see known-issues/2026-08-22-roll-vinyl-
  // migrate-pass-proposal.md, Problem 1. Fixed with the minimum needed:
  // a type picker (?type= URL param), a small name->config lookup with
  // an explicit "unconfigured" fallback (never an empty screen — an
  // empty screen is indistinguishable from "nothing to do", which is
  // exactly what hid those 5 rows), and per-type counts computed with
  // explicit, unbounded pagination so a count can never silently
  // truncate at PostgREST's 1000-row cap.
  const allTypes = await dbAllOrThrow<{ id: string; name: string }>((from, to) =>
    supabase.from('material_types').select('id, name').eq('organization_id', org.id).order('name').range(from, to)
  )

  // Every NEW row, org-wide, minimal columns — paginated. This is what
  // makes the per-type counts in the picker a TRUE count: it is not
  // derived from any proposal, not filtered to one type ahead of time,
  // and cannot silently stop at 1000 the way an unbounded query would.
  const allNewRowTypeIds = await dbAllOrThrow<{ material_type_id: string | null }>((from, to) =>
    supabase.from('shopvox_materials').select('material_type_id').eq('organization_id', org.id).eq('status', 'NEW').range(from, to)
  )
  const newCountsByType = new Map<string, number>()
  for (const r of allNewRowTypeIds) {
    if (!r.material_type_id) continue
    newCountsByType.set(r.material_type_id, (newCountsByType.get(r.material_type_id) ?? 0) + 1)
  }

  // Default selection: the requested ?type= if it's a real type for
  // this org, else the first type (alphabetically) that actually has
  // NEW rows, else just the first type — never Substrates specifically,
  // and never "nothing selected" as long as the org has at least one
  // material type.
  const requestedType = sp.type ? allTypes.find((t) => t.id === sp.type) ?? null : null
  const selectedType = requestedType
    ?? allTypes.find((t) => (newCountsByType.get(t.id) ?? 0) > 0)
    ?? allTypes[0]
    ?? null

  const config = selectedType ? FAMILY_CONFIGS[selectedType.name] : undefined
  const parserConfigured = !!config

  const [rows, categoriesRes] = await Promise.all([
    selectedType
      ? dbAllOrThrow<ShopvoxMaterialRow & {
          migrated_to_material_id: string | null
          migrated_at: string | null
          source_hash: string
          migrated_source_hash: string | null
          dismissed_at: string | null
        }>((from, to) =>
          supabase
            .from('shopvox_materials')
            .select('id, shopvox_id, name, material_type_id, category_id, width, height, sheet_cost, cost, price, multiplier, preferred_vendor, part_number, sku, po_description, info_url, image_url, description, vendor_pricing, status, migrated_to_material_id, migrated_at, source_hash, migrated_source_hash, dismissed_at')
            .eq('organization_id', org.id)
            .eq('material_type_id', selectedType.id)
            .order('name')
            .range(from, to)
        )
      : Promise.resolve([]),
    dbAllOrThrow<{ id: string; name: string }>((from, to) =>
      supabase.from('material_categories').select('id, name').eq('organization_id', org.id).range(from, to)
    ),
  ])

  const typedRows = rows

  const categoryNames = new Map(categoriesRes.map((c) => [c.id, c.name]))

  // The TRUE unmigrated-row count for the selected type — sourced
  // directly from the row fetch above (now fully paginated), never from
  // `proposals`. buildFamilyProposals never drops a row (every row
  // lands in some family, worst case its own singleton), so
  // proposalRowCount and newRows.length should always agree — but the
  // client checks that explicitly and surfaces a banner if they ever
  // don't, rather than trusting the invariant silently. This is what
  // "cannot silently under-report" means in practice: two independently
  // computed numbers, checked against each other, not one number
  // presented as if it were self-evidently correct.
  const newRows = typedRows.filter((r) => r.status === 'NEW')
  // Channel Letter Materials uses its own dedicated builder -- its
  // naming is reversed/order-independent and doesn't fit
  // buildFamilyProposals' fixed left-to-right parse order (see
  // material-family-proposals.ts's Channel Letter section header
  // comment). Every other configured type is untouched -- same exact
  // buildFamilyProposals(newRows, categoryNames, config) call as
  // before this branch existed.
  const proposals = !parserConfigured
    ? []
    : selectedType?.name === CHANNEL_LETTER_TYPE_NAME
      ? buildChannelLetterFamilyProposals(newRows, categoryNames)
      : buildFamilyProposals(newRows, categoryNames, config)

  // For CHANGED rows, load the linked material's current values so the
  // client can render a field-by-field diff (ShopVOX now vs. PrintOS
  // current) before Ruben chooses what to carry over.
  const changedRows = typedRows.filter((r) => r.status === 'CHANGED')
  const migratedRows = typedRows.filter((r) => r.status === 'MIGRATED')
  // DISMISSED rows aren't queried separately here -- migrate-client.tsx
  // already has the full `rows` array and derives its own DISMISSED tab
  // client-side (rowsByStatus.DISMISSED), same as it already does for
  // NEW/CHANGED/MIGRATED.

  // "Existing materials" for the Add-to-existing picker + suggested
  // parents: any material a CHANGED or MIGRATED row already points at
  // -- i.e. every material actually created through THIS migrate screen
  // (accept or a prior add-to-existing), not the ~235 original flat
  // legacy materials the ShopVOX scrape wrote directly (Build 1 finding
  // B) -- those are the source data being consolidated, not valid merge
  // targets. Derived from migrated_to_material_id, not a separate flag,
  // since none exists and this derivation is exact.
  const existingMaterialIds = [...new Set(
    [...changedRows, ...migratedRows].map((r) => r.migrated_to_material_id).filter((id): id is string => !!id)
  )]

  const [linkedMaterialsRes, existingMaterialsRes] = await Promise.all([
    changedRows.length
      ? dbOrThrow(
          supabase
            .from('materials')
            .select('id, name, width, height, sheet_cost, cost, price, multiplier, preferred_vendor, part_number, sku, po_description, info_url, description')
            .in('id', [...new Set(changedRows.map((r) => r.migrated_to_material_id).filter(Boolean))] as string[])
        )
      : Promise.resolve([]),
    existingMaterialIds.length
      ? dbOrThrow(supabase.from('materials').select('id, name, category_id').in('id', existingMaterialIds))
      : Promise.resolve([]),
  ])

  const existingColoursRes = existingMaterialIds.length
    ? await dbOrThrow(
        supabase
          .from('material_colors')
          .select('id, material_id, name, code')
          .in('material_id', existingMaterialIds)
          .order('name')
      )
    : []

  // Reuses existingMaterialsRes (already fetched above) rather than a
  // second round-trip for the same id set with fewer columns.
  const migratedMaterialNames = ((existingMaterialsRes ?? []) as { id: string; name: string }[]).map((m) => ({ id: m.id, name: m.name }))

  return (
    <MigrateClient
      orgId={org.id}
      orgSlug={slug}
      types={allTypes}
      newCountsByType={Object.fromEntries(newCountsByType)}
      selectedTypeId={selectedType?.id ?? null}
      parserConfigured={parserConfigured}
      trueNewCount={newRows.length}
      rows={typedRows}
      proposals={proposals}
      linkedMaterials={(linkedMaterialsRes ?? []) as Record<string, unknown>[]}
      migratedMaterialNames={(migratedMaterialNames ?? []) as { id: string; name: string }[]}
      existingMaterials={(existingMaterialsRes ?? []) as { id: string; name: string; category_id: string | null }[]}
      existingColours={(existingColoursRes ?? []) as { id: string; material_id: string; name: string | null; code: string | null }[]}
      categoryNames={Object.fromEntries(categoryNames)}
    />
  )
}
