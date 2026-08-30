/**
 * shopvox-enumerate.mjs
 *
 * Enumeration ONLY. Collects the identity + URL of every record ShopVOX
 * exposes through a global list, into an append-only work queue that a
 * separate capture pass drains later. Does NOT open any detail page, does
 * NOT capture any field, does NOT write to Supabase except one bookkeeping
 * row per source in historical_import_runs.
 *
 * MECHANISM — a deliberate deviation worth flagging: this does not drive
 * the UI's "Load More" button. Every one of ShopVOX's list views (the
 * "PrintOS Migration" views, "All Invoices", the two Voided views) is
 * itself just a saved filter over one REST endpoint
 * (api.shopvox.com/edge/transactions/<kind>?page=N&perPage=N&filters[]=...).
 * Each source below was reverse-engineered by opening that exact view in a
 * browser once, reading the live network request Playwright captured, and
 * hard-coding the SAME filters here — so the result set enumerated is
 * identical to what clicking through that named view would show, just
 * fetched by direct paginated GET instead of N "Load More" clicks. For an
 * 8,093-row list this is the difference between ~17 requests and ~160
 * button clicks with a render-settle wait after each one — given how slow
 * UI-driven capture already proved to be in this project (see
 * scripts/chain-capture/_field-coverage.md), enumerating this way is what
 * makes a full pass tractable at all. If the direct-API approach turns out
 * to be unwanted, every source's `filters` array is exactly what's needed
 * to reconstruct the equivalent UI-driven "Load More" loop instead.
 *
 * SCOPE, BY DESIGN — do not "fix" this:
 *   - Jobs are NOT enumerated here. Confirmed live, repeatedly, including a
 *     dedicated voided-coverage audit (scripts/api-probe/_voided-coverage.md):
 *     workflowState=voided, active=false, and txnNumber (equal, greaterThan,
 *     greaterThanOrEqual) all fail to surface a job KNOWN to exist — no
 *     filter, view, or number-range trick reaches the hidden population.
 *     Jobs are discovered during the CAPTURE pass instead (line items'
 *     jobId, email parents, a job's own referenceJobId — see the closure
 *     pass in shopvox-capture.mjs) and appended to this same queue at that
 *     time. Even that is a best-effort backstop, not a proof of completeness
 *     — see the closure-pass caveat in _voided-coverage.md.
 *   - Converted quotes/sales-orders are NOT separately flagged or
 *     enumerated twice. The "PrintOS Migration" views for quotes and sales
 *     orders already filter to `ordered=false`/`invoiced=false` — i.e.
 *     quotes that were never converted to a sales order, and sales orders
 *     that were never invoiced. A quote that WAS converted is reachable
 *     from its sales order's breadcrumb during capture, exactly like Jobs
 *     above — enumerating it here too would just be a second path to a
 *     record capture will already reach.
 *
 * VOIDED-COVERAGE PASSES (added after scripts/api-probe/_voided-coverage.md
 * proved several entities have a hidden inactive/voided population the
 * primary source above never reaches):
 *   - quote and sales_order already had a "Voided X" system-view source
 *     (workflowState=void) below — kept as-is. Added a broader `active=false`
 *     pass on top (no ordered/invoiced constraint) as a completeness check;
 *     dedup means any overlap is free.
 *   - invoice, credit_memo, purchase_order, payment, customer: NONE of
 *     these had ANY voided/inactive pass before. Confirmed live that their
 *     "all"/"migration" source's reported total already equals `active=true`
 *     exactly (i.e. it silently has an implicit active-only default, same
 *     failure shape as everything else in this account) — so a supplementary
 *     `active=false` pass is required, added below for each.
 *   - refund: audited and confirmed genuinely zero inactive records — no
 *     pass added, nothing to add.
 *   - sales_lead: NEVER enumerated globally before at all (only ever
 *     customer-scoped). Added as a new entity, two passes (filters:[] for
 *     the 966 active ones — same implicit-active-default pattern confirmed
 *     live — plus `active=false` for the 219 inactive ones the audit found).
 *
 * Usage (PowerShell — one command per line, no &&):
 *   node scripts/shopvox-enumerate.mjs
 *   node scripts/shopvox-enumerate.mjs --entity=quotes_migration
 *   node scripts/shopvox-enumerate.mjs --entity=customers --range=A-M
 *
 * Output: scripts/queue/queue.jsonl (append-only, deduped on entity+uuid),
 * scripts/queue/_totals.json (reported vs harvested per source AND rolled
 * up per entity kind).
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, appendFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostname } from 'node:os'
import { launchBrowser, ensureLoggedInLazy, sleep } from './chain-capture/_lib.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const QUEUE_DIR = join(root, 'scripts', 'queue')
const QUEUE_FILE = join(QUEUE_DIR, 'queue.jsonl')
const TOTALS_FILE = join(QUEUE_DIR, '_totals.json')
if (!existsSync(QUEUE_DIR)) mkdirSync(QUEUE_DIR, { recursive: true })

const argv = process.argv.slice(2)
function getFlag(name) { const a = argv.find((a) => a.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null }
const ONLY_SOURCE = getFlag('entity')
const RANGE = getFlag('range') // e.g. "A-M", customers only

const PER_PAGE = 500 // confirmed live: every endpoint below accepts this; cuts the 8,093-row invoices list to 17 requests

// ── Env / Supabase (bookkeeping only — never writes queue rows here) ────
function loadEnv() {
  const envPath = join(root, '.env.local')
  if (!existsSync(envPath)) { console.error('FATAL: .env.local not found'); process.exit(1) }
  const env = readFileSync(envPath, 'utf8')
  return Object.fromEntries(env.split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
}
const vars = loadEnv()
if (!vars.NEXT_PUBLIC_SUPABASE_URL || !vars.SUPABASE_SERVICE_ROLE_KEY) { console.error('FATAL: Supabase env vars missing from .env.local'); process.exit(1) }
if (!/^sb_secret_/.test(vars.SUPABASE_SERVICE_ROLE_KEY) && !vars.SUPABASE_SERVICE_ROLE_KEY.startsWith('eyJ')) { console.error('FATAL: SUPABASE_SERVICE_ROLE_KEY does not look like a service-role key'); process.exit(1) }
const sb = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ── Source config — see header comment for how each `filters` array was
// derived (live network capture of the named UI view, not guessed). ─────
const SOURCES = [
  {
    key: 'quotes_migration', entity: 'quote', label: '"PrintOS Migration" — Quotes',
    apiPath: 'transactions/quotes', wrapKey: 'quotes', uiPath: 'quotes',
    filters: [{ by: 'ordered', rule: 'equal', value: false }, { by: 'invoiced', rule: 'equal', value: false }],
  },
  {
    key: 'quotes_voided', entity: 'quote', label: '"Voided Quotes" system view',
    apiPath: 'transactions/quotes', wrapKey: 'quotes', uiPath: 'quotes',
    filters: [{ by: 'workflowState', rule: 'equal', value: 'void' }, { by: 'ordered', rule: 'equal', value: false }, { by: 'invoiced', rule: 'equal', value: false }],
  },
  {
    key: 'sales_orders_migration', entity: 'sales_order', label: '"PrintOS Migration" — Sales Orders',
    apiPath: 'transactions/work_orders', wrapKey: 'workOrders', uiPath: 'sales-orders',
    filters: [{ by: 'invoiced', rule: 'equal', value: false }],
  },
  {
    key: 'sales_orders_voided', entity: 'sales_order', label: '"Voided Sales Orders" system view',
    apiPath: 'transactions/work_orders', wrapKey: 'workOrders', uiPath: 'sales-orders',
    filters: [{ by: 'workflowState', rule: 'equal', value: 'void' }, { by: 'invoiced', rule: 'equal', value: false }],
  },
  {
    key: 'invoices_all', entity: 'invoice', label: '"All Invoices" system view',
    apiPath: 'transactions/invoices', wrapKey: 'invoices', uiPath: 'invoices', filters: [],
  },
  {
    key: 'purchase_orders_migration', entity: 'purchase_order', label: '"PrintOS Migration" — Purchase Orders',
    apiPath: 'transactions/purchase_orders', wrapKey: 'purchaseOrders', uiPath: 'purchase-orders', filters: [],
  },
  {
    key: 'payments_migration', entity: 'payment', label: '"PrintOS Migration" — Payments',
    apiPath: 'transactions/payments', wrapKey: 'payments', uiPath: 'payments', filters: [],
  },
  {
    key: 'credit_memos_migration', entity: 'credit_memo', label: '"PrintOS Migration" — Credit Memos',
    apiPath: 'transactions/credit_memos', wrapKey: 'creditMemos', uiPath: 'credit-memos', filters: [],
  },
  {
    key: 'refunds_migration', entity: 'refund', label: '"PrintOS Migration" — Refunds',
    apiPath: 'transactions/refunds', wrapKey: 'refunds', uiPath: 'refunds', filters: [],
  },
  {
    key: 'customers', entity: 'customer', label: 'Companies (customers)',
    apiPath: 'companies', wrapKey: 'companies', uiPath: 'customers', filters: [],
  },

  // ── Voided-coverage passes — see the header comment above ────────────
  { key: 'quotes_inactive', entity: 'quote', label: 'active=false pass (voided-coverage audit)', apiPath: 'transactions/quotes', wrapKey: 'quotes', uiPath: 'quotes', filters: [{ by: 'active', rule: 'equal', value: false }] },
  { key: 'sales_orders_inactive', entity: 'sales_order', label: 'active=false pass (voided-coverage audit)', apiPath: 'transactions/work_orders', wrapKey: 'workOrders', uiPath: 'sales-orders', filters: [{ by: 'active', rule: 'equal', value: false }] },
  { key: 'invoices_inactive', entity: 'invoice', label: 'active=false pass (voided-coverage audit)', apiPath: 'transactions/invoices', wrapKey: 'invoices', uiPath: 'invoices', filters: [{ by: 'active', rule: 'equal', value: false }] },
  { key: 'credit_memos_inactive', entity: 'credit_memo', label: 'active=false pass (voided-coverage audit)', apiPath: 'transactions/credit_memos', wrapKey: 'creditMemos', uiPath: 'credit-memos', filters: [{ by: 'active', rule: 'equal', value: false }] },
  { key: 'purchase_orders_inactive', entity: 'purchase_order', label: 'active=false pass (voided-coverage audit)', apiPath: 'transactions/purchase_orders', wrapKey: 'purchaseOrders', uiPath: 'purchase-orders', filters: [{ by: 'active', rule: 'equal', value: false }] },
  { key: 'payments_inactive', entity: 'payment', label: 'active=false pass (voided-coverage audit)', apiPath: 'transactions/payments', wrapKey: 'payments', uiPath: 'payments', filters: [{ by: 'active', rule: 'equal', value: false }] },
  { key: 'customers_inactive', entity: 'customer', label: 'active=false pass (voided-coverage audit)', apiPath: 'companies', wrapKey: 'companies', uiPath: 'customers', filters: [{ by: 'active', rule: 'equal', value: false }] },

  // ── sales_lead — new global entity, never enumerated before ───────────
  { key: 'sales_leads_active', entity: 'sales_lead', label: 'Sales Leads (active)', apiPath: 'sales_leads', wrapKey: 'salesLeads', uiPath: 'sales-leads', filters: [] },
  { key: 'sales_leads_inactive', entity: 'sales_lead', label: 'Sales Leads (active=false pass)', apiPath: 'sales_leads', wrapKey: 'salesLeads', uiPath: 'sales-leads', filters: [{ by: 'active', rule: 'equal', value: false }] },
]

const API_HEADERS = { accept: 'application/json, text/plain, */*', 'x-shopvox-client': 'web' }

function buildUrl(source, page) {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('perPage', String(PER_PAGE))
  for (const f of source.filters) params.append('filters[]', JSON.stringify(f))
  return `https://api.shopvox.com/edge/${source.apiPath}?${params.toString()}`
}

// ── Existing queue — load for dedup + resumability ───────────────────────
function loadExistingKeys() {
  const keys = new Set()
  if (!existsSync(QUEUE_FILE)) return keys
  const lines = readFileSync(QUEUE_FILE, 'utf8').split('\n').filter(Boolean)
  for (const line of lines) {
    try { const row = JSON.parse(line); keys.add(`${row.entity}|${row.shopvox_uuid}`) } catch { /* skip malformed line */ }
  }
  return keys
}

async function openRun(source) {
  const { data, error } = await sb.from('historical_import_runs').insert({
    entity: source.entity,
    scope: source.key,
    machine: hostname(),
    status: 'running',
    started_at: new Date().toISOString(),
    records_seen: 0,
    records_captured: 0,
    records_failed: 0,
  }).select().single()
  if (error) { console.error(`  WARNING: could not open historical_import_runs row for ${source.key}: ${error.message}`); return null }
  return data.id
}
async function closeRun(runId, { status, recordsSeen, lastCursor, notes }) {
  if (!runId) return
  await sb.from('historical_import_runs').update({
    status, finished_at: new Date().toISOString(), records_seen: recordsSeen, records_captured: recordsSeen, last_cursor: lastCursor, notes,
  }).eq('id', runId)
}

// ── One source, paginated to exhaustion ──────────────────────────────────
async function enumerateSource(context, source, existingKeys) {
  console.log(`\n=== ${source.key} (${source.label}) ===`)
  const runId = await openRun(source)
  let page = 1
  let reportedTotal = null
  let harvested = 0
  let appended = 0
  const nowIso = new Date().toISOString()
  const outLines = []

  for (;;) {
    const url = buildUrl(source, page)
    const resp = await context.request.get(url, { headers: API_HEADERS })
    // Disposed in a finally (2026-08-26 — same undisposed-APIResponse leak
    // found in scripts/lib/shopvox-api.mjs, see its pacedRequest() comment;
    // this script has its own separate context.request.get() call that
    // doesn't go through that client, so it needs the same fix independently)
    // — every page's response is released whether this page errors, returns
    // early, or is read normally. A full account-wide enumeration can be
    // thousands of pages across ~10 sources; undisposed, that's the same
    // class of leak, just at a smaller total volume than the main capture.
    let body
    try {
      if (resp.status() !== 200) {
        console.error(`  ✗ page ${page}: HTTP ${resp.status()} — aborting this source`)
        await closeRun(runId, { status: 'failed', recordsSeen: harvested, lastCursor: `page ${page}`, notes: `HTTP ${resp.status()}` })
        return { source, reportedTotal, harvested, appended, mismatch: true, error: `HTTP ${resp.status()}` }
      }
      body = await resp.json()
    } finally {
      try { await resp.dispose() } catch {}
    }
    if (reportedTotal === null) reportedTotal = body.meta.totalCount
    const records = body[source.wrapKey] || []
    for (const rec of records) {
      harvested++
      const uuid = rec.id
      const key = `${source.entity}|${uuid}`
      if (existingKeys.has(key)) continue // already queued by a prior run (this source or another feeding the same entity)
      existingKeys.add(key)
      const number = source.entity === 'customer' ? (rec.name ?? null) : source.entity === 'sales_lead' ? (rec.title ?? null) : (rec.txnNumber != null ? String(rec.txnNumber) : null)
      outLines.push(JSON.stringify({
        entity: source.entity,
        shopvox_uuid: uuid,
        url: `https://express.shopvox.com/${source.entity === 'customer' ? 'customers' : source.entity === 'sales_lead' ? 'sales-leads' : 'transactions/' + source.uiPath}/${uuid}`,
        number,
        source: source.key,
        discovered_at: nowIso,
        status: 'pending',
      }))
      appended++
    }
    console.log(`  page ${page}/${body.meta.totalPages}: +${records.length} (harvested ${harvested}/${reportedTotal}, ${appended} new)`)
    if (!body.meta.hasNextPage) break
    page++
  }

  // customers-only range filter, applied after full harvest (cheap: ≤10 pages total)
  if (source.entity === 'customer' && RANGE) {
    const [lo, hi] = RANGE.toUpperCase().split('-')
    const before = outLines.length
    const filtered = outLines.filter((l) => { const n = JSON.parse(l).number || ''; const c = n[0]?.toUpperCase() || ''; return c >= lo && c <= hi })
    console.log(`  --range=${RANGE}: ${filtered.length}/${before} new rows kept`)
    outLines.length = 0
    outLines.push(...filtered)
    appended = filtered.length
  }

  if (outLines.length) appendFileSync(QUEUE_FILE, outLines.join('\n') + '\n')

  const mismatch = harvested !== reportedTotal
  if (mismatch) {
    console.error(`  ⚠️  MISMATCH for ${source.key}: list reported ${reportedTotal}, harvested ${harvested} — logging and continuing, NOT silently accepting this.`)
  } else {
    console.log(`  ✓ harvested ${harvested} matches reported total ${reportedTotal}`)
  }
  await closeRun(runId, { status: mismatch ? 'failed' : 'succeeded', recordsSeen: harvested, lastCursor: `page ${page}`, notes: mismatch ? `reported ${reportedTotal} vs harvested ${harvested}` : null })

  return { source, reportedTotal, harvested, appended, mismatch }
}

async function main() {
  const { context } = await launchBrowser()
  const page = context.pages()[0] ?? (await context.newPage())
  await ensureLoggedInLazy(page)
  // One real page load establishes the session for context.request — the
  // API calls below go through context.request (cookie-authenticated, same
  // mechanism proven in scripts/chain-capture/capture.mjs's PDF downloads),
  // not through page navigation, so this is the only UI page touched at all.
  await page.goto('https://express.shopvox.com/transactions/quotes', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await sleep(1500)

  const existingKeys = loadExistingKeys()
  console.log(`Loaded ${existingKeys.size} existing queue keys from ${QUEUE_FILE}`)

  const toRun = ONLY_SOURCE ? SOURCES.filter((s) => s.key === ONLY_SOURCE) : SOURCES
  if (ONLY_SOURCE && toRun.length === 0) { console.error(`FATAL: unknown --entity=${ONLY_SOURCE}. Valid: ${SOURCES.map((s) => s.key).join(', ')}`); process.exit(1) }

  const results = []
  for (const source of toRun) {
    const res = await enumerateSource(context, source, existingKeys)
    results.push(res)
  }

  // Per-source + rolled-up per-entity totals.
  const byEntity = {}
  for (const r of results) {
    byEntity[r.source.entity] = byEntity[r.source.entity] || { reportedTotal: 0, harvested: 0, appended: 0, sources: [] }
    byEntity[r.source.entity].reportedTotal += r.reportedTotal || 0
    byEntity[r.source.entity].harvested += r.harvested || 0
    byEntity[r.source.entity].appended += r.appended || 0
    byEntity[r.source.entity].sources.push(r.source.key)
  }
  const totalsOut = {
    generatedAt: new Date().toISOString(),
    bySource: Object.fromEntries(results.map((r) => [r.source.key, { entity: r.source.entity, label: r.source.label, reportedTotal: r.reportedTotal, harvested: r.harvested, appendedNew: r.appended, mismatch: !!r.mismatch, error: r.error || null }])),
    byEntity,
  }
  // Merge with any prior totals file (partial --entity runs shouldn't wipe other sources' numbers).
  let merged = totalsOut
  if (existsSync(TOTALS_FILE)) {
    try {
      const prior = JSON.parse(readFileSync(TOTALS_FILE, 'utf8'))
      merged = { generatedAt: totalsOut.generatedAt, bySource: { ...prior.bySource, ...totalsOut.bySource }, byEntity: prior.byEntity }
      // recompute byEntity fresh from the merged bySource so it's never stale
      merged.byEntity = {}
      for (const [key, s] of Object.entries(merged.bySource)) {
        merged.byEntity[s.entity] = merged.byEntity[s.entity] || { reportedTotal: 0, harvested: 0, appended: 0, sources: [] }
        merged.byEntity[s.entity].reportedTotal += s.reportedTotal || 0
        merged.byEntity[s.entity].harvested += s.harvested || 0
        merged.byEntity[s.entity].appended += s.appendedNew || 0
        merged.byEntity[s.entity].sources.push(key)
      }
    } catch { merged = totalsOut }
  }
  writeFileSync(TOTALS_FILE, JSON.stringify(merged, null, 2))

  console.log('\n=== Summary ===')
  for (const r of results) {
    console.log(`  ${r.source.key}: reported=${r.reportedTotal} harvested=${r.harvested} new=${r.appended}${r.mismatch ? '  ⚠️ MISMATCH' : ''}`)
  }
  console.log(`\nWrote ${TOTALS_FILE}`)
  console.log(`Queue file: ${QUEUE_FILE}`)

  await context.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
