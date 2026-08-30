/**
 * shopvox-enumerate-customer.mjs
 *
 * Enumeration-only (no detail pages, no Supabase writes except
 * historical_import_runs bookkeeping): builds a SEPARATE, customer-scoped
 * queue file at scripts/queue/customer-<uuid>.jsonl containing every record
 * belonging to one customer — quotes, sales orders, invoices, credit memos,
 * purchase orders, payments, refunds, jobs, emails, sales leads, and the
 * customer record itself. Never writes to the main scripts/queue/queue.jsonl.
 *
 * WHY A SEPARATE SCRIPT FROM shopvox-enumerate.mjs: the main enumerator
 * walks global "PrintOS Migration" saved views across the whole account —
 * it has no customer filter and isn't supposed to (per its own header). This
 * one is a single customer's complete cross-section, found by querying the
 * ACTUAL customer-scoped API endpoints (not by walking the global lists and
 * filtering client-side, which would mean paging through everything anyway).
 *
 * ENDPOINT NOTES (each confirmed live against Sames Auto Arena, uuid
 * 8f903be5-05db-49f3-826e-11997893f2f8, before writing this script):
 *
 *   transactions/all?filters[]=companyId=X
 *     Quote/WorkOrder(sales_order)/Invoice/CreditMemo in ONE unified list,
 *     txnType field distinguishes them. Implicitly `active:true` only — the
 *     customer's "Transactions grid" total (e.g. 363) is a further UI-view
 *     filter on TOP of this (ordered=false&invoiced=false), not the true
 *     total. The true total needs a second pass with `active:false` added,
 *     which surfaces voided transactions (confirmed identical row set to
 *     `workflowState:void` on this customer — 18 of them). We fetch BOTH.
 *
 *   transactions/{payments|refunds}?filters[]=companyId=X
 *     Same active:true/false split applies (both were all-active for Sames,
 *     0 voided, but we still check both to not silently miss a shop where
 *     that's not true).
 *
 *   transactions/purchase_orders?filters[]=companyId=X
 *     CONFIRMED BROKEN: companyId is silently ignored — returns the full
 *     account-wide PO total (1159) regardless of customer. Purchase orders
 *     don't carry a companyId at all; they're linked off a SALES ORDER
 *     instead. So POs are derived by walking EVERY sales_order (WorkOrder)
 *     record already found (active + voided) and paging its
 *     transactions/work_orders/{id}/purchasings sub-resource.
 *
 *   pro_jobs/list?filters[]=companyId=X
 *     Implicitly excludes BOTH completed and voided jobs (this is the "3
 *     active jobs" badge count, not the total). The true total needs
 *     workflowState=completed and workflowState=voided passes added on top
 *     — confirmed 3 + 420 + 0 = 423 for Sames, matching the account's own
 *     historical figure exactly.
 *
 *   emailed_documents?filters[]=companyId=X — paginate to exhaustion.
 *   sales_leads?filters[]=companyId=X — a genuinely separate resource from
 *     Quote (its own id/workflowState/dealValueInDollars), not a Quote
 *     sub-status. Paginate to exhaustion.
 *
 *   companies/{id} — the customer's own record, queued as entity `customer`
 *     so shopvox-capture.mjs's existing captureCustomer() picks it up.
 *
 * Usage (PowerShell):
 *   node scripts/shopvox-enumerate-customer.mjs --customer=8f903be5-05db-49f3-826e-11997893f2f8
 *   node scripts/shopvox-enumerate-customer.mjs --customer=<uuid> --session-dir=scripts/.shopvox-session-secondary   # separate Chromium profile — run concurrently with another script already using the default session
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostname } from 'node:os'
import { launchBrowser, ensureLoggedInLazy, sleep } from './chain-capture/_lib.mjs'
import { makeApiClient, makeAuthLog } from './lib/shopvox-api.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = __dir
const QUEUE_DIR = join(root, 'queue')
if (!existsSync(QUEUE_DIR)) mkdirSync(QUEUE_DIR, { recursive: true })

const argv = process.argv.slice(2)
function getFlag(name) { const a = argv.find((a) => a.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null }
const CUSTOMER_ID = getFlag('customer')
const RPS = getFlag('rps') ? parseFloat(getFlag('rps')) : 2
if (!CUSTOMER_ID) { console.error('FATAL: --customer=<shopvox-uuid> is required'); process.exit(1) }
// --session-dir=<path>: use a separate Chromium profile instead of the
// shared scripts/.shopvox-session — e.g. to run concurrently with a capture
// already using that profile, without sharing cookies/tokens with it.
const SESSION_DIR_OVERRIDE = getFlag('session-dir') ? join(process.cwd(), getFlag('session-dir')) : null

const QUEUE_FILE = join(QUEUE_DIR, `customer-${CUSTOMER_ID}.jsonl`)

function loadEnv() {
  const envPath = join(root, '..', '.env.local')
  const env = readFileSync(envPath, 'utf8')
  return Object.fromEntries(env.split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
}
const vars = loadEnv()
const sb = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const rows = []
const seen = new Set() // entity|uuid dedup
function push(entity, uuid, url, number, source) {
  const key = `${entity}|${uuid}`
  if (seen.has(key)) return false
  seen.add(key)
  rows.push({ entity, shopvox_uuid: uuid, url, number, source, discovered_at: new Date().toISOString(), status: 'pending' })
  return true
}

const TXN_TYPE_TO_ENTITY = { Quote: 'quote', WorkOrder: 'sales_order', Invoice: 'invoice', CreditMemo: 'credit_memo' }
const ENTITY_TO_URI_PATH = { quote: 'quotes', sales_order: 'sales-orders', invoice: 'invoices', credit_memo: 'credit-memos', purchase_order: 'purchase-orders', payment: 'payments', refund: 'refunds' }

async function fetchAllPages(api, urlForPage, arrayKey) {
  const all = []
  let page = 1
  for (;;) {
    const { status, json } = await api.get(urlForPage(page))
    if (status !== 200 || !json) { console.error(`  ⚠️ non-200 (${status}) at page ${page}: ${urlForPage(page)}`); break }
    all.push(...(json[arrayKey] || []))
    if (!json.meta?.hasNextPage) break
    page++
  }
  return all
}

async function enumerateTransactions(api) {
  const counts = {}
  for (const activeVal of [true, false]) {
    const urlForPage = (p) => `https://api.shopvox.com/edge/transactions/all?page=${p}&perPage=100&filters[]=${encodeURIComponent(JSON.stringify({ by: 'companyId', rule: 'equal', value: CUSTOMER_ID }))}&filters[]=${encodeURIComponent(JSON.stringify({ by: 'active', rule: 'equal', value: activeVal }))}`
    const txns = await fetchAllPages(api, urlForPage, 'transactions')
    console.log(`  transactions/all active=${activeVal}: ${txns.length}`)
    for (const t of txns) {
      const entity = TXN_TYPE_TO_ENTITY[t.txnType]
      if (!entity) { console.error(`  ⚠️ unknown txnType "${t.txnType}" on id ${t.id} — skipped, not queued`); continue }
      const uriPath = ENTITY_TO_URI_PATH[entity]
      push(entity, t.id, `https://express.shopvox.com/transactions/${uriPath}/${t.id}`, t.txnNumber, `transactions/all active=${activeVal}`)
      counts[entity] = (counts[entity] || 0) + 1
    }
  }
  return counts
}

async function enumeratePurchaseOrdersViaSalesOrders(api) {
  const salesOrderRows = rows.filter((r) => r.entity === 'sales_order')
  let poCount = 0
  for (let i = 0; i < salesOrderRows.length; i++) {
    const so = salesOrderRows[i]
    const urlForPage = (p) => `https://api.shopvox.com/edge/transactions/work_orders/${so.shopvox_uuid}/purchasings?page=${p}&perPage=50`
    const pos = await fetchAllPages(api, urlForPage, 'purchaseOrders')
    for (const po of pos) {
      const added = push('purchase_order', po.id, `https://express.shopvox.com/transactions/purchase-orders/${po.id}`, po.txnNumber ?? po.number ?? null, `sales_order:${so.shopvox_uuid}/purchasings`)
      if (added) poCount++
    }
    if ((i + 1) % 50 === 0) console.log(`  ...checked purchasings on ${i + 1}/${salesOrderRows.length} sales orders, ${poCount} POs found so far`)
  }
  console.log(`  purchase orders found via ${salesOrderRows.length} sales orders: ${poCount}`)
  return poCount
}

async function enumerateSimpleTxns(api, kind, entity) {
  let total = 0
  for (const activeVal of [true, false]) {
    const urlForPage = (p) => `https://api.shopvox.com/edge/transactions/${kind}?page=${p}&perPage=100&filters[]=${encodeURIComponent(JSON.stringify({ by: 'companyId', rule: 'equal', value: CUSTOMER_ID }))}&filters[]=${encodeURIComponent(JSON.stringify({ by: 'active', rule: 'equal', value: activeVal }))}`
    const wrapKey = kind // 'payments' / 'refunds' response wrap key matches the path
    const list = await fetchAllPages(api, urlForPage, wrapKey)
    for (const t of list) {
      const added = push(entity, t.id, `https://express.shopvox.com/transactions/${ENTITY_TO_URI_PATH[entity]}/${t.id}`, t.txnNumber, `transactions/${kind} active=${activeVal}`)
      if (added) total++
    }
  }
  return total
}

// The 'voided' bucket below is KNOWN to always return 0 — confirmed in the
// voided-coverage audit (scripts/api-probe/_voided-coverage.md): neither
// workflowState=voided nor active=false nor a txnNumber match ever
// surfaces a job proven to exist and be voided. Kept here anyway (harmless,
// one extra request) as a documented, honest "we checked" rather than
// silently dropping the attempt. The real backstop for voided jobs is the
// closure pass in shopvox-capture.mjs, run after this queue drains — it
// finds them by scanning what OTHER captured records reference, not by any
// filter on this endpoint.
async function enumerateJobs(api) {
  const buckets = [
    { label: 'default(active,non-completed,non-voided)', extra: [] },
    { label: 'completed', extra: [{ by: 'workflowState', rule: 'equal', value: 'completed' }] },
    { label: 'voided (known no-op, kept for the record — see comment above)', extra: [{ by: 'workflowState', rule: 'equal', value: 'voided' }] },
  ]
  let total = 0
  for (const bucket of buckets) {
    const filters = [{ by: 'companyId', rule: 'equal', value: CUSTOMER_ID }, ...bucket.extra]
    const urlForPage = (p) => `https://api.shopvox.com/edge/pro_jobs/list?page=${p}&perPage=100&${filters.map((f) => `filters[]=${encodeURIComponent(JSON.stringify(f))}`).join('&')}`
    const jobs = await fetchAllPages(api, urlForPage, 'jobs')
    console.log(`  jobs (${bucket.label}): ${jobs.length}`)
    for (const j of jobs) {
      const added = push('job', j.id, `https://express.shopvox.com/jobs/${j.id}/Jobs::Normal`, j.name ?? null, `pro_jobs/list ${bucket.label}`)
      if (added) total++
    }
  }
  return total
}

async function enumerateEmails(api) {
  const urlForPage = (p) => `https://api.shopvox.com/edge/emailed_documents?page=${p}&perPage=100&filters[]=${encodeURIComponent(JSON.stringify({ by: 'companyId', rule: 'equal', value: CUSTOMER_ID }))}`
  const emails = await fetchAllPages(api, urlForPage, 'emails')
  let total = 0
  for (const e of emails) {
    const added = push('email', e.id, null, e.emailSubject ?? null, 'emailed_documents')
    if (added) total++
  }
  return total
}

// Voided-coverage audit (scripts/api-probe/_voided-coverage.md) found 219
// inactive sales leads account-wide (vs 966 active) — this function
// originally only fetched companyId, no active pass, the same class of gap
// every other entity here already guards against. Fixed: same active
// true+false loop as enumerateTransactions/enumerateSimpleTxns.
async function enumerateSalesLeads(api) {
  let total = 0
  for (const activeVal of [true, false]) {
    const urlForPage = (p) => `https://api.shopvox.com/edge/sales_leads?page=${p}&perPage=100&filters[]=${encodeURIComponent(JSON.stringify({ by: 'companyId', rule: 'equal', value: CUSTOMER_ID }))}&filters[]=${encodeURIComponent(JSON.stringify({ by: 'active', rule: 'equal', value: activeVal }))}`
    const leads = await fetchAllPages(api, urlForPage, 'salesLeads')
    for (const l of leads) {
      const added = push('sales_lead', l.id, `https://express.shopvox.com/sales-leads/${l.id}`, l.title ?? null, `sales_leads active=${activeVal}`)
      if (added) total++
    }
  }
  return total
}

async function openRun(scope) {
  const { data, error } = await sb.from('historical_import_runs').insert({ entity: 'shopvox_enumerate_customer', scope, machine: hostname(), status: 'running', started_at: new Date().toISOString(), records_seen: 0, records_captured: 0, records_failed: 0 }).select().single()
  if (error) { console.error('WARNING: could not open historical_import_runs row:', error.message); return null }
  return data.id
}
async function closeRun(runId, { status, seen: seenCount, notes }) {
  if (!runId) return
  await sb.from('historical_import_runs').update({ status, finished_at: new Date().toISOString(), records_seen: seenCount, records_captured: seenCount, records_failed: 0, notes }).eq('id', runId)
}

async function main() {
  const { context } = await launchBrowser(undefined, SESSION_DIR_OVERRIDE)
  const page = context.pages()[0] ?? (await context.newPage())
  await ensureLoggedInLazy(page)
  await page.goto('https://express.shopvox.com/transactions/quotes', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await sleep(1500)

  const authLog = makeAuthLog(QUEUE_DIR)
  const api = makeApiClient({ context, page, rps: RPS, authLog })
  const runId = await openRun(CUSTOMER_ID)

  // Customer record itself.
  push('customer', CUSTOMER_ID, `https://express.shopvox.com/customers/${CUSTOMER_ID}`, null, 'customer_self')

  console.log('Enumerating transactions/all (quote/sales_order/invoice/credit_memo, active + voided)...')
  const txnCounts = await enumerateTransactions(api)

  console.log('Deriving purchase orders via each sales order\'s /purchasings...')
  const poCount = await enumeratePurchaseOrdersViaSalesOrders(api)

  console.log('Enumerating payments...')
  const paymentCount = await enumerateSimpleTxns(api, 'payments', 'payment')
  console.log('Enumerating refunds...')
  const refundCount = await enumerateSimpleTxns(api, 'refunds', 'refund')

  console.log('Enumerating jobs (active + completed + voided)...')
  const jobCount = await enumerateJobs(api)

  console.log('Enumerating emails...')
  const emailCount = await enumerateEmails(api)

  console.log('Enumerating sales leads...')
  const leadCount = await enumerateSalesLeads(api)

  writeFileSync(QUEUE_FILE, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')

  const summary = {
    customer: 1,
    quote: txnCounts.quote || 0,
    sales_order: txnCounts.sales_order || 0,
    invoice: txnCounts.invoice || 0,
    credit_memo: txnCounts.credit_memo || 0,
    purchase_order: poCount,
    payment: paymentCount,
    refund: refundCount,
    job: jobCount,
    email: emailCount,
    sales_lead: leadCount,
    total: rows.length,
  }
  console.log('\n=== ENUMERATION SUMMARY ===')
  console.log(JSON.stringify(summary, null, 2))
  console.log(`\nWrote ${rows.length} rows to ${QUEUE_FILE}`)

  await closeRun(runId, { status: 'succeeded', seen: rows.length, notes: JSON.stringify(summary) })
  await context.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
