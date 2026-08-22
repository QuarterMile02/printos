import { createClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import MigrateClient from './migrate-client'
import { buildFamilyProposals } from '@/lib/material-family-proposals'
import type { ShopvoxMaterialRow } from '@/lib/material-migrate-proposals'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

const SUBSTRATE_TYPE_NAME = 'Rigid Substrates- Sheets'

export default async function MaterialsMigratePage(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('materials-migrate', err)
  }
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string; slug: string } | null
  if (!org) notFound()

  // SUBSTRATES ONLY this pass (Build 1/1b scope) -- the family/colour
  // proposal rules in material-family-proposals.ts were validated
  // against this one type (Build 1b's report). Other ShopVOX material
  // types stay untouched on the ShopVOX side, just out of this screen.
  const substrateType = await dbOrThrow(
    supabase.from('material_types').select('id, name').eq('organization_id', org.id).eq('name', SUBSTRATE_TYPE_NAME).maybeSingle()
  ) as { id: string; name: string } | null

  const [rows, categoriesRes] = await Promise.all([
    substrateType
      ? dbOrThrow(
          supabase
            .from('shopvox_materials')
            .select('id, shopvox_id, name, material_type_id, category_id, width, height, sheet_cost, cost, price, multiplier, preferred_vendor, part_number, sku, po_description, info_url, image_url, description, vendor_pricing, status, migrated_to_material_id, migrated_at, source_hash, migrated_source_hash, dismissed_at')
            .eq('organization_id', org.id)
            .eq('material_type_id', substrateType.id)
            .order('name')
        )
      : Promise.resolve([]),
    dbOrThrow(supabase.from('material_categories').select('id, name').eq('organization_id', org.id)),
  ])

  const typedRows = (rows ?? []) as unknown as (ShopvoxMaterialRow & {
    migrated_to_material_id: string | null
    migrated_at: string | null
    source_hash: string
    migrated_source_hash: string | null
    dismissed_at: string | null
  })[]

  const categoryNames = new Map(((categoriesRes ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]))

  const newRows = typedRows.filter((r) => r.status === 'NEW')
  const proposals = buildFamilyProposals(newRows, categoryNames)

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
      substrateTypeFound={!!substrateType}
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
