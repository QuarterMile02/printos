/**
 * generate-promote-customers-list.mjs
 *
 * One-off: writes scripts/state/promote_customers.txt — one distinct,
 * non-null shopvox_transactions.customer_shopvox_id per line, no header,
 * no commas. Source list for a future promoter --customers=<file> run.
 *
 * CRITICAL: PostgREST silently caps a plain .select() at 1,000 rows, no
 * error, no warning — this project has been bitten by that before (see
 * SHOPVOX_MIGRATION_NOTES.md). Pages through the full table with .range()
 * in 1,000-row chunks and dedupes client-side; never assumes a single
 * request returned everything.
 *
 * Verifies four counts against expected values before writing anything.
 * Any mismatch stops the script, writes nothing, and reports the
 * discrepancy plainly — the expected values are never adjusted to match
 * what was actually found.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const OUT_PATH = join(root, 'scripts', 'state', 'promote_customers.txt')

const EXPECTED_TOTAL_ROWS = 38684
const EXPECTED_NULL_CUSTOMER_ROWS = 1179
const EXPECTED_DISTINCT_CUSTOMERS = 2542

function loadEnv() {
  const env = readFileSync(join(root, '.env.local'), 'utf8')
  return Object.fromEntries(env.split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
}
const vars = loadEnv()
const URL = vars.NEXT_PUBLIC_SUPABASE_URL
const KEY = vars.SUPABASE_SERVICE_ROLE_KEY
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function fetchAllCustomerIds() {
  const PAGE = 1000
  let offset = 0
  const all = []
  for (;;) {
    const res = await fetch(
      `${URL}/rest/v1/shopvox_transactions?select=customer_shopvox_id&order=id&limit=${PAGE}&offset=${offset}`,
      { headers: HEADERS },
    )
    if (!res.ok) throw new Error(`fetch failed at offset ${offset}: HTTP ${res.status} ${await res.text()}`)
    const rows = await res.json()
    if (!Array.isArray(rows)) throw new Error(`unexpected response shape at offset ${offset}: ${JSON.stringify(rows)}`)
    all.push(...rows)
    if (rows.length < PAGE) break
    offset += rows.length
  }
  return all
}

async function main() {
  console.log('Paginating shopvox_transactions (customer_shopvox_id only), 1,000 rows/page...')
  const rows = await fetchAllCustomerIds()

  // ── Check 1: total rows scanned ──
  const totalScanned = rows.length
  console.log(`\n[check 1] total rows scanned: ${totalScanned} (expected ${EXPECTED_TOTAL_ROWS})`)

  // ── Check 2: rows with null customer_shopvox_id ──
  const nullRows = rows.filter((r) => r.customer_shopvox_id === null)
  console.log(`[check 2] rows with null customer_shopvox_id: ${nullRows.length} (expected ${EXPECTED_NULL_CUSTOMER_ROWS})`)

  // ── Check 3: distinct non-null customer uuids ──
  const distinctIds = [...new Set(rows.map((r) => r.customer_shopvox_id).filter((id) => id !== null))].sort()
  console.log(`[check 3] distinct non-null customer uuids: ${distinctIds.length} (expected ${EXPECTED_DISTINCT_CUSTOMERS})`)

  const mismatches = []
  if (totalScanned !== EXPECTED_TOTAL_ROWS) mismatches.push(`total rows scanned: got ${totalScanned}, expected ${EXPECTED_TOTAL_ROWS}`)
  if (nullRows.length !== EXPECTED_NULL_CUSTOMER_ROWS) mismatches.push(`null customer_shopvox_id rows: got ${nullRows.length}, expected ${EXPECTED_NULL_CUSTOMER_ROWS}`)
  if (distinctIds.length !== EXPECTED_DISTINCT_CUSTOMERS) mismatches.push(`distinct customer uuids: got ${distinctIds.length}, expected ${EXPECTED_DISTINCT_CUSTOMERS}`)

  if (mismatches.length) {
    console.error('\nSTOPPING — one or more counts disagree with the expected values. Writing nothing.')
    for (const m of mismatches) console.error(`  ✗ ${m}`)
    process.exitCode = 1
    return
  }

  console.log('\nAll three checks match expected values. Writing file...')
  mkdirSync(dirname(OUT_PATH), { recursive: true })
  const content = distinctIds.join('\n') + '\n'
  writeFileSync(OUT_PATH, content)

  // ── Check 4: line count of the written file ──
  const written = readFileSync(OUT_PATH, 'utf8')
  const lineCount = written.split('\n').filter(Boolean).length
  console.log(`[check 4] line count of ${OUT_PATH}: ${lineCount} (must equal check 3's ${distinctIds.length})`)

  if (lineCount !== distinctIds.length) {
    console.error(`\nSTOPPING — file line count (${lineCount}) does not match distinct count (${distinctIds.length}). File was written but is suspect — inspect before using.`)
    process.exitCode = 1
    return
  }

  console.log(`\n✓ Wrote ${OUT_PATH} — ${lineCount} lines, all checks passed.`)
  console.log(`\nfirst line: ${distinctIds[0]}`)
  console.log(`last line:  ${distinctIds[distinctIds.length - 1]}`)
}

main().catch((err) => { console.error('FATAL:', err.message); process.exitCode = 1 })
