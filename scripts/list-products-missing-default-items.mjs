// List products affected by the pre-c15d09b browser-extractor boundary bug.
//
// Symptom: shopvox_data has non-empty modifiers OR dropdown_menus but an
// empty default_items array — rows that belonged to Default Items got
// routed into the Product Template bucket and silently discarded.
//
// Usage:
//   node scripts/list-products-missing-default-items.mjs            # print table + URL list
//   node scripts/list-products-missing-default-items.mjs --json     # machine-readable
//   node scripts/list-products-missing-default-items.mjs --limit=20 # first 20 rows

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

// ── .env.local loader ───────────────────────────────────────────────
const envText = readFileSync(resolve(repoRoot, '.env.local'), 'utf8')
const env = {}
for (const raw of envText.split(/\r?\n/)) {
  const line = raw.trim()
  if (!line || line.startsWith('#')) continue
  const eq = line.indexOf('=')
  if (eq === -1) continue
  const k = line.slice(0, eq).trim()
  let v = line.slice(eq + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1)
  }
  env[k] = v
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const ORG_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'
const SHOPVOX_BASE = 'https://express.shopvox.com/settings/products'
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── Flags ───────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const limitFlag = argv.find((a) => a.startsWith('--limit='))
const limit = limitFlag ? Math.max(0, parseInt(limitFlag.split('=')[1], 10)) : null

// ── Query ───────────────────────────────────────────────────────────
const pageSize = 1000
const all = []
for (let from = 0; ; from += pageSize) {
  const { data, error } = await sb
    .from('products')
    .select('id, name, shopvox_data')
    .eq('organization_id', ORG_ID)
    .not('shopvox_data', 'is', null)
    .order('name')
    .range(from, from + pageSize - 1)
  if (error) { console.error('Fetch:', error.message); process.exit(1) }
  all.push(...(data ?? []))
  if ((data ?? []).length < pageSize) break
}

const nonEmpty = (a) => Array.isArray(a) && a.length > 0
const affected = all.filter((p) => {
  const sv = p.shopvox_data ?? {}
  const hasMods = nonEmpty(sv.modifiers)
  const hasDrop = nonEmpty(sv.dropdown_menus)
  const hasItems = nonEmpty(sv.default_items)
  return (hasMods || hasDrop) && !hasItems
})

// Build rows with the ShopVOX UUID (from shopvox_data.id) + URL for re-extraction.
const rows = affected.map((p) => {
  const svId = p.shopvox_data?.id ?? null
  return {
    id: p.id,
    name: p.name,
    shopvox_id: svId,
    shopvox_url: svId ? `${SHOPVOX_BASE}/${svId}` : null,
    modifiers: (p.shopvox_data?.modifiers ?? []).length,
    dropdown_menus: (p.shopvox_data?.dropdown_menus ?? []).length,
    default_items: (p.shopvox_data?.default_items ?? []).length,
  }
})

if (asJson) {
  const out = limit ? rows.slice(0, limit) : rows
  console.log(JSON.stringify({ total_scanned: all.length, affected: rows.length, products: out }, null, 2))
  process.exit(0)
}

console.log(`Scanned ${all.length} org products with non-null shopvox_data.`)
console.log(`Affected (non-empty modifiers or dropdown_menus, empty default_items): ${rows.length}\n`)

const preview = limit ? rows.slice(0, limit) : rows.slice(0, 20)
const nameW = Math.min(60, Math.max(12, ...preview.map((r) => r.name.length)))
console.log(`${'#'.padStart(3)}  ${'Name'.padEnd(nameW)}  mods  dd  items  url`)
console.log(`${'---'.padStart(3)}  ${'-'.repeat(nameW)}  ----  --  -----  ---`)
preview.forEach((r, i) => {
  const name = r.name.length > nameW ? r.name.slice(0, nameW - 1) + '…' : r.name.padEnd(nameW)
  const m = String(r.modifiers).padStart(4)
  const d = String(r.dropdown_menus).padStart(2)
  const it = String(r.default_items).padStart(5)
  const url = r.shopvox_url ?? '(no shopvox_data.id)'
  console.log(`${String(i + 1).padStart(3)}  ${name}  ${m}  ${d}  ${it}  ${url}`)
})
if (rows.length > preview.length) {
  console.log(`\n… +${rows.length - preview.length} more (use --json for full list)`)
}
