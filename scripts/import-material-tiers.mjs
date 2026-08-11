// Imports scripts/shopvox-material-tiers-output.json into PrintOS —
// same "actually plug it into PrintOS" behavior scripts/shopvox-extract.mjs
// already has for products, applied to materials.
//
// Writes:
//   material_pricing_tiers  — quantity-break tiers, one material's worth at a time
//   material_vendors        — vendor pricing rows, one material's worth at a time
//
// Matching: ShopVOX materials have no id stored on PrintOS materials (unlike
// products, which carry shopvox_data) — matched by exact case-insensitive
// name, same approach scrape-shopvox-material-tiers.js's own image backfill
// already uses.
//
// Per-material REPLACE semantics (delete-then-insert), matching the existing
// app convention in src/app/api/materials/[id]/pricing-tiers/import/route.ts
// (the "Import Tiers CSV" button does the same delete-all-then-insert-fresh
// for a material's tiers) — applied consistently to vendor pricing too. This
// makes re-running the importer against an updated output file safe and
// idempotent: each run converges each material to exactly what the latest
// scrape says, not an ever-growing pile of old + new rows.
//
// Tiers: only touched for materials that came back `found: true` in the
// scrape (both `tiered` and `flat` buckets — flat legitimately means "zero
// tiers," and gets its existing tiers cleared to match that). `retry`
// bucket records carry no usable data and are skipped entirely.
//
// Vendor pricing: ONLY touched for materials where vendor_pricing.found
// is exactly true. `found: false` (reason: no_grid_root, etc.) is treated
// as "we don't actually know" — could be a genuine material with no vendor
// tab data, or could be an extraction miss — not confirmed either way, so
// existing material_vendors rows for that material are left alone rather
// than risk wiping real data based on an ambiguous signal.
//
// KNOWN OPEN ITEM, handled explicitly: vendor rows are NOT uniquely keyed
// by (material_id, vendor_name) — confirmed live the same vendor (e.g.
// "Grimco") can appear more than once at different prices/ranks. Every row
// from vendor_pricing.rows is inserted as-is, with no de-dup/upsert-by-name
// logic — the delete-all-then-insert-fresh per material is what keeps this
// safe on re-runs, not a uniqueness constraint.
//
// to_qty normalization: ShopVOX represents "open-ended" tiers with a literal
// sentinel value of 100000 (confirmed live across all 6 real tiered
// materials scraped so far — every single one's top tier ends in exactly
// 100000, never blank). PrintOS's own tier UI/logic (src/lib/pricing-tiers.ts,
// pricing-matrix-section.tsx line ~289) specifically renders "+" and treats
// overlap-checking as open-ended ONLY when to_qty is null — a literal 100000
// would render as "100000" instead, which is misleading. Normalized here:
// to_qty === 100000 → null. Exact match only, not a fuzzy threshold — this
// is the confirmed sentinel, not a guessed range.
//
// Usage:
//   node scripts/import-material-tiers.mjs                 # real import
//   node scripts/import-material-tiers.mjs --dry-run        # preview only, no writes
//   node scripts/import-material-tiers.mjs --input=path.json

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')
const inputFlag = argv.find((a) => a.startsWith('--input='))
const INPUT_FILE = resolve(inputFlag ? inputFlag.slice('--input='.length) : 'scripts/shopvox-material-tiers-output.json')

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
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing Supabase env vars.'); process.exit(1) }
const ORG_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const OPEN_ENDED_SENTINEL = 100000
function normalizeToQty(v) {
  if (v === null || v === undefined) return null
  return v === OPEN_ENDED_SENTINEL ? null : v
}

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

async function main() {
  const startAt = Date.now()
  const raw = JSON.parse(readFileSync(INPUT_FILE, 'utf8'))
  const records = [...(raw.tiered ?? []), ...(raw.flat ?? [])]
  console.log(`Loaded ${INPUT_FILE}`)
  console.log(`  tiered: ${(raw.tiered ?? []).length}, flat: ${(raw.flat ?? []).length}, retry (skipped, no usable data): ${(raw.retry ?? []).length}`)
  if (DRY_RUN) console.log('  --dry-run: no writes will be made\n')

  const materials = await fetchAllRows((from, to) =>
    sb.from('materials').select('id, name').eq('organization_id', ORG_ID).order('id', { ascending: true }).range(from, to)
  )
  const byName = new Map(materials.map((m) => [m.name.toLowerCase().trim(), m]))
  console.log(`Loaded ${materials.length} PrintOS materials for name-matching.\n`)

  const stats = {
    processed: 0,
    unmatched: [],
    tiersTouched: 0, tiersInserted: 0, tiersDeleted: 0,
    vendorsTouched: 0, vendorRowsInserted: 0, vendorRowsDeleted: 0,
    vendorSkippedNotFound: 0,
    errors: [],
  }

  for (const rec of records) {
    stats.processed++
    const match = byName.get((rec.name || '').toLowerCase().trim())
    if (!match) { stats.unmatched.push(rec.name); continue }

    // ── material_pricing_tiers — always touched for found:true records
    // (tiered AND flat both count; flat correctly clears to zero tiers) ──
    try {
      const tierRows = (rec.tiers ?? []).map((t) => ({
        organization_id: ORG_ID,
        material_id: match.id,
        from_qty: t.from_qty,
        to_qty: normalizeToQty(t.to_qty),
        cost: t.cost,
        price: t.price,
      }))
      stats.tiersTouched++
      if (!DRY_RUN) {
        const delRes = await sb.from('material_pricing_tiers').delete().eq('material_id', match.id).eq('organization_id', ORG_ID)
        if (delRes.error) throw new Error(`tiers delete: ${delRes.error.message}`)
        if (tierRows.length > 0) {
          const insRes = await sb.from('material_pricing_tiers').insert(tierRows)
          if (insRes.error) throw new Error(`tiers insert: ${insRes.error.message}`)
        }
      }
      stats.tiersDeleted += 1 // per-material delete call, not a row count — see summary note
      stats.tiersInserted += tierRows.length
    } catch (e) {
      stats.errors.push({ name: rec.name, stage: 'tiers', error: e instanceof Error ? e.message : String(e) })
    }

    // ── material_vendors — only touched when found === true ──
    if (rec.vendor_pricing?.found !== true) { stats.vendorSkippedNotFound++; continue }
    try {
      const vendorRows = (rec.vendor_pricing.rows ?? []).map((v) => ({
        organization_id: ORG_ID,
        material_id: match.id,
        vendor_name: v.vendor_name,
        vendor_price: v.price,
        rank: v.rank,
        part_number: v.part_number,
        part_name: v.part_name,
        buying_units: v.units,
        delivery_fee: v.delivery_fee,
        image_url: v.image_url,
        info_url: v.info_url,
        width: v.width,
        length: v.length,
        sqft_price: v.sqft_price,
        quantity: v.quantity,
      }))
      stats.vendorsTouched++
      if (!DRY_RUN) {
        const delRes = await sb.from('material_vendors').delete().eq('material_id', match.id).eq('organization_id', ORG_ID)
        if (delRes.error) throw new Error(`vendors delete: ${delRes.error.message}`)
        if (vendorRows.length > 0) {
          const insRes = await sb.from('material_vendors').insert(vendorRows)
          if (insRes.error) throw new Error(`vendors insert: ${insRes.error.message}`)
        }
      }
      stats.vendorRowsDeleted += 1
      stats.vendorRowsInserted += vendorRows.length
    } catch (e) {
      stats.errors.push({ name: rec.name, stage: 'vendors', error: e instanceof Error ? e.message : String(e) })
    }
  }

  const elapsed = ((Date.now() - startAt) / 1000).toFixed(1)
  console.log('\n=========== RESULT ===========')
  console.log(JSON.stringify({
    processed: stats.processed,
    matched: stats.processed - stats.unmatched.length,
    unmatchedCount: stats.unmatched.length,
    materialsWithTiersTouched: stats.tiersTouched,
    tierRowsInserted: stats.tiersInserted,
    materialsWithVendorPricingWritten: stats.vendorsTouched,
    vendorRowsInserted: stats.vendorRowsInserted,
    vendorSkippedNotFound: stats.vendorSkippedNotFound,
    errors: stats.errors.length,
    elapsedSeconds: elapsed,
  }, null, 2))
  if (stats.unmatched.length > 0) {
    console.log('\nUnmatched (first 20):', JSON.stringify(stats.unmatched.slice(0, 20), null, 2))
  }
  if (stats.errors.length > 0) {
    console.log('\nErrors (first 20):', JSON.stringify(stats.errors.slice(0, 20), null, 2))
  }
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
