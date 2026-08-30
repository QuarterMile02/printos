/**
 * backfill-customer-shopvox-id.mjs
 *
 * FIRST WRITE TO A NATIVE PRINTOS TABLE (public.customers). Treated
 * accordingly: --dry-run by default, per-row idempotency checks before
 * writing anything, no bulk upsert trick (see WHY NOT UPSERT below),
 * conflicts flagged and skipped rather than guessed at, full audit trail.
 *
 * Sets public.customers.shopvox_id for the customers that are an
 * UNAMBIGUOUS 1-PrintOS-row-to-1-ShopVOX-uuid match, per
 * scripts/customer-index/_customer-diff.md's matching rule (exact match on
 * normalized name — lowercased, trimmed, whitespace-collapsed, leading
 * apostrophe stripped). This script does NOT read that markdown report; it
 * recomputes the same match/blocker classification directly from the two
 * source files (self-contained and independently auditable), then — because
 * the live customers table has grown by a handful of rows since the April
 * CSV snapshot (4,566 live vs 4,560 in the CSV) — re-resolves each matched
 * company_name against the LIVE table to get the real internal id, rather
 * than trusting row identity from a now-stale snapshot. Any name that
 * doesn't resolve to exactly one live row is skipped and reported, not
 * guessed at — this is a second safety net beyond the 3 known April-era
 * blockers (commerce bank / nezt real estate group / ralph morales).
 *
 * WHY NOT UPSERT: `.upsert([{id, shopvox_id}], {onConflict:'id'})` would
 * work and be one bulk call, but relies on ON CONFLICT DO UPDATE only
 * touching the columns you pass — correct in principle, but this is the
 * first write ever made to this table by this pipeline, and a subtle
 * misunderstanding of that semantics on a wide table (60+ columns) is a bad
 * place to find out you were wrong. Individual `.update().eq('id', ...)`
 * calls are slower but their blast radius is obvious from reading the line.
 *
 * Usage:
 *   node scripts/backfill-customer-shopvox-id.mjs              # dry run (default)
 *   node scripts/backfill-customer-shopvox-id.mjs --apply       # actually write
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostname } from 'node:os'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = __dir
const CUSTOMER_INDEX_DIR = join(root, 'customer-index')
const SHOPVOX_PATH = join(CUSTOMER_INDEX_DIR, 'customers-list.json')
const PRINTOS_CSV_PATH = join(CUSTOMER_INDEX_DIR, 'qmi_customers_april_export.csv')
const OUT_APPLIED_CSV = join(CUSTOMER_INDEX_DIR, '_backfill-applied.csv')

const APPLY = process.argv.includes('--apply')
const ORGANIZATION_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'
const KNOWN_APRIL_BLOCKERS = new Set(['commerce bank', 'nezt real estate group', 'ralph morales'])
const CONCURRENCY = 10
const PROGRESS_EVERY = 200

function loadEnv() {
  const envPath = join(root, '..', '.env.local')
  const env = readFileSync(envPath, 'utf8')
  return Object.fromEntries(env.split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
}
const vars = loadEnv()
if (!vars.SUPABASE_SERVICE_ROLE_KEY) { console.error('FATAL: SUPABASE_SERVICE_ROLE_KEY missing from .env.local'); process.exit(1) }
if (!/^sb_secret_/.test(vars.SUPABASE_SERVICE_ROLE_KEY) && !vars.SUPABASE_SERVICE_ROLE_KEY.startsWith('eyJ')) { console.error('FATAL: SUPABASE_SERVICE_ROLE_KEY does not look like a service-role key'); process.exit(1) }
const sb = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
console.log(`Mode: ${APPLY ? 'APPLY (writing to public.customers)' : 'DRY RUN (default — pass --apply to write)'}`)

// ── Same normalization as scripts/customer-index/diff-customers.mjs ────────
function normalize(name) {
  return String(name ?? '').trim().replace(/^['‘’]/, '').trim().replace(/\s+/g, ' ').toLowerCase()
}
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  const header = splitCsvLine(lines[0])
  return lines.slice(1).map((line) => { const cells = splitCsvLine(line); const row = {}; header.forEach((h, i) => { row[h] = cells[i] ?? '' }); return row })
}
function splitCsvLine(line) {
  const cells = []
  let cur = '', inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else inQuotes = false } else cur += c }
    else { if (c === '"') inQuotes = true; else if (c === ',') { cells.push(cur); cur = '' } else cur += c }
  }
  cells.push(cur)
  return cells
}
function csvCell(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

// ── Recompute match/blocker classification from the two source files ───────
const shopvoxRaw = JSON.parse(readFileSync(SHOPVOX_PATH, 'utf8'))
const shopvox = shopvoxRaw.map((r) => ({ shopvox_uuid: r.shopvox_uuid, company_name: r.company_name, normalized: normalize(r.company_name) }))
const printosRaw = parseCsv(readFileSync(PRINTOS_CSV_PATH, 'utf8'))
const printos = printosRaw.map((r) => ({ company_name: r.company_name, normalized: normalize(r.company_name) }))

function groupBy(rows) { const m = new Map(); for (const r of rows) { if (!m.has(r.normalized)) m.set(r.normalized, []); m.get(r.normalized).push(r) }; return m }
const shopvoxByName = groupBy(shopvox)
const printosByName = groupBy(printos)
const matchedNames = [...shopvoxByName.keys()].filter((n) => printosByName.has(n))
const unmatchedPrintosNames = [...printosByName.keys()].filter((n) => !shopvoxByName.has(n))

const cleanMatches = [] // { normalized, printosCompanyName, shopvoxUuid }
const skippedBlockers = [] // known April-era many:1 / many:many
for (const name of matchedNames) {
  const pRows = printosByName.get(name)
  const sRows = shopvoxByName.get(name)
  if (pRows.length > 1 || sRows.length > 1) {
    skippedBlockers.push({ normalized: name, reason: KNOWN_APRIL_BLOCKERS.has(name) ? 'known April backfill blocker' : 'UNEXPECTED new blocker not in the known 3 — diff may be stale', printosRows: pRows.length, shopvoxRows: sRows.length })
    continue
  }
  cleanMatches.push({ normalized: name, printosCompanyName: pRows[0].company_name, shopvoxUuid: sRows[0].shopvox_uuid })
}
const skippedUnmatched = unmatchedPrintosNames.map((n) => ({ normalized: n, printosCompanyName: printosByName.get(n)[0].company_name }))

console.log(`Source files: ${shopvox.length} ShopVOX rows, ${printos.length} PrintOS (April) rows.`)
console.log(`Clean 1:1 matches (candidates): ${cleanMatches.length}`)
console.log(`Skipped — blockers: ${skippedBlockers.length}`)
console.log(`Skipped — unmatched: ${skippedUnmatched.length}`)
if (skippedBlockers.some((b) => !KNOWN_APRIL_BLOCKERS.has(b.normalized))) {
  console.error('\n⚠️  UNEXPECTED blocker(s) found that are not in the known set of 3 — the source files may have changed since the diff was last run. Re-run scripts/customer-index/diff-customers.mjs and review before applying.')
}

// ── Re-resolve each candidate against the LIVE customers table ─────────────
// The live table has grown since the April CSV snapshot (4,566 vs 4,560) —
// don't trust the snapshot for row identity, only for "which normalized
// names are safe." Fetch every live customer once, group by the SAME
// normalization, and require exactly one live match per candidate.
async function fetchAllLiveCustomers() {
  const rows = []
  let from = 0
  const PAGE = 1000
  for (;;) {
    const { data, error } = await sb.from('customers').select('id, company_name, shopvox_id').eq('organization_id', ORGANIZATION_ID).range(from, from + PAGE - 1)
    if (error) { console.error('FATAL: could not fetch live customers:', error.message); process.exit(1) }
    rows.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return rows
}

async function main() {
  const liveCustomers = await fetchAllLiveCustomers()
  console.log(`Live public.customers rows (org-scoped): ${liveCustomers.length}`)
  const liveByName = groupBy(liveCustomers.map((r) => ({ ...r, normalized: normalize(r.company_name) })))

  const preExistingNonNullCount = liveCustomers.filter((r) => r.shopvox_id != null).length
  console.log(`Live customers with a non-null shopvox_id already (before this run, any value): ${preExistingNonNullCount}`)

  const toUpdate = [] // { id, company_name, shopvoxUuid }
  const alreadyCorrect = [] // idempotent no-ops
  const conflicts = [] // shopvox_id already set to something ELSE — never overwritten
  const missingLive = [] // 0 live rows for this normalized name
  const newDuplicateLive = [] // >1 live rows — a NEW blocker the April diff didn't catch

  for (const m of cleanMatches) {
    const liveRows = liveByName.get(m.normalized) || []
    if (liveRows.length === 0) { missingLive.push(m); continue }
    if (liveRows.length > 1) { newDuplicateLive.push({ ...m, liveIds: liveRows.map((r) => r.id) }); continue }
    const live = liveRows[0]
    if (live.shopvox_id === m.shopvoxUuid) { alreadyCorrect.push({ ...m, id: live.id }); continue }
    if (live.shopvox_id != null && live.shopvox_id !== m.shopvoxUuid) { conflicts.push({ ...m, id: live.id, currentShopvoxId: live.shopvox_id }); continue }
    toUpdate.push({ id: live.id, company_name: live.company_name, shopvoxUuid: m.shopvoxUuid })
  }

  console.log(`\n=== Resolution against live table ===`)
  console.log(`  Would update (currently null, resolves to exactly 1 live row): ${toUpdate.length}`)
  console.log(`  Already correct (idempotent no-op): ${alreadyCorrect.length}`)
  console.log(`  Conflicts (shopvox_id already set to a DIFFERENT uuid — skipped, not overwritten): ${conflicts.length}`)
  console.log(`  Missing from live table (existed in April CSV, gone now): ${missingLive.length}`)
  console.log(`  New duplicate in live table (>1 row, not in the known April blockers): ${newDuplicateLive.length}`)

  if (conflicts.length) {
    console.log(`\n  Conflict detail:`)
    for (const c of conflicts.slice(0, 20)) console.log(`    id=${c.id} "${c.printosCompanyName}": current shopvox_id=${c.currentShopvoxId}, diff says=${c.shopvoxUuid}`)
  }
  if (newDuplicateLive.length) {
    console.log(`\n  New-duplicate detail:`)
    for (const d of newDuplicateLive.slice(0, 20)) console.log(`    "${d.printosCompanyName}": live ids=${d.liveIds.join(', ')}`)
  }

  console.log(`\n=== Skipped: known blockers (${skippedBlockers.length}) ===`)
  for (const b of skippedBlockers) console.log(`  ${b.normalized} — ${b.reason} (printos rows=${b.printosRows}, shopvox rows=${b.shopvoxRows})`)

  console.log(`\n=== Skipped: unmatched PrintOS rows (${skippedUnmatched.length}) ===`)
  for (const u of skippedUnmatched) console.log(`  ${u.printosCompanyName}`)

  console.log(`\n=== Sample pairs (10 of ${toUpdate.length} that would be updated) ===`)
  for (const r of toUpdate.slice(0, 10)) console.log(`  ${r.company_name}  ->  ${r.shopvoxUuid}`)

  if (!APPLY) {
    console.log(`\n--dry-run (default): 0 rows written. Pass --apply to write ${toUpdate.length} row(s).`)
    return
  }

  // ── Apply ──────────────────────────────────────────────────────────────
  const runStart = new Date().toISOString()
  const { data: runRow, error: runErr } = await sb.from('historical_import_runs').insert({
    entity: 'customer_shopvox_backfill', scope: 'clean 1:1 matches from customer-index diff', machine: hostname(),
    status: 'running', started_at: runStart, records_seen: toUpdate.length, records_captured: 0, records_failed: 0,
  }).select().single()
  if (runErr) { console.error('FATAL: could not open historical_import_runs row:', runErr.message); process.exit(1) }
  console.log(`\nOpened historical_import_runs id=${runRow.id}`)

  const applied = [] // { customer_id, company_name, shopvox_id }
  const failed = []
  for (let i = 0; i < toUpdate.length; i += CONCURRENCY) {
    const chunk = toUpdate.slice(i, i + CONCURRENCY)
    const results = await Promise.all(chunk.map(async (r) => {
      const { error } = await sb.from('customers').update({ shopvox_id: r.shopvoxUuid }).eq('id', r.id).eq('organization_id', ORGANIZATION_ID)
      return { r, error }
    }))
    for (const { r, error } of results) {
      if (error) failed.push({ ...r, error: error.message })
      else applied.push({ customer_id: r.id, company_name: r.company_name, shopvox_id: r.shopvoxUuid })
    }
    if ((i + CONCURRENCY) % PROGRESS_EVERY < CONCURRENCY || i + CONCURRENCY >= toUpdate.length) {
      console.log(`  ${Math.min(i + CONCURRENCY, toUpdate.length)}/${toUpdate.length} processed (${applied.length} applied, ${failed.length} failed)`)
    }
  }

  writeFileSync(OUT_APPLIED_CSV, ['customer_id,company_name,shopvox_id', ...applied.map((r) => `${csvCell(r.customer_id)},${csvCell(r.company_name)},${csvCell(r.shopvox_id)}`)].join('\n') + '\n')
  console.log(`\nWrote ${OUT_APPLIED_CSV} (${applied.length} row(s) — this is the audit trail; reverse by setting these ids' shopvox_id back to null)`)

  const finishedAt = new Date().toISOString()
  await sb.from('historical_import_runs').update({
    status: failed.length ? 'failed' : 'succeeded', finished_at: finishedAt,
    records_seen: toUpdate.length, records_captured: applied.length, records_failed: failed.length,
    notes: JSON.stringify({ alreadyCorrect: alreadyCorrect.length, conflicts: conflicts.length, missingLive: missingLive.length, newDuplicateLive: newDuplicateLive.length, skippedBlockers: skippedBlockers.length, skippedUnmatched: skippedUnmatched.length }),
    error: failed.length ? failed.slice(0, 20).map((f) => `id=${f.id}: ${f.error}`).join('; ') : null,
  }).eq('id', runRow.id)
  console.log(`Closed historical_import_runs id=${runRow.id} (status: ${failed.length ? 'failed' : 'succeeded'})`)
  console.log(`\n=== FINAL: applied=${applied.length} failed=${failed.length} alreadyCorrect(no-op)=${alreadyCorrect.length} ===`)
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
