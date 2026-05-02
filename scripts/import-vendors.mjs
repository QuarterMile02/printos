/**
 * import-vendors.mjs
 *
 * Imports ShopVOX vendor export into PrintOS vendors table.
 *
 * Usage:
 *   node scripts/import-vendors.mjs
 *
 * Source file: Docs/Vendor export_04302026_143433_4-30-26.xls
 * Dedup key:   (organization_id, name)  ← UNIQUE constraint on vendors table
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import XLSX from 'xlsx'

// ── Env ──────────────────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const env = readFileSync(join(root, '.env.local'), 'utf8')
const vars = Object.fromEntries(
  env.split('\n').filter(l => l.includes('=')).map(l => {
    const idx = l.indexOf('=')
    return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()]
  })
)
const sb = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY)

const ORG_SLUG = 'quarter-mile-inc'
const XLS_FILE = join(root, 'Docs', 'Vendor export_04302026_143433_4-30-26.xls')
const BATCH_SIZE = 50

// ── Helpers ───────────────────────────────────────────────────────────────────
function t(val) {
  if (val == null) return null
  const s = String(val).trim()
  return s || null
}

function parseBool(val, defaultVal = true) {
  if (val == null) return defaultVal
  const s = String(val).trim().toLowerCase()
  if (s === 'yes' || s === 'true' || s === '1') return true
  if (s === 'no' || s === 'false' || s === '0') return false
  return defaultVal
}

// ── Main ──────────────────────────────────────────────────────────────────────
if (!existsSync(XLS_FILE)) {
  console.error(`\n❌  Source file not found: ${XLS_FILE}`)
  console.error('    Drop the ShopVOX vendor export into the Docs/ folder and retry.\n')
  process.exit(1)
}

// 1. Resolve org
const { data: org, error: orgErr } = await sb
  .from('organizations').select('id').eq('slug', ORG_SLUG).maybeSingle()
if (orgErr || !org) { console.error('Org not found:', orgErr?.message); process.exit(1) }
const orgId = org.id
console.log(`\n✅  Org resolved: ${orgId}`)

// 2. Read XLS
const wb = XLSX.read(readFileSync(XLS_FILE), { type: 'buffer' })
const ws = wb.Sheets[wb.SheetNames[0]]
const rawRows = XLSX.utils.sheet_to_json(ws, { defval: null })
console.log(`📄  Rows in file: ${rawRows.length}`)

// 3. Build upsert payloads
const now = new Date().toISOString()
const payloads = []

for (const raw of rawRows) {
  const name = t(raw['Name'])
  if (!name) continue

  payloads.push({
    organization_id: orgId,
    name,
    legal_name: t(raw['Legal Name']),
    primary_contact: t(raw['Primary Contact']),
    primary_email: t(raw['Primary Email']),
    primary_phone: t(raw['Primary Phone']),
    street: t(raw['Address Street']),
    city: t(raw['Address City']),
    state: t(raw['Address State']),
    zip: t(raw['Address Zip']) ? String(raw['Address Zip']).trim() : null,
    country: t(raw['Address Country']),
    secondary_street: t(raw['Secondary Street']),
    secondary_city: t(raw['Secondary City']),
    secondary_state: t(raw['Secondary State']),
    secondary_zip: t(raw['Secondary ZIP']) ? String(raw['Secondary ZIP']).trim() : null,
    website: t(raw['Website']),
    catalog_url: t(raw['Catalog Url']),
    account_id: t(raw['Your account ID']),
    tax_id: t(raw['Tax Id']),
    tax: t(raw['Tax']),
    terms: t(raw['Terms']),
    payment_method: t(raw['Payment Method']),
    categories: t(raw['Categories']),
    hours_of_operation: t(raw['Hours Of Operation']),
    background_info: t(raw['Background Info']),
    is_active: parseBool(raw['Enabled'], true),
    shopvox_imported_at: now,
  })
}

console.log(`📊  Vendors to upsert: ${payloads.length}`)

// 4. Upsert in batches — UNIQUE (organization_id, name) lets us target the conflict
let upserted = 0, errors = 0

for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
  const batch = payloads.slice(i, i + BATCH_SIZE)
  const { error } = await sb
    .from('vendors')
    .upsert(batch, { onConflict: 'organization_id,name', ignoreDuplicates: false })
  if (error) {
    console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message)
    errors += batch.length
  } else {
    upserted += batch.length
    process.stdout.write(`\r  Upserting... ${upserted}/${payloads.length}`)
  }
}
console.log()

// 5. Summary
console.log('\n══════════════════════════════════════')
console.log('  VENDOR IMPORT COMPLETE')
console.log('══════════════════════════════════════')
console.log(`  Upserted (insert/update) : ${upserted}`)
console.log(`  Errors                   : ${errors}`)
console.log('══════════════════════════════════════\n')
