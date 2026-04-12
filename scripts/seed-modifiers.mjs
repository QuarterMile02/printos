// Seed QMI_Modifiers.csv into the modifiers table.
//
// Usage:  node scripts/seed-modifiers.mjs
//
// Idempotent: pre-fetches existing modifier names for the org and skips
// them so reruns don't create duplicates.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

// ── Load .env.local manually (avoids the dotenv dependency) ────────────
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
const CSV_PATH = resolve(repoRoot, 'QMI_Modifiers.csv')

// ── Tiny CSV parser — handles quoted fields w/ commas, NOT escaped "" ──
function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((s) => s.replace(/\r$/, '').trim())
}

const csv = readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '')
const lines = csv.split('\n').filter((l) => l.trim().length > 0)
if (lines.length < 2) {
  console.error('CSV has no data rows')
  process.exit(1)
}

const headers = parseCsvLine(lines[0])
const idx = (h) => headers.indexOf(h)
const COL = {
  systemLookup: idx('System Lookup Name'),
  display:      idx('Display Name'),
  type:         idx('Type'),
  units:        idx('Units'),
  minLabel:     idx('Range Min Label'),
  maxLabel:     idx('Range Max Label'),
  minValue:     idx('Range Min Value'),
  maxValue:     idx('Range Max Value'),
  defValue:     idx('Range Default Value'),
  stepInterval: idx('Range Step Interval'),
  showInternal: idx('Show Internally'),
  showCustomer: idx('Show Customer'),
  systemVar:    idx('System Variable'),
}
for (const [name, i] of Object.entries(COL)) {
  if (i === -1) {
    console.error(`Header missing: ${name}`)
    process.exit(1)
  }
}

const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v.replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}
const yn = (v) => (v ?? '').trim().toLowerCase() === 'yes'

const rows = []
const skippedNoName = []
for (let li = 1; li < lines.length; li++) {
  const cols = parseCsvLine(lines[li])
  const display = (cols[COL.display] ?? '').trim()
  if (!display) {
    skippedNoName.push(li + 1)
    continue
  }
  rows.push({
    organization_id: ORG_ID,
    name:                  display,                          // NOT NULL
    display_name:          display,                          // NOT NULL — both columns get the CSV's Display Name
    system_lookup_name:    (cols[COL.systemLookup] ?? '').trim() || null,
    modifier_type:         (cols[COL.type] ?? '').trim(),    // CHECK ('Boolean','Numeric','Range')
    units:                 (cols[COL.units] ?? '').trim() || null,
    range_min_label:       (cols[COL.minLabel] ?? '').trim() || null,
    range_max_label:       (cols[COL.maxLabel] ?? '').trim() || null,
    range_min_value:       num(cols[COL.minValue]),
    range_max_value:       num(cols[COL.maxValue]),
    range_default_value:   num(cols[COL.defValue]),
    range_step_interval:   num(cols[COL.stepInterval]),
    show_internally:       yn(cols[COL.showInternal]),
    show_customer:         yn(cols[COL.showCustomer]),
    is_system_variable:    yn(cols[COL.systemVar]),
    active:                true,
  })
}

console.log(`Parsed ${rows.length} rows from CSV (${skippedNoName.length} skipped — blank Display Name)`)

// ── Validate modifier_type values up-front ─────────────────────────────
const validTypes = new Set(['Boolean', 'Numeric', 'Range'])
const badTypes = []
for (let i = 0; i < rows.length; i++) {
  if (!validTypes.has(rows[i].modifier_type)) {
    badTypes.push({ row: i + 2, name: rows[i].name, type: rows[i].modifier_type })
  }
}
if (badTypes.length > 0) {
  console.error('Found rows with invalid modifier_type — aborting before insert:')
  console.error(badTypes.slice(0, 10))
  console.error(`(${badTypes.length} total)`)
  process.exit(1)
}

// ── Connect & dedupe against existing rows ─────────────────────────────
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

console.log('Fetching existing modifier names for dedupe…')
const existingNames = new Set()
let from = 0
const PAGE = 1000
while (true) {
  const { data, error } = await sb
    .from('modifiers')
    .select('name')
    .eq('organization_id', ORG_ID)
    .range(from, from + PAGE - 1)
  if (error) { console.error('Fetch existing failed:', error.message); process.exit(1) }
  if (!data || data.length === 0) break
  for (const r of data) existingNames.add((r.name || '').toLowerCase())
  if (data.length < PAGE) break
  from += PAGE
}
console.log(`Existing modifiers in org: ${existingNames.size}`)

const toInsert = rows.filter((r) => !existingNames.has(r.name.toLowerCase()))
const skippedDup = rows.length - toInsert.length
console.log(`Will insert: ${toInsert.length}  (skipping ${skippedDup} duplicates)`)

// ── Batch insert ───────────────────────────────────────────────────────
const BATCH = 50
let inserted = 0
const failures = []
for (let i = 0; i < toInsert.length; i += BATCH) {
  const slice = toInsert.slice(i, i + BATCH)
  const { error } = await sb.from('modifiers').insert(slice)
  if (error) {
    console.error(`Batch ${Math.floor(i / BATCH) + 1} failed:`, error.message)
    // Per-row fallback so we can see which row(s) broke
    for (const r of slice) {
      const { error: e2 } = await sb.from('modifiers').insert(r)
      if (e2) {
        failures.push({ name: r.name, message: e2.message })
      } else {
        inserted++
      }
    }
  } else {
    inserted += slice.length
    console.log(`Batch ${Math.floor(i / BATCH) + 1}: OK (${slice.length})`)
  }
}

// ── Final count from DB ────────────────────────────────────────────────
const { count, error: countErr } = await sb
  .from('modifiers')
  .select('*', { count: 'exact', head: true })
  .eq('organization_id', ORG_ID)

console.log('────────────────────────────────────────')
console.log(`Inserted this run: ${inserted}`)
console.log(`Skipped duplicates: ${skippedDup}`)
console.log(`Failures: ${failures.length}`)
if (failures.length > 0) {
  console.log(failures.slice(0, 20))
}
if (countErr) {
  console.log('Final count query failed:', countErr.message)
} else {
  console.log(`DONE. Total modifiers in org: ${count}`)
}
