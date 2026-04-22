// Import one or more JSON files produced by scripts/shopvox-browser-extract.js
// and merge their recipe data (modifiers / dropdown_menus / default_items)
// into products.shopvox_data on Supabase.
//
// Usage:
//   node scripts/import-browser-extract.mjs file1.json file2.json …
//
// Per-product flow:
//   1. Match Supabase product by shopvox_data->>'id' OR name ILIKE …
//   2. Merge recipe arrays into existing shopvox_data (keep basic + pricing)
//   3. Log ✓ / ✗ / ⟳ per product + final summary.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

// ── .env.local loader ────────────────────────────────────────────────
function loadEnv() {
  const text = readFileSync(resolve(repoRoot, '.env.local'), 'utf8')
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const k = line.slice(0, eq).trim()
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[k] = v
  }
  return out
}

const env = loadEnv()
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const ORG_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── CLI args ─────────────────────────────────────────────────────────
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (files.length === 0) {
  console.error('Usage: node scripts/import-browser-extract.mjs file1.json [file2.json …]')
  process.exit(1)
}

// ── Helpers ──────────────────────────────────────────────────────────
const nonEmpty = (a) => Array.isArray(a) && a.length > 0
function hasRecipe(p) {
  return nonEmpty(p.modifiers) || nonEmpty(p.dropdown_menus) || nonEmpty(p.default_items)
}

async function findMatch(shopvoxId, name) {
  if (shopvoxId) {
    const { data, error } = await sb
      .from('products')
      .select('id, name, shopvox_data')
      .eq('organization_id', ORG_ID)
      .eq('shopvox_data->>id', shopvoxId)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`lookup by shopvox_data.id: ${error.message}`)
    if (data) return { row: data, matchedBy: 'shopvox_data.id' }
  }
  if (name && name.trim()) {
    const { data, error } = await sb
      .from('products')
      .select('id, name, shopvox_data')
      .eq('organization_id', ORG_ID)
      .ilike('name', name.trim())
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`lookup by name: ${error.message}`)
    if (data) return { row: data, matchedBy: 'name' }
  }
  return null
}

// ── Load + dedupe input ──────────────────────────────────────────────
const combined = new Map() // shopvoxId → product object (last file wins)
let totalLoaded = 0
for (const file of files) {
  const abs = resolve(process.cwd(), file)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf8'))
  } catch (e) {
    console.error(`Failed to read/parse ${file}: ${e.message}`)
    process.exit(1)
  }
  const products = Array.isArray(parsed) ? parsed : (parsed.products ?? parsed.results ?? [])
  if (!Array.isArray(products)) {
    console.error(`${file} did not contain a product array`)
    process.exit(1)
  }
  totalLoaded += products.length
  for (const p of products) {
    const key = p.shopvoxId || (p.name ? `name:${p.name.toLowerCase().trim()}` : null)
    if (!key) continue
    combined.set(key, p) // last occurrence wins
  }
  console.log(`  Loaded ${products.length} from ${file}`)
}
const toImport = Array.from(combined.values())
console.log(`Total: ${totalLoaded} entries across ${files.length} file${files.length === 1 ? '' : 's'} → ${toImport.length} unique.\n`)

// ── Process ──────────────────────────────────────────────────────────
let updated = 0, notFound = 0, skipped = 0, errors = 0

for (let i = 0; i < toImport.length; i++) {
  const p = toImport[i]
  const label = `${i + 1}/${toImport.length}  "${p.name ?? '(no name)'}"`

  if (!hasRecipe(p)) {
    skipped++
    console.log(`  ⟳ Skipped: ${label}  (no recipe data)`)
    continue
  }

  try {
    const match = await findMatch(p.shopvoxId, p.name)
    if (!match) {
      notFound++
      console.log(`  ✗ Not found: ${label}`)
      continue
    }

    // Merge: keep existing shopvox_data, replace the 3 recipe arrays.
    const existing = (match.row.shopvox_data ?? {})
    const merged = {
      ...existing,
      modifiers: p.modifiers ?? [],
      dropdown_menus: p.dropdown_menus ?? [],
      default_items: p.default_items ?? [],
    }

    const { error } = await sb
      .from('products')
      .update({ shopvox_data: merged })
      .eq('id', match.row.id)
    if (error) throw new Error(error.message)

    updated++
    const mods = merged.modifiers.length
    const dd = merged.dropdown_menus.length
    const items = merged.default_items.length
    console.log(`  ✓ Updated: ${label}  (${mods} mods, ${dd} dropdowns, ${items} items)  [by ${match.matchedBy}]`)
  } catch (e) {
    errors++
    console.log(`  ! Error:   ${label}  ${e.message}`)
  }
}

console.log('\n─────────────────────────────────────────')
console.log(`Updated: ${updated} | Not found: ${notFound} | Skipped: ${skipped} | Errors: ${errors}`)
