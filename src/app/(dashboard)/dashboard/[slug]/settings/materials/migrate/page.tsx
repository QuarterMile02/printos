import { createClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import MigrateClient from './migrate-client'
import { buildSubstrateProposals, type ShopvoxMaterialRow } from '@/lib/material-migrate-proposals'

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

  // SUBSTRATES ONLY this pass (Build 1 scope) -- the proposal rules in
  // material-migrate-proposals.ts were validated against this one type
  // (Finding A). Other ShopVOX material types stay untouched on the
  // ShopVOX side; nothing here filters them out of shopvox_materials
  // itself, just out of this screen.
  const substrateType = await dbOrThrow(
    supabase.from('material_types').select('id, name').eq('organization_id', org.id).eq('name', SUBSTRATE_TYPE_NAME).maybeSingle()
  ) as { id: string; name: string } | null

  const rows = substrateType
    ? await dbOrThrow(
        supabase
          .from('shopvox_materials')
          .select('id, shopvox_id, name, material_type_id, category_id, width, height, sheet_cost, cost, price, multiplier, preferred_vendor, part_number, sku, po_description, info_url, image_url, description, vendor_pricing, status, migrated_to_material_id, migrated_at, source_hash, migrated_source_hash')
          .eq('organization_id', org.id)
          .eq('material_type_id', substrateType.id)
          .order('name')
      )
    : []

  const typedRows = (rows ?? []) as unknown as (ShopvoxMaterialRow & {
    migrated_to_material_id: string | null
    migrated_at: string | null
    source_hash: string
    migrated_source_hash: string | null
  })[]

  const newRows = typedRows.filter((r) => r.status === 'NEW')
  const proposals = buildSubstrateProposals(newRows)

  // For CHANGED rows, load the linked material's current values so the
  // client can render a field-by-field diff (ShopVOX now vs. PrintOS
  // current) before Ruben chooses what to carry over.
  const changedRows = typedRows.filter((r) => r.status === 'CHANGED')
  const linkedMaterialIds = [...new Set(changedRows.map((r) => r.migrated_to_material_id).filter(Boolean))] as string[]
  const linkedMaterials = linkedMaterialIds.length
    ? await dbOrThrow(
        supabase
          .from('materials')
          .select('id, name, width, height, sheet_cost, cost, price, multiplier, preferred_vendor, part_number, sku, po_description, info_url, description')
          .in('id', linkedMaterialIds)
      )
    : []

  const migratedRows = typedRows.filter((r) => r.status === 'MIGRATED')
  const migratedMaterialIds = [...new Set(migratedRows.map((r) => r.migrated_to_material_id).filter(Boolean))] as string[]
  const migratedMaterialNames = migratedMaterialIds.length
    ? await dbOrThrow(supabase.from('materials').select('id, name').in('id', migratedMaterialIds))
    : []

  return (
    <MigrateClient
      orgId={org.id}
      orgSlug={slug}
      substrateTypeFound={!!substrateType}
      rows={typedRows}
      proposals={proposals}
      linkedMaterials={(linkedMaterials ?? []) as Record<string, unknown>[]}
      migratedMaterialNames={(migratedMaterialNames ?? []) as { id: string; name: string }[]}
    />
  )
}
