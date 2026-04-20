// Extract ShopVOX reference data into products.shopvox_data from local CSV exports.
//
// Source: CSV exports in C:\printos\data\
//   Shopvox_Product_List_Export_4526.csv — per-product basic + pricing
//   QMI_Labor_Rates.csv, QMI_Machine_Rates.csv, QMI_Material_Types.csv,
//   QMI_Modifiers.csv, Material_Export_List_4526.csv — master lists used only
//     for reporting coverage; ShopVOX does not expose per-product recipes in
//     these exports, so modifiers / dropdown_menus / default_items stay empty.
//
// Idempotent: only processes products where shopvox_data IS NULL.
// Safe to re-run — the Banner Regular seed stays untouched.
//
// Usage:  node scripts/extract-shopvox-products.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const dataDir = resolve(repoRoot, 'data')

// ── Load .env.local ───────────────────────────────────────────────────
const envText = readFileSync(resolve(repoRoot, '.env.local'), 'utf8')
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
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const ORG_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── CSV parser (RFC 4180: quoted fields, "" escapes, CRLF/LF) ─────────
function parseCsv(input) {
  const rows = []
  let row = [], field = '', inQuotes = false, i = 0
  if (input.charCodeAt(0) === 0xfeff) i = 1
  while (i < input.length) {
    const ch = input[i]
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === ',') { row.push(field); field = ''; i++; continue }
    if (ch === '\r') { row.push(field); rows.push(row); row = []; field = ''; i += input[i + 1] === '\n' ? 2 : 1; continue }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += ch; i++
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop()
  return rows
}

function loadCsv(relPath) {
  const text = readFileSync(resolve(dataDir, relPath), 'utf8')
  const rows = parseCsv(text)
  if (rows.length === 0) return { header: [], rows: [] }
  const headerRaw = rows[0].map(h => h.trim())
  const data = rows.slice(1).map(r => {
    const obj = {}
    for (let i = 0; i < headerRaw.length; i++) obj[headerRaw[i]] = (r[i] ?? '').trim()
    return obj
  })
  return { header: headerRaw, rows: data }
}

// ── Helpers ───────────────────────────────────────────────────────────
const normName = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
const blankToNull = (v) => (v === undefined || v === null || v === '' ? null : v)
const stripHtml = (s) => (s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim()

function truthy(v) {
  if (v == null) return null
  const s = String(v).trim().toLowerCase()
  if (s === 'yes' || s === 'true' || s === '1') return true
  if (s === 'no'  || s === 'false'|| s === '0') return false
  return null
}

// ── Load CSVs ─────────────────────────────────────────────────────────
console.log('Loading CSV files from', dataDir)

const productCsv = loadCsv('Shopvox_Product_List_Export_4526.csv')
const laborCsv   = loadCsv('QMI_Labor_Rates.csv')
const machineCsv = loadCsv('QMI_Machine_Rates.csv')
const modsCsv    = loadCsv('QMI_Modifiers.csv')
const typesCsv   = loadCsv('QMI_Material_Types.csv')
const matsCsv    = loadCsv('Material_Export_List_4526.csv')

console.log(`  Shopvox products: ${productCsv.rows.length}`)
console.log(`  Labor rates:      ${laborCsv.rows.length}`)
console.log(`  Machine rates:    ${machineCsv.rows.length}`)
console.log(`  Modifiers:        ${modsCsv.rows.length}`)
console.log(`  Material types:   ${typesCsv.rows.length}`)
console.log(`  Materials:        ${matsCsv.rows.length}`)

// ── Build per-product lookup from Shopvox CSV ────────────────────────
// The Shopvox export may contain duplicate names for variants — first one wins.
const shopvoxByName = new Map()
for (const r of productCsv.rows) {
  const key = normName(r['Product Name'])
  if (!key) continue
  if (!shopvoxByName.has(key)) shopvoxByName.set(key, r)
}
console.log(`  Unique shopvox product names: ${shopvoxByName.size}`)

// Master-list maps — used for optional coverage reporting only.
const modifierByLookup = new Map()
for (const m of modsCsv.rows) {
  const key = normName(m['System Lookup Name'] || m['Display Name'])
  if (key) modifierByLookup.set(key, m)
}

// ── Build shopvox_data JSON from a CSV row ───────────────────────────
function buildShopvoxData(row) {
  const descriptionHtml = row['Product Description'] || ''
  const descriptionPlain = stripHtml(descriptionHtml)
  return {
    basic: {
      name: row['Product Name'] || null,
      display_name: descriptionPlain ? descriptionPlain.slice(0, 200) : null,
      type: blankToNull(row['Type']),
      workflow: blankToNull(row['Workflow Template']),
      category: blankToNull(row['Category']),
      secondary_category: blankToNull(row['Secondary Category']),
    },
    pricing: {
      pricing_type: blankToNull(row['Pricing Type']),
      formula: blankToNull(row['Formula']),
      pricing_method: blankToNull(row['Pricing Method']),
      buying_units: blankToNull(row['Buying Units']),
      range_discount: blankToNull(row['Range Discount']),
      volume_discount: blankToNull(row['Volume Discount']),
      // apply_discounts / apply_range_discount_for_qty aren't in this CSV
      apply_discounts: null,
      apply_range_discount_for_qty: null,
    },
    // Per-product recipes aren't exported by ShopVOX in these CSVs — left empty
    // so the migration UI treats the product as "not yet deeply extracted".
    modifiers: [],
    dropdown_menus: [],
    default_items: [],
    // Extras kept for traceability / future passes
    _extra: {
      cost_usd: blankToNull(row['Cost ($)']),
      price_usd: blankToNull(row['Price ($)']),
      markup_x: blankToNull(row['Markup (X)']),
      part_number: blankToNull(row['Part Number']),
      units: blankToNull(row['Units']),
      active: truthy(row['Active']),
      published: truthy(row['Published']),
      production_details: blankToNull(row['Production Details']),
      video_url: blankToNull(row['Video URL']),
      image_url: blankToNull(row['Image URL']),
      source: 'Shopvox_Product_List_Export_4526.csv',
    },
  }
}

// ── Fetch products needing extraction ────────────────────────────────
async function fetchPendingProducts() {
  const pageSize = 1000
  const out = []
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1
    const { data, error } = await sb
      .from('products')
      .select('id, name, migration_status, shopvox_data')
      .eq('organization_id', ORG_ID)
      .is('shopvox_data', null)
      .order('name', { ascending: true })
      .range(from, to)
    if (error) throw new Error(`Fetch failed: ${error.message}`)
    const page = data || []
    out.push(...page)
    if (page.length < pageSize) break
  }
  return out
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const startedAt = Date.now()
  console.log('\nFetching products with shopvox_data IS NULL from Supabase...')
  const pending = await fetchPendingProducts()
  console.log(`  Found: ${pending.length}`)

  if (pending.length === 0) {
    console.log('Nothing to do. Exiting.')
    return
  }

  const BATCH = 50
  let matched = 0, missing = 0, failed = 0
  const missingNames = []

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH)

    // Prepare updates for this batch
    const updates = []
    for (let j = 0; j < batch.length; j++) {
      const product = batch[j]
      const overallIdx = i + j + 1
      const csvRow = shopvoxByName.get(normName(product.name))
      if (!csvRow) {
        missing++
        missingNames.push(product.name)
        console.log(`  ${overallIdx}/${pending.length}  MISS  ${product.name}`)
        continue
      }
      const shopvoxData = buildShopvoxData(csvRow)
      const coverage = [
        shopvoxData.basic.type ? 'type' : null,
        shopvoxData.basic.workflow ? 'workflow' : null,
        shopvoxData.basic.category ? 'category' : null,
        shopvoxData.pricing.pricing_type ? 'pricing_type' : null,
        shopvoxData.pricing.formula ? 'formula' : null,
        shopvoxData.pricing.range_discount ? 'range_discount' : null,
      ].filter(Boolean)
      console.log(`  ${overallIdx}/${pending.length}  OK    ${product.name}  [${coverage.join(',') || 'basic only'}]`)
      matched++
      updates.push({ id: product.id, shopvoxData })
    }

    // Run the batch's updates in parallel
    const results = await Promise.all(updates.map(async (u) => {
      const { error } = await sb
        .from('products')
        .update({ shopvox_data: u.shopvoxData, migration_status: 'shopvox_reference' })
        .eq('id', u.id)
        .eq('organization_id', ORG_ID)
      return { id: u.id, error }
    }))
    for (const r of results) {
      if (r.error) { failed++; console.warn(`    ! update failed for ${r.id}: ${r.error.message}`) }
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log('\n──────────────── Summary ────────────────')
  console.log(`  Pending products scanned: ${pending.length}`)
  console.log(`  Matched in Shopvox CSV:   ${matched}`)
  console.log(`  Missing (no CSV row):     ${missing}`)
  console.log(`  Update failures:          ${failed}`)
  console.log(`  Elapsed:                  ${elapsed}s`)
  if (missing > 0) {
    console.log('\n  First 20 missing product names:')
    for (const n of missingNames.slice(0, 20)) console.log(`    - ${n}`)
    if (missing > 20) console.log(`    ... and ${missing - 20} more`)
  }
  console.log('\nDone. Re-run anytime — only products with shopvox_data IS NULL are touched.')
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1) })
