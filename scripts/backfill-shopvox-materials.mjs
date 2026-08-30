// Backfills public.shopvox_materials from the CURRENT CONTENTS of
// public.materials — material redesign Build 1, item 11.
//
// Rationale (from the instruction): the scraper has always written
// straight into public.materials, so the 1,788 materials sitting there
// today ARE the scrape, just merged in-place instead of staged. This
// backfill gives every one of them a shopvox_materials row so the
// migrate screen's NEW/MIGRATED/CHANGED tabs have something to compare
// future re-scrapes against, instead of starting from zero.
//
// shopvox_id source: materials carry no ShopVOX id of their own (that's
// the whole reason this table needs a backfill, not a trivial 1:1 copy)
// — so this joins by exact case-insensitive name against
// scripts/shopvox-material-tiers-output.json, the last real scrape run
// (2026-08-14, 1,785 records, every one carrying uuid+name — confirmed
// via a direct check before writing this script, see the Build 1 report).
// A material with no name match in that file gets NO shopvox_materials
// row at all (shopvox_id is NOT NULL on that table — there is nothing
// to backfill it with). Reported, not silently skipped.
//
// FIXED 2026-08-21 (caught by Ruben before this was run against
// production data — the live table has already been cleared of the
// three columns below, no data fix needed, script-only): this
// previously set migrated_to_material_id/migrated_at/migrated_source_
// hash on every backfilled row, so every row's derived status came out
// MIGRATED and the migrate screen's NEW tab started empty — the exact
// opposite of the point of this backfill. Seeding shopvox_materials
// means "this is what ShopVOX has" — that's unmigrated BY DEFINITION.
// The link is created when Ruben ACCEPTS a proposal on the migrate
// screen (acceptSubstrateProposal in migrate/actions.ts), never by this
// script. Backfilled rows are left with all three of those columns
// NULL, same as any other freshly-scraped row — they land in NEW, and
// Ruben's migrate-screen accept is what moves them to MIGRATED (setting
// migrated_source_hash to the row's CURRENT source_hash at accept time,
// which is what makes a later re-scrape correctly flip a changed row to
// CHANGED instead of leaving it silently stuck at MIGRATED forever).
//
// DOES NOT touch public.materials. Delete nothing, ever — this only
// inserts into shopvox_materials.
//
// PREREQUISITE: migration 179 (shopvox_materials) must already be live.
// This script does NOT run migrations. Default mode is --dry-run (no
// writes) so it's safe to run for reporting before 179 has even been
// pasted, though the real INSERT obviously can't succeed until the
// table exists.
//
// Usage:
//   node scripts/backfill-shopvox-materials.mjs               # dry-run (default) — report only, no writes
//   node scripts/backfill-shopvox-materials.mjs --execute      # real insert — requires migration 179 already applied

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const argv = process.argv.slice(2)
const EXECUTE = argv.includes('--execute')
const TIERS_FILE = resolve('scripts/shopvox-material-tiers-output.json')

const envText = readFileSync(resolve('.env.local'), 'utf8')
const env = {}
for (const raw of envText.split(/\r?\n/)) {
  const line = raw.trim()
  if (!line || line.startsWith('#')) continue
  const eq = line.indexOf('=')
  if (eq === -1) continue
  const k = line.slice(0, eq).trim()
  let v = line.slice(eq + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  env[k] = v
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const ORG_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'

const PAGE_SIZE = 1000
async function fetchAllRows(build) {
  const all = []
  let from = 0
  for (;;) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

function computeSourceHash(payload) {
  const stable = JSON.stringify(payload, Object.keys(payload).sort())
  return createHash('sha256').update(stable).digest('hex')
}

async function main() {
  console.log(EXECUTE ? 'EXECUTE mode — will insert rows.' : 'DRY-RUN (default) — reporting only, no writes. Pass --execute to actually insert.')

  const tiersRaw = JSON.parse(readFileSync(TIERS_FILE, 'utf8'))
  const uuidByName = new Map(
    [...(tiersRaw.tiered ?? []), ...(tiersRaw.flat ?? []), ...(tiersRaw.retry ?? [])]
      .filter((r) => r.uuid && r.name)
      .map((r) => [r.name.toLowerCase().trim(), r.uuid])
  )
  console.log(`Loaded ${uuidByName.size} distinct (name -> shopvox uuid) pairs from ${TIERS_FILE}.`)

  const materials = await fetchAllRows((from, to) =>
    sb.from('materials').select('*').eq('organization_id', ORG_ID).order('id', { ascending: true }).range(from, to)
  )
  console.log(`Loaded ${materials.length} public.materials rows for org ${ORG_ID}.`)

  const rows = []
  const unmatched = []
  for (const m of materials) {
    const shopvoxId = uuidByName.get((m.name || '').toLowerCase().trim())
    if (!shopvoxId) { unmatched.push(m.name); continue }

    const hashPayload = {
      name: m.name, material_type_id: m.material_type_id, category_id: m.category_id,
      width: m.width, height: m.height, sheet_cost: m.sheet_cost, cost: m.cost, price: m.price,
      multiplier: m.multiplier, weight: m.weight, preferred_vendor: m.preferred_vendor,
      part_number: m.part_number, sku: m.sku, po_description: m.po_description,
      info_url: m.info_url, image_url: m.image_url, description: m.description,
    }
    const source_hash = computeSourceHash(hashPayload)
    const now = new Date().toISOString()

    rows.push({
      organization_id: ORG_ID,
      shopvox_id: shopvoxId,
      name: m.name,
      shopvox_status: m.active ? 'enabled' : 'disabled', // best available proxy — no ShopVOX-side status carried on materials today
      material_type_id: m.material_type_id ?? null,
      category_id: m.category_id ?? null,
      material_type_raw: null, // not recoverable from materials alone — no raw ShopVOX label text stored on this row
      category_raw: null,
      width: m.width ?? null,
      height: m.height ?? null,
      sheet_cost: m.sheet_cost ?? null,
      cost: m.cost ?? null,
      price: m.price ?? null,
      multiplier: m.multiplier ?? null,
      weight: m.weight ?? null,
      preferred_vendor: m.preferred_vendor ?? null,
      part_number: m.part_number ?? null,
      sku: m.sku ?? null,
      po_description: m.po_description ?? null,
      info_url: m.info_url ?? null,
      image_url: m.image_url ?? null,
      description: m.description ?? null,
      fields: {}, // no raw 39-field capture survives for a backfilled row — only what materials itself stores
      vendor_pricing: [],
      pricing_tiers: [],
      source_hash,
      scraped_at: m.last_price_update ?? m.updated_at ?? now,
      // migrated_to_material_id / migrated_at / migrated_source_hash:
      // deliberately NOT set here — see header comment. Left NULL, same
      // as any other unmigrated row; status derives to NEW.
    })
  }

  console.log('\n=========== RESULT ===========')
  console.log(JSON.stringify({
    totalMaterials: materials.length,
    matchedWithShopvoxId: rows.length,
    unmatchedCount: unmatched.length,
  }, null, 2))
  if (unmatched.length > 0) {
    console.log(`\nUnmatched (no shopvox uuid found by name, first 20 of ${unmatched.length}):`, JSON.stringify(unmatched.slice(0, 20), null, 2))
  }

  if (!EXECUTE) {
    console.log('\nDry-run only — nothing written. Re-run with --execute once migration 179 is live.')
    return
  }

  const BATCH = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { error } = await sb.from('shopvox_materials').upsert(batch, { onConflict: 'organization_id,shopvox_id' })
    if (error) { console.error(`Batch ${i}-${i + batch.length} failed: ${error.message}`); continue }
    inserted += batch.length
    console.log(`  inserted/upserted ${inserted}/${rows.length}`)
  }
  console.log(`\nDone. ${inserted}/${rows.length} rows written to shopvox_materials.`)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
