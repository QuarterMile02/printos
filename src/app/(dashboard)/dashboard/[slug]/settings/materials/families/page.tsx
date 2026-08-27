import { createClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import { dbOrThrow, dbAllOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import FamiliesClient from './families-client'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function MaterialFamiliesPage(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('material-families', err)
  }
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string; slug: string } | null
  if (!org) notFound()

  // Everything this screen needs is loaded once, up front, and every
  // bucket (Families / Not in a family / Disabled · legacy) is computed
  // CLIENT-SIDE from this one payload -- switching a slot's dropdown
  // never round-trips to the server. That only works if nothing here can
  // silently truncate: PostgREST caps an unbounded select at 1000 rows,
  // and this org alone has 1,788 disabled materials -- every query below
  // uses dbAllOrThrow, explicit .range() pagination, no exceptions.
  const [types, materials, variants, colours, recipeRefs, vendorRefs] = await Promise.all([
    dbAllOrThrow<{ id: string; name: string }>((from, to) =>
      supabase.from('material_types').select('id, name').eq('organization_id', org.id).eq('is_active', true).order('name').range(from, to)
    ),
    dbAllOrThrow<{
      id: string; name: string; active: boolean; material_type_id: string | null
      formula: string | null; show_external: boolean | null; length_uom: string
      cost: number | null; price: number | null
    }>((from, to) =>
      supabase.from('materials')
        .select('id, name, active, material_type_id, formula, show_external, length_uom, cost, price')
        .eq('organization_id', org.id).order('name').range(from, to)
    ),
    dbAllOrThrow<{
      id: string; material_id: string; color_id: string | null
      width: number | null; height: number | null; base_cost: number | null
      multiplier: number; cost_per_unit: number | null; sell_per_unit: number | null
      is_default: boolean; length_uom: string; source_name: string | null
    }>((from, to) =>
      supabase.from('material_variants')
        .select('id, material_id, color_id, width, height, base_cost, multiplier, cost_per_unit, sell_per_unit, is_default, length_uom, source_name')
        .eq('organization_id', org.id).range(from, to)
    ),
    dbAllOrThrow<{ id: string; material_id: string; name: string; code: string | null }>((from, to) =>
      supabase.from('material_colors').select('id, material_id, name, code').eq('organization_id', org.id).range(from, to)
    ),
    // Delete-safety, bucket 1 of 2: any product_default_items row keeps a
    // material un-deletable at the DB level -- material_id has no
    // ON DELETE action (010_product_builder_FIXED.sql:244), so a real
    // delete there would be rejected outright, not just inadvisable.
    dbAllOrThrow<{ material_id: string | null }>((from, to) =>
      supabase.from('product_default_items').select('material_id').eq('organization_id', org.id).eq('item_type', 'Material').range(from, to)
    ),
    // Delete-safety, bucket 2 of 2: material_vendors IS ON DELETE CASCADE
    // (010_product_builder_FIXED.sql:123) -- a delete would physically
    // succeed but silently take that material's vendor pricing history
    // with it. Same reference-check shape as the existing single-material
    // delete guard (settings/materials/actions-sr.ts's deleteMaterial),
    // extended with this second table per instruction.
    dbAllOrThrow<{ material_id: string | null }>((from, to) =>
      supabase.from('material_vendors').select('material_id').range(from, to)
    ),
  ])

  const recipeRefCounts = new Map<string, number>()
  for (const r of recipeRefs) {
    if (!r.material_id) continue
    recipeRefCounts.set(r.material_id, (recipeRefCounts.get(r.material_id) ?? 0) + 1)
  }
  const vendorRefCounts = new Map<string, number>()
  for (const r of vendorRefs) {
    if (!r.material_id) continue
    // material_vendors has no organization_id filter above (it's scoped
    // via material_id -> materials.organization_id instead) -- only counts
    // for materials that belong to THIS org are ever looked up client-side,
    // so a foreign-org material_id here is simply never read.
    vendorRefCounts.set(r.material_id, (vendorRefCounts.get(r.material_id) ?? 0) + 1)
  }

  return (
    <FamiliesClient
      orgId={org.id}
      orgSlug={slug}
      types={types}
      materials={materials}
      variants={variants}
      colours={colours}
      recipeRefCounts={Object.fromEntries(recipeRefCounts)}
      vendorRefCounts={Object.fromEntries(vendorRefCounts)}
    />
  )
}
