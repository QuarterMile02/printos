// Seed the 5 core QMI products + their default items (recipe).
//
// Usage: node scripts/seed-products.mjs
//
// Notes on schema (these differ from early spec docs — trust the DB):
//   products.pricing_type  ∈ {Formula, Basic, Grid, Cost Plus}  (PascalCase)
//   products.formula       ∈ {Area, Perimeter, Width, Height, Unit, ...}
//   products.status        ∈ {draft, published, disabled, archived}  (no "active")
//   products.default_sale_type = 'In House' by default (free text)
//   products — category is via category_id → product_categories(id), NOT a text column
//   product_default_items.item_type ∈ {Material, LaborRate, MachineRate, CustomItem}
//
// Idempotent: re-running upserts products by (org, name) and fully rebuilds
// each product's default items — safe to run repeatedly.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

// ── Load .env.local ───────────────────────────────────────────────────
const envText = readFileSync(resolve(repoRoot, '.env.local'), 'utf8')
const env = {}
for (const rawLine of envText.split(/\r?\n/)) {
  const line = rawLine.trim()
  if (!line || line.startsWith('#')) continue
  const eq = line.indexOf('=')
  if (eq === -1) continue
  const key = line.slice(0, eq).trim()
  let val = line.slice(eq + 1).trim()
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1)
  }
  env[key] = val
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const ORG_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── Product + recipe specs ────────────────────────────────────────────
// For each recipe item:
//   kind:     'material' | 'labor' | 'machine'  (which table to search)
//   exact:    exact name to try first
//   like:     ILIKE pattern(s) to fall back on, in order
//   formula:  Area | Perimeter | Unit | Width | Height
//   perLi:    charge_per_li_unit
//   mult:     multiplier (default 1)

const PRODUCTS = [
  {
    name: 'Banner Regular Single Sided',
    description: 'Single-sided 13oz scrim banner, grommets + hemming included.',
    category: 'Banners',
    product_type: 'large_format',
    pricing_type: 'Formula',
    formula: 'Area',
    recipe: [
      { kind: 'material', exact: 'Banner Single Sided', like: ['%banner%single%sided%', '%13oz%banner%', '%banner%13oz%', 'banner%'], formula: 'Area', perLi: true },
      { kind: 'labor',    exact: 'Prepress - per minute', like: ['%prepress%minute%', '%prepress%per min%'], formula: 'Unit', perLi: false, mult: 10 },
      { kind: 'machine',  exact: 'Epson S80- High Quality (8 Pass) Area', like: ['%epson%s80%8 pass%area%', '%epson%s80%8%pass%'], formula: 'Area', perLi: true },
      { kind: 'labor',    exact: 'Epson Printing Labor (8 pass) Area', like: ['%epson%printing%labor%8 pass%', '%epson%printing%labor%'], formula: 'Area', perLi: true },
      { kind: 'labor',    exact: 'Zund Cutting Labor- Banner UCT', like: ['%zund%cutting%labor%banner%'], formula: 'Area', perLi: true },
      { kind: 'machine',  exact: 'Zund Cutting UCT- Thru Cut Banner', like: ['%zund%cutting%uct%banner%', '%zund%thru cut%banner%'], formula: 'Area', perLi: true },
      { kind: 'labor',    exact: 'Hemming Labor', like: ['%hemming%labor%', '%hemming%'], formula: 'Perimeter', perLi: true },
    ],
  },
  {
    name: 'Vehicle Wrap Full Color',
    description: 'Full color cast vinyl vehicle wrap — 1 man installation.',
    category: 'Vehicle Wraps',
    product_type: 'vehicle_wrap',
    pricing_type: 'Formula',
    formula: 'Area',
    recipe: [
      { kind: 'material', exact: 'Cast Vinyl Vehicle Wrap', like: ['%cast%vinyl%wrap%', '%vehicle%wrap%vinyl%', '%wrap%vinyl%'], formula: 'Area', perLi: true },
      { kind: 'labor',    exact: 'Wrap Design Prep- Per Hour', like: ['%wrap%design%prep%hour%', '%wrap%design%per hour%'], formula: 'Unit', perLi: false, mult: 2 },
      { kind: 'machine',  exact: 'Epson S80- High Quality (8 Pass) Area', like: ['%epson%s80%8 pass%area%'], formula: 'Area', perLi: true },
      { kind: 'labor',    exact: 'Epson Printing Labor (8 pass) Area', like: ['%epson%printing%labor%8 pass%'], formula: 'Area', perLi: true },
      { kind: 'machine',  exact: 'Roll-X Application Table per sq. ft.', like: ['%roll-x%application%', '%rollx%application%', '%roll-x%'], formula: 'Area', perLi: true },
      { kind: 'labor',    exact: 'Roll-X Application Table Labor Area', like: ['%roll-x%application%labor%', '%rollx%application%labor%'], formula: 'Area', perLi: true },
      { kind: 'labor',    exact: 'Vehicle Wrap Install- Full Color (1 Man)', like: ['%vehicle%wrap%install%1 man%', '%wrap%install%1 man%'], formula: 'Area', perLi: true },
    ],
  },
  {
    name: 'Coroplast Sign 4mm',
    description: '4mm coroplast yard sign — printed + cut to shape.',
    category: 'Signs',
    product_type: 'large_format',
    pricing_type: 'Formula',
    formula: 'Area',
    recipe: [
      { kind: 'material', exact: 'Coroplast 4mm', like: ['%coroplast%4mm%', '%coroplast%4 mm%', '%coroplast%'], formula: 'Area', perLi: true },
      { kind: 'labor',    exact: 'Prepress - per minute', like: ['%prepress%minute%'], formula: 'Unit', perLi: false, mult: 10 },
      { kind: 'machine',  exact: 'Epson S80- High Quality (8 Pass) Area', like: ['%epson%s80%8 pass%area%'], formula: 'Area', perLi: true },
      { kind: 'labor',    exact: 'Epson Printing Labor (8 pass) Area', like: ['%epson%printing%labor%8 pass%'], formula: 'Area', perLi: true },
      { kind: 'machine',  exact: 'Zund Thru Cut- Coroplast 3mm SIMPLE', like: ['%zund%thru cut%coroplast%simple%', '%zund%coroplast%simple%'], formula: 'Area', perLi: true },
      { kind: 'labor',    exact: 'Zund Coroplast 3mm Cutting Labor (Simple)', like: ['%zund%coroplast%cutting%labor%simple%', '%zund%coroplast%labor%'], formula: 'Area', perLi: true },
    ],
  },
  {
    name: 'Business Cards 1000',
    description: 'Standard 3.5x2 business cards, set of 1000, full color both sides.',
    category: 'Business Cards',
    product_type: 'commercial_print',
    pricing_type: 'Formula',
    formula: 'Unit',
    recipe: [
      { kind: 'material', exact: 'Cardstock', like: ['%business card%stock%', '%cardstock%', '%card stock%', '%cover stock%'], formula: 'Unit', perLi: true },
      { kind: 'labor',    exact: 'Ricoh Operator 2880 Pages per hr', like: ['%ricoh%operator%2880%', '%ricoh%operator%'], formula: 'Unit', perLi: true },
      { kind: 'machine',  exact: 'Ricoh Pro C7100 Printer', like: ['%ricoh%pro%c7100%', '%ricoh%c7100%'], formula: 'Unit', perLi: true },
      { kind: 'machine',  exact: 'Shark Business Card Cutter', like: ['%shark%business card%cutter%', '%shark%cutter%', '%business card%cutter%'], formula: 'Unit', perLi: true },
    ],
  },
  {
    name: 'H-Wire Stake 10x24',
    description: 'H-wire ground stake for yard signs, 10x24.',
    category: 'Signs',
    product_type: 'large_format',
    pricing_type: 'Basic',
    formula: null,
    recipe: [
      { kind: 'material', exact: 'H-Wire Stake 10x24', like: ['%h-wire%stake%10x24%', '%h wire%stake%', '%h-wire%', '%wire stake%'], formula: 'Unit', perLi: true },
      { kind: 'labor',    exact: 'Prepress - per minute', like: ['%prepress%minute%'], formula: 'Unit', perLi: false, mult: 5 },
      { kind: 'machine',  exact: 'Epson S80- High Quality (8 Pass) Area', like: ['%epson%s80%8 pass%area%'], formula: 'Area', perLi: true },
      { kind: 'labor',    exact: 'Epson Printing Labor (8 pass) Area', like: ['%epson%printing%labor%8 pass%'], formula: 'Area', perLi: true },
      { kind: 'machine',  exact: 'Zund Cutting UCT- Thru Cut Thin Materials SIMPLE', like: ['%zund%thru cut%thin%simple%', '%zund%thin materials%simple%'], formula: 'Area', perLi: true },
      { kind: 'labor',    exact: 'Zund Cutting UCT Labor- Thru Cut Thin Materials SIMPLE', like: ['%zund%cutting%labor%thin%simple%', '%zund%thin materials%labor%'], formula: 'Area', perLi: true },
    ],
  },
]

// ── Helpers ───────────────────────────────────────────────────────────

async function ensureCategory(name) {
  const { data: existing } = await sb
    .from('product_categories')
    .select('id')
    .eq('organization_id', ORG_ID)
    .eq('name', name)
    .maybeSingle()
  if (existing?.id) return existing.id
  const { data: inserted, error } = await sb
    .from('product_categories')
    .insert({ organization_id: ORG_ID, name })
    .select('id')
    .single()
  if (error) throw new Error(`Category insert failed (${name}): ${error.message}`)
  return inserted.id
}

async function upsertProduct(p, categoryId) {
  const payload = {
    organization_id: ORG_ID,
    name: p.name,
    description: p.description,
    product_type: p.product_type,
    category_id: categoryId,
    pricing_type: p.pricing_type,
    formula: p.formula,
    status: 'published',
    active: true,
    taxable: true,
    in_house_commission: true,
    default_sale_type: 'In House',
  }
  const { data: existing } = await sb
    .from('products')
    .select('id')
    .eq('organization_id', ORG_ID)
    .eq('name', p.name)
    .maybeSingle()
  if (existing?.id) {
    const { error } = await sb.from('products').update(payload).eq('id', existing.id)
    if (error) throw new Error(`Update product failed (${p.name}): ${error.message}`)
    return { id: existing.id, created: false }
  }
  const { data: inserted, error } = await sb
    .from('products')
    .insert(payload)
    .select('id')
    .single()
  if (error) throw new Error(`Insert product failed (${p.name}): ${error.message}`)
  return { id: inserted.id, created: true }
}

const TABLE_BY_KIND = { material: 'materials', labor: 'labor_rates', machine: 'machine_rates' }
const ITEM_TYPE_BY_KIND = { material: 'Material', labor: 'LaborRate', machine: 'MachineRate' }
const FK_BY_KIND = { material: 'material_id', labor: 'labor_rate_id', machine: 'machine_rate_id' }

async function lookupItem(item) {
  const table = TABLE_BY_KIND[item.kind]
  // Try exact first
  if (item.exact) {
    const { data } = await sb
      .from(table)
      .select('id, name')
      .eq('organization_id', ORG_ID)
      .eq('name', item.exact)
      .limit(1)
      .maybeSingle()
    if (data?.id) return { id: data.id, name: data.name, matched: 'exact' }
  }
  // Then ILIKE patterns in order
  for (const pattern of item.like ?? []) {
    const { data } = await sb
      .from(table)
      .select('id, name')
      .eq('organization_id', ORG_ID)
      .ilike('name', pattern)
      .limit(1)
      .maybeSingle()
    if (data?.id) return { id: data.id, name: data.name, matched: `ilike ${pattern}` }
  }
  return null
}

async function rebuildDefaultItems(productId, productName, recipe) {
  // Wipe existing items for this product (idempotent rebuild)
  const { error: delErr } = await sb
    .from('product_default_items')
    .delete()
    .eq('product_id', productId)
    .eq('organization_id', ORG_ID)
  if (delErr) throw new Error(`Delete default items failed (${productName}): ${delErr.message}`)

  const rows = []
  const report = []
  let sort = 0
  for (const item of recipe) {
    const found = await lookupItem(item)
    if (!found) {
      report.push({ kind: item.kind, requested: item.exact, matched: null, note: 'NOT FOUND' })
      continue
    }
    report.push({ kind: item.kind, requested: item.exact, matched: found.name, note: found.matched })
    rows.push({
      organization_id: ORG_ID,
      product_id: productId,
      item_type: ITEM_TYPE_BY_KIND[item.kind],
      material_id:    item.kind === 'material' ? found.id : null,
      labor_rate_id:  item.kind === 'labor'    ? found.id : null,
      machine_rate_id:item.kind === 'machine'  ? found.id : null,
      system_formula: item.formula,
      charge_per_li_unit: !!item.perLi,
      include_in_base_price: true,
      multiplier: item.mult ?? 1,
      sort_order: sort++,
    })
  }

  if (rows.length > 0) {
    const { error } = await sb.from('product_default_items').insert(rows)
    if (error) throw new Error(`Insert default items failed (${productName}): ${error.message}`)
  }
  return { inserted: rows.length, report }
}

// ── Run ───────────────────────────────────────────────────────────────

const summary = []

for (const p of PRODUCTS) {
  console.log(`\n━━━ ${p.name} ───────────────────────────────`)
  try {
    const catId = await ensureCategory(p.category)
    const { id: productId, created } = await upsertProduct(p, catId)
    console.log(`  product: ${created ? 'created' : 'updated'} (${productId})`)
    const { inserted, report } = await rebuildDefaultItems(productId, p.name, p.recipe)
    for (const r of report) {
      const label = r.matched ? `OK  ${r.matched}  [${r.note}]` : `MISS  ${r.note}`
      console.log(`    [${r.kind.padEnd(7)}] wanted: ${r.requested}`)
      console.log(`               → ${label}`)
    }
    summary.push({
      product: p.name,
      inserted,
      missed: report.filter((r) => !r.matched).length,
      missing: report.filter((r) => !r.matched).map((r) => `${r.kind}: ${r.requested}`),
    })
  } catch (e) {
    console.error(`  FAILED:`, e.message)
    summary.push({ product: p.name, inserted: 0, missed: -1, missing: [e.message] })
  }
}

console.log('\n════════════════════════════════════════════════')
console.log('SUMMARY')
console.log('════════════════════════════════════════════════')
for (const s of summary) {
  const status = s.missed === 0 ? '✓' : s.missed < 0 ? '✗' : `${s.missed} miss`
  console.log(`${status.padEnd(8)} ${s.product.padEnd(36)} ${s.inserted} items`)
  for (const m of s.missing) console.log(`         missing: ${m}`)
}

// Final verification count
const { data: counts } = await sb
  .from('products')
  .select('id, name, product_default_items(count)')
  .eq('organization_id', ORG_ID)
  .in('name', PRODUCTS.map((p) => p.name))

console.log('\nVerification (via Supabase join):')
for (const row of counts ?? []) {
  const n = Array.isArray(row.product_default_items) && row.product_default_items[0]
    ? row.product_default_items[0].count
    : 0
  console.log(`  ${row.name.padEnd(36)} ${n} items`)
}

console.log('\nDone.')
