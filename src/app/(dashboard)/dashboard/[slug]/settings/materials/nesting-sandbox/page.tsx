import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { dbAllOrThrow, dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import { SettingsPageHeader } from '@/components/settings/settings-page-header'
import type { FixedSide } from '@/lib/nesting/nester'
import NestingSandboxClient, { type VariantOption } from './nesting-sandbox-client'

export const dynamic = 'force-dynamic'

const VALID_FIXED_SIDES: FixedSide[] = ['none', 'height', 'width', 'both']

type PageProps = { params: Promise<{ slug: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('materials-nesting-sandbox', err)
  }
}

// READ-ONLY page. No server action in this directory performs an INSERT,
// UPDATE, or DELETE against any table -- the nester itself is a pure
// function (src/lib/nesting/nester.ts) that runs entirely in the browser
// once this data is loaded; nothing computed here is ever written back.
// Same auth/org-scoping pattern as the neighbouring materials pages
// (materials/page.tsx, materials/families/page.tsx): the request-scoped,
// RLS-respecting client from createClient(), org resolved by slug, every
// list query paginated with dbAllOrThrow rather than trusting PostgREST's
// default 1000-row cap.
async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const [materials, variants, colours] = await Promise.all([
    // wastage_markup / calculate_wastage: confirmed live columns on
    // materials (010_product_builder_FIXED.sql:100 -- wastage_markup
    // numeric(8,4) DEFAULT 0, calculate_wastage boolean DEFAULT false;
    // re-added idempotently by 047 for an unrelated reason, same
    // columns). Verified against real data, not assumed: active
    // materials today carry wastage_markup values of 2 and 1.5, plus a
    // real population of NULL and 0 -- exactly the "don't silently
    // default this" cases the sandbox's waste line has to handle.
    // seam_overlap_width / seam_direction: migration 190, live and
    // verified (per instruction) -- public.materials.seam_overlap_width
    // numeric(8,4) NULL, public.materials.seam_direction text NULL,
    // CHECK'd to ('horizontal','vertical','both','none'). Every row is
    // currently NULL, no backfill -- fetched and passed through raw
    // below, same "never invent a default server-side" discipline as
    // wastage_markup/calculate_wastage.
    dbAllOrThrow<{
      id: string; name: string; fixed_side: string | null
      wastage_markup: number | null; calculate_wastage: boolean | null
      seam_overlap_width: number | null; seam_direction: string | null
    }>((from, to) =>
      supabase.from('materials')
        .select('id, name, fixed_side, wastage_markup, calculate_wastage, seam_overlap_width, seam_direction')
        .eq('organization_id', org.id)
        .eq('active', true)
        .order('name')
        .range(from, to)
    ),
    dbAllOrThrow<{
      id: string; material_id: string; color_id: string | null
      height: number | null; width: number | null
      base_cost: number | null; multiplier: number
      cost_per_unit: number | null; sell_per_unit: number | null
      fixed_side: string | null; length_increment: number | null
      length_uom: string; direction: string | null; source_name: string | null
    }>((from, to) =>
      supabase.from('material_variants')
        .select('id, material_id, color_id, height, width, base_cost, multiplier, cost_per_unit, sell_per_unit, fixed_side, length_increment, length_uom, direction, source_name')
        .eq('organization_id', org.id)
        .range(from, to)
    ),
    dbAllOrThrow<{ id: string; material_id: string; name: string }>((from, to) =>
      supabase.from('material_colors')
        .select('id, material_id, name')
        .eq('organization_id', org.id)
        .range(from, to)
    ),
  ])

  const materialsById = new Map(materials.map((m) => [m.id, m]))
  const colourNameById = new Map(colours.map((c) => [c.id, c.name]))

  // fixed_side = COALESCE(variant.fixed_side, material.fixed_side) --
  // same precedence the VERIFIED nesting-model report specifies (see
  // nester.ts's own header). A variant belonging to an inactive/missing
  // material, or one where NEITHER level has a valid fixed_side, is left
  // out of the picker entirely rather than guessed into a default mode --
  // there's no real geometry to run for it.
  const variantOptions: VariantOption[] = variants
    .map((v): VariantOption | null => {
      const mat = materialsById.get(v.material_id)
      if (!mat) return null
      const resolvedFixedSide = v.fixed_side ?? mat.fixed_side
      if (!resolvedFixedSide || !VALID_FIXED_SIDES.includes(resolvedFixedSide as FixedSide)) return null
      return {
        id: v.id,
        materialName: mat.name,
        colourName: v.color_id ? colourNameById.get(v.color_id) ?? null : null,
        height: v.height,
        width: v.width,
        lengthUom: v.length_uom,
        sourceName: v.source_name,
        fixedSide: resolvedFixedSide as FixedSide,
        lengthIncrement: v.length_increment,
        direction: v.direction,
        baseCost: v.base_cost,
        multiplier: v.multiplier,
        costPerUnit: v.cost_per_unit,
        sellPerUnit: v.sell_per_unit,
        // From the MATERIAL, not the variant -- materials.wastage_markup
        // / materials.calculate_wastage (see the query comment above).
        // Passed through raw, null and all -- the client is the one that
        // has to refuse to silently default a missing markup to 1.0.
        wastageMarkup: mat.wastage_markup,
        calculateWastage: mat.calculate_wastage ?? false,
        // Raw, null and all -- migration 190. Distinct from
        // variant.direction (grain, rotation) above; this is which way
        // SEAMS run, an unrelated concept read from the MATERIAL.
        seamOverlapWidth: mat.seam_overlap_width,
        seamDirection: mat.seam_direction,
      }
    })
    .filter((v): v is VariantOption => v !== null)
    .sort((a, b) => a.materialName.localeCompare(b.materialName) || (a.colourName ?? '').localeCompare(b.colourName ?? ''))

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/settings/materials`} className="hover:text-gray-700">Materials</Link>
        <span>/</span>
        <span className="text-gray-700">Nesting Sandbox</span>
      </div>

      <SettingsPageHeader
        title="Nesting Sandbox"
        description="Run a real job through the nester by hand and check its answer against what you know -- before it's ever allowed to influence a price. Read-only: nothing here is saved, and it isn't connected to quotes, products, or recipes."
      />

      <NestingSandboxClient variants={variantOptions} />
    </div>
  )
}
