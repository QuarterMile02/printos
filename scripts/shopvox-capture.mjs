/**
 * shopvox-capture.mjs
 *
 * Drains scripts/queue/queue.jsonl via the REST API documented in
 * scripts/api-probe/_findings.md. READ-ONLY: GET only against
 * api.shopvox.com. Writes one JSON file per record to
 * scripts/capture/<entity>/<uuid>.json containing RAW API response bodies,
 * unmodified, keyed by endpoint name — no reshaping, no flattening. That's
 * the importer's job, in a later separate step. The only Supabase write
 * this script makes is a historical_import_runs bookkeeping row.
 *
 * OUTPUT SHAPE (see also inline per-function comments):
 *   { entity, shopvox_uuid, source, capturedAt,
 *     endpoints: { <name>: { status, url, body: <raw parsed JSON or null> } },
 *     lineItems: { <lineItemId>: { parameters: {...}, product: {...} } },  // transactions only
 *   }
 * PDFs are saved as files under scripts/capture/pdfs/, referenced from the
 * record's endpoints.pdf entry (status/url/sizeBytes/savedTo), not inlined.
 *
 * DISCOVERY: when a captured record's previous_transactions/next_transactions
 * reveals a parent quote/sales-order/invoice not already in the queue, or a
 * line item's `jobId` reveals a job not already in the queue, that record is
 * appended to queue.jsonl as status:'pending'. This is how converted quotes/
 * sales-orders and ~14,000 jobs get enumerated — shopvox-enumerate.mjs
 * deliberately does not seed them (see that file's header).
 *
 * Usage (PowerShell — one command per line, no &&):
 *   node scripts/shopvox-capture.mjs --validate-chain-a
 *   node scripts/shopvox-capture.mjs --limit=50
 *   node scripts/shopvox-capture.mjs --entity=quote --rps=3
 *   node scripts/shopvox-capture.mjs --entity=quote,sales_order,invoice   # comma list — see below
 *   node scripts/shopvox-capture.mjs --entity=customer --range=A-M
 *   node scripts/shopvox-capture.mjs --queue=scripts/queue/customer-<uuid>.jsonl   # drain a customer-scoped queue instead of the main one
 *   node scripts/shopvox-capture.mjs                      # full run (all pending, all entities, main queue)
 *
 * SPLITTING ACROSS TWO MACHINES: --entity accepts a comma-separated list so
 * each machine can own a disjoint set of entity kinds against its OWN LOCAL
 * copy of queue.jsonl (e.g. machine A: --entity=quote,sales_order,invoice,
 * purchase_order,credit_memo,payment,refund; machine B: --entity=job,customer).
 * Do NOT point two machines at the same queue.jsonl over a network share —
 * the atomic-rename checkpoint flush is safe against a single writer plus a
 * crash, not against two concurrent writers. --range=A-M/N-Z further splits
 * the customer entity alphabetically if one machine's customer share is
 * still too large on its own.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostname } from 'node:os'
import { launchBrowser, ensureLoggedInLazy, sleep } from './chain-capture/_lib.mjs'
import { makeApiClient, makeAuthLog } from './lib/shopvox-api.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = __dir
const CAPTURE_DIR = join(root, 'capture')
const PDF_DIR = join(CAPTURE_DIR, 'pdfs')
const VALIDATE_DIR = join(root, 'api-probe', 'validate-chainA')
for (const d of [CAPTURE_DIR, PDF_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true })

// ── Memory log (Task AL step 2b, 2026-08-26) ──────────────────────────────
// Capture death #4 was a 29-hour, 41,766-record heap OOM with nothing to
// read afterward — the only memory readings that exist were a handful taken
// by luck via ad-hoc PowerShell checks overnight. Appends RSS/heapUsed every
// MEMORY_LOG_INTERVAL records so the NEXT incident has an actual curve
// instead of a few scattered points. Same append-only-JSONL convention as
// _auth_log.jsonl; failure to write is never fatal to the run itself.
const MEMORY_LOG_PATH = join(CAPTURE_DIR, '_memory_log.jsonl')
const MEMORY_LOG_INTERVAL = 50 // records — ~835 lines over a full 41,766-record run, trivial size
function logMemory(label, extra = {}) {
  const m = process.memoryUsage()
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    label,
    rssMb: Math.round(m.rss / 1024 / 1024),
    heapUsedMb: Math.round(m.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(m.heapTotal / 1024 / 1024),
    externalMb: Math.round(m.external / 1024 / 1024),
    arrayBuffersMb: Math.round((m.arrayBuffers ?? 0) / 1024 / 1024),
    ...extra,
  })
  try { appendFileSync(MEMORY_LOG_PATH, line + '\n') } catch { /* best-effort, same as authLog */ }
}

const argv = process.argv.slice(2)
function getFlag(name) { const a = argv.find((a) => a.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null }
function hasFlag(name) { return argv.includes(`--${name}`) }
const ONLY_ENTITIES = getFlag('entity') ? new Set(getFlag('entity').split(',').map((s) => s.trim()).filter(Boolean)) : null
const RANGE = getFlag('range')
const RPS = getFlag('rps') ? parseFloat(getFlag('rps')) : 2
const LIMIT = getFlag('limit') ? parseInt(getFlag('limit')) : null
// --queue=<path> drains a specific queue file instead of the default main
// one (e.g. scripts/queue/customer-<uuid>.jsonl from shopvox-enumerate-
// customer.mjs). Relative paths resolve from the current working directory.
const QUEUE_FILE = getFlag('queue') ? join(process.cwd(), getFlag('queue')) : join(root, 'queue', 'queue.jsonl')
const VALIDATE_CHAIN_A = hasFlag('validate-chain-a')

// ── Single-instance guard ─────────────────────────────────────────────────
// Two processes draining the SAME queue file race on its checkpoint flush —
// confirmed live: a second instance got started against the Sames
// customer-scoped queue without the first one having exited, and cost a
// handful of done-status flags getting silently reverted to pending. The
// full run is ~57,000 records; that failure mode there would be a genuine
// problem, not a minor inconvenience. One lock file per queue file (not a
// single global lock) — intentionally, so splitting different queue files
// across machines/entities still works.
const LOCK_PATH = QUEUE_FILE + '.lock'
function isPidAlive(pid) {
  try { process.kill(pid, 0); return true } catch (e) { return e.code !== 'ESRCH' } // ESRCH = no such process; EPERM etc still means it exists
}
function acquireLock() {
  if (existsSync(LOCK_PATH)) {
    let existing
    try { existing = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) } catch { existing = null }
    if (existing && isPidAlive(existing.pid)) {
      console.error(`\nFATAL: another shopvox-capture.mjs is already draining this queue file.`)
      console.error(`  Lock: ${LOCK_PATH}`)
      console.error(`  Held by pid ${existing.pid}, started ${existing.startedAt}`)
      console.error(`  Refusing to start a second writer against the same queue — this is exactly the race that corrupted the Sames checkpoint.`)
      console.error(`  If that process is genuinely gone despite the OS still reporting the pid alive, remove the lock file manually and re-run.`)
      process.exit(1)
    }
    console.warn(`  Stale lock found (pid ${existing?.pid ?? '?'} no longer running) — removing and proceeding.`)
    try { unlinkSync(LOCK_PATH) } catch {}
  }
  writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, queuePath: QUEUE_FILE, startedAt: new Date().toISOString() }, null, 2))
  // Fires on every termination path except SIGKILL/power loss — normal
  // return, explicit process.exit() anywhere (including inside the SIGINT
  // handler below), and uncaught exceptions. A stale lock left by SIGKILL
  // self-heals via the isPidAlive() check on the next launch, so this never
  // requires manual cleanup to recover from, only to avoid a live race.
  process.on('exit', () => { try { unlinkSync(LOCK_PATH) } catch {} })
}

// ── Env / Supabase (bookkeeping only) ────────────────────────────────────
function loadEnv() {
  const envPath = join(root, '..', '.env.local')
  const env = readFileSync(envPath, 'utf8')
  return Object.fromEntries(env.split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
}
const vars = loadEnv()
const sb = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ── Endpoint config per transaction-like kind ────────────────────────────
// apiPath = the URL segment under transactions/<apiPath>/{id} AND the
// segment used for {apiPath}/{id}/activities (confirmed live to be the
// non-"transactions/"-prefixed form for activities specifically — see
// scripts/api-probe/_findings.md). uiKind = the capitalized singular type
// name emailed_documents' transactableType filter expects (confirmed
// "Invoice" live; the others follow the same Rails-class-name pattern).
const TX_KINDS = {
  quote: { apiPath: 'quotes', uiKind: 'Quote', hasBom: true, hasPdf: true, pdfType: null },
  sales_order: { apiPath: 'work_orders', uiKind: 'WorkOrder', hasBom: true, hasPdf: true, pdfType: 'WorkOrder' },
  invoice: { apiPath: 'invoices', uiKind: 'Invoice', hasBom: true, hasPdf: true, pdfType: null },
  purchase_order: { apiPath: 'purchase_orders', uiKind: 'PurchaseOrder', hasBom: false, hasPdf: false, pdfType: null },
  credit_memo: { apiPath: 'credit_memos', uiKind: 'CreditMemo', hasBom: false, hasPdf: false, pdfType: null },
}
const SIMPLE_KINDS = { payment: { apiPath: 'payments' }, refund: { apiPath: 'refunds' } }

function sortsParam(by, direction) { return `sorts[]=${encodeURIComponent(JSON.stringify({ by, direction }))}` }

// Fetch every page of a paginated endpoint and merge into one combined
// response (same {meta,<key>} shape, meta.totalCount preserved, the array
// concatenated) — so paginated feeds (activities, proofs, customer emails)
// still land in the output as ONE raw-response-shaped entry per endpoint
// name, per the "keyed by endpoint" contract, rather than N page fragments.
async function fetchAllPages(api, urlForPage, arrayKey, maxPages = 2000) {
  let page = 1
  let combined = null
  for (;;) {
    const { status, json, url } = await api.get(urlForPage(page))
    if (status !== 200 || !json) return { status, url, body: json }
    if (!combined) combined = { meta: json.meta, [arrayKey]: [] }
    combined[arrayKey].push(...(json[arrayKey] || []))
    if (!json.meta?.hasNextPage || page >= maxPages) break
    page++
  }
  return { status: 200, url: urlForPage(1), body: combined }
}

async function fetchOne(api, url) {
  const { status, json } = await api.get(url)
  return { status, url, body: json }
}

// ── Transaction capture (quote / sales_order / invoice / purchase_order / credit_memo) ──
async function captureTransaction(api, kind, uuid, discover) {
  const cfg = TX_KINDS[kind]
  const base = `https://api.shopvox.com/edge/transactions/${cfg.apiPath}/${uuid}`
  const endpoints = {}

  endpoints.detail = await fetchOne(api, base)
  endpoints.prices = await fetchOne(api, `${base}/prices`)
  endpoints.taggings = await fetchOne(api, `https://api.shopvox.com/edge/${cfg.apiPath}/${uuid}/taggings`)
  endpoints.previous_transactions = await fetchOne(api, `${base}/previous_transactions`)
  endpoints.next_transactions = await fetchOne(api, `${base}/next_transactions`)
  endpoints.line_items = await fetchOne(api, `${base}/line_items?${sortsParam('position', 'asc')}`)
  endpoints.activities = await fetchAllPages(api, (p) => `https://api.shopvox.com/edge/${cfg.apiPath}/${uuid}/activities?page=${p}&perPage=50`, 'activities')

  if (cfg.hasBom) endpoints.bom = await fetchOne(api, `https://api.shopvox.com/edge/${cfg.apiPath}/${uuid}/bom`)
  if (cfg.hasBom) { // emailed_documents was only confirmed for the 3 core tx kinds that have a real Emails tab
    endpoints.emailed_documents = await fetchAllPages(api, (p) => `https://api.shopvox.com/edge/emailed_documents?page=${p}&perPage=50&filters[]=${encodeURIComponent(JSON.stringify({ by: 'transactableId', rule: 'equal', value: uuid }))}&filters[]=${encodeURIComponent(JSON.stringify({ by: 'transactableType', rule: 'equal', value: cfg.uiKind }))}`, 'emails')
  }
  if (cfg.hasPdf) {
    const pdfPath = kind === 'sales_order' ? 'work_orders' : cfg.apiPath
    const pdfUrl = `https://api.shopvox.com/edge/${pdfPath}/${uuid}/pdf_document${cfg.pdfType ? `?pdf_type=${cfg.pdfType}` : ''}`
    endpoints.pdf = await savePdf(api, pdfUrl, `${kind}_${uuid}`)
  }

  // Line items: parameters + product per item.
  const lineItems = {}
  const liList = endpoints.line_items.body?.lineItems || []
  for (const li of liList) {
    const liId = li.id
    const params = await fetchOne(api, `${base}/line_items/${liId}/parameters`)
    let product = null
    if (li.productId) product = await fetchOne(api, `https://api.shopvox.com/edge/products/${li.productId}`)
    lineItems[liId] = { parameters: params, product }
    if (li.jobId) discover('job', li.jobId)
  }

  // Discovery: parent quote/SO from previous_transactions.
  const prevType2Entity = { Quote: 'quote', WorkOrder: 'sales_order', Invoice: 'invoice' }
  for (const t of endpoints.previous_transactions.body?.previousTransactions || []) {
    const ent = prevType2Entity[t.type]
    if (ent) discover(ent, t.id)
  }

  return { endpoints, lineItems }
}

// PDFs aren't JSON — api.getBinary() runs the exact same rate-limiter/401-
// refresh/429-5xx-backoff loop as api.get(), just returns raw bytes. One
// request per PDF, fully paced — no second unpaced fetch.
async function savePdf(api, pdfUrl, filenameBase) {
  const { status, buffer } = await api.getBinary(pdfUrl)
  if (status !== 200 || !buffer) return { status, url: pdfUrl, savedTo: null, sizeBytes: 0 }
  const path = join(PDF_DIR, `${filenameBase}.pdf`)
  writeFileSync(path, buffer)
  return { status, url: pdfUrl, savedTo: path, sizeBytes: buffer.length }
}

// ── Simple financial records (payment / refund) ──────────────────────────
async function captureSimple(api, kind, uuid) {
  const cfg = SIMPLE_KINDS[kind]
  const base = `https://api.shopvox.com/edge/transactions/${cfg.apiPath}/${uuid}`
  const endpoints = {}
  endpoints.detail = await fetchOne(api, base)
  endpoints.taggings = await fetchOne(api, `https://api.shopvox.com/edge/${cfg.apiPath}/${uuid}/taggings`)
  endpoints.previous_transactions = await fetchOne(api, `${base}/previous_transactions`)
  endpoints.next_transactions = await fetchOne(api, `${base}/next_transactions`)
  return { endpoints, lineItems: {} }
}

// ── Job capture ───────────────────────────────────────────────────────────
async function captureJob(api, uuid, discover) {
  const endpoints = {}
  endpoints.detail = await fetchOne(api, `https://api.shopvox.com/edge/pro_jobs/${uuid}`)
  // steps carries lastEvent.eventStartAt + actualTime per step — the
  // production-timing data this whole investigation was chasing. Never drop it.
  endpoints.steps = await fetchOne(api, `https://api.shopvox.com/edge/pro_jobs/${uuid}/steps`)
  endpoints.assignments = await fetchOne(api, `https://api.shopvox.com/edge/jobs/${uuid}/assignments`)
  endpoints.proofs = await fetchAllPages(api, (p) => `https://api.shopvox.com/edge/jobs/${uuid}/proofs?page=${p}&perPage=50&${sortsParam('version', 'desc')}`, 'proofs')
  endpoints.activities = await fetchAllPages(api, (p) => `https://api.shopvox.com/edge/jobs/${uuid}/activities?page=${p}&perPage=50`, 'activities')
  endpoints.previous_transactions = await fetchOne(api, `https://api.shopvox.com/edge/jobs/${uuid}/previous_transactions`)

  // job.orderId is the job's associated transaction, but NOT always an
  // invoice — CONFIRMED LIVE (contrast-customer capture): job.transaction.type
  // is "WorkOrder" for a job that hasn't been invoiced yet, "Invoice" once it
  // has. Hardcoding discover('invoice', orderId) queued the sales order's own
  // uuid a second time AS an invoice, which then 404'd on capture (a real,
  // reproducible parse failure — not a transient issue). Use the actual type.
  const orderId = endpoints.detail.body?.job?.orderId
  const orderType = endpoints.detail.body?.job?.transaction?.type
  const ORDER_TYPE_TO_ENTITY = { Quote: 'quote', WorkOrder: 'sales_order', Invoice: 'invoice' }
  if (orderId) discover(ORDER_TYPE_TO_ENTITY[orderType] || 'invoice', orderId) // fall back to invoice only if type is genuinely unknown — still better than assuming
  return { endpoints, lineItems: {} }
}

// ── Customer capture ──────────────────────────────────────────────────────
async function captureCustomer(api, uuid) {
  const endpoints = {}
  endpoints.detail = await fetchOne(api, `https://api.shopvox.com/edge/companies/${uuid}`)
  endpoints.contacts = await fetchAllPages(api, (p) => `https://api.shopvox.com/edge/contacts?page=${p}&perPage=50&filters[]=${encodeURIComponent(JSON.stringify({ by: 'companyId', rule: 'equal', value: uuid }))}`, 'contacts')
  endpoints.emails = await fetchAllPages(api, (p) => `https://api.shopvox.com/edge/emailed_documents?page=${p}&perPage=100&filters[]=${encodeURIComponent(JSON.stringify({ by: 'companyId', rule: 'equal', value: uuid }))}`, 'emails')
  return { endpoints, lineItems: {} }
}

// ── Email capture (customer-scoped queues only — the main queue never
// enumerates individual emails; they're a sub-resource of captureCustomer
// there instead). A single-id filter on the same list endpoint returns the
// exact same full record (body/attachments/openedAt etc.) as the list page. ──
async function captureEmail(api, uuid) {
  const endpoints = {}
  endpoints.detail = await fetchOne(api, `https://api.shopvox.com/edge/emailed_documents?filters[]=${encodeURIComponent(JSON.stringify({ by: 'id', rule: 'equal', value: uuid }))}`)
  return { endpoints, lineItems: {} }
}

// ── Sales lead capture (customer-scoped queues only) — a genuinely separate
// resource from Quote (own id/workflowState/dealValueInDollars), confirmed
// live via network capture of the Sales Leads board. ──────────────────────
async function captureSalesLead(api, uuid) {
  const endpoints = {}
  endpoints.detail = await fetchOne(api, `https://api.shopvox.com/edge/sales_leads/${uuid}`)
  endpoints.activities = await fetchAllPages(api, (p) => `https://api.shopvox.com/edge/sales_leads/${uuid}/activities?page=${p}&perPage=50`, 'activities')
  endpoints.taggings = await fetchOne(api, `https://api.shopvox.com/edge/sales_leads/${uuid}/taggings`)
  return { endpoints, lineItems: {} }
}

// ── Queue ─────────────────────────────────────────────────────────────────
function loadQueue() {
  const rows = readFileSync(QUEUE_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const index = new Map()
  rows.forEach((r, i) => index.set(`${r.entity}|${r.shopvox_uuid}`, i))
  return { rows, index }
}
let flushDirty = false
let lastFlushAt = 0
// Windows can hold a transient handle on a freshly-written file (AV scan,
// a concurrent reader like a status-check one-liner) long enough that
// renameSync's EPERM/EBUSY/EACCES kills the whole run over a lock that
// clears itself within milliseconds. Retry a few times with short backoff
// before treating it as real. Confirmed live 2026-08-24: a capture run
// died exactly this way at 9,527/39,645 with no other symptom.
const RENAME_RETRY_DELAYS_MS = [150, 300, 600, 900, 1200] // ~3.15s total across 5 attempts
function blockingSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
function renameWithRetry(tmp, dest) {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, dest)
      if (attempt > 0) console.warn(`  flushQueue: rename succeeded on retry ${attempt} (${dest})`)
      return
    } catch (err) {
      const retryable = err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES'
      if (!retryable || attempt >= RENAME_RETRY_DELAYS_MS.length) throw err
      console.warn(`  flushQueue: rename attempt ${attempt + 1} failed (${err.code}), retrying in ${RENAME_RETRY_DELAYS_MS[attempt]}ms...`)
      blockingSleep(RENAME_RETRY_DELAYS_MS[attempt])
    }
  }
}
function flushQueue(rows, force = false) {
  if (!flushDirty && !force) return
  if (!force && Date.now() - lastFlushAt < 10000) return
  const tmp = QUEUE_FILE + '.tmp'
  writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
  renameWithRetry(tmp, QUEUE_FILE) // atomic on the same filesystem — crash-safe checkpoint
  flushDirty = false
  lastFlushAt = Date.now()
}

// Every entity kind this queue ever holds a row for — used only by the
// phantom-detection guard below to check "does this uuid already have a
// DONE row under some OTHER kind", not for anything performance-sensitive
// (11 map lookups worst case per discover() call).
const ALL_ENTITY_KINDS = [...Object.keys(TX_KINDS), ...Object.keys(SIMPLE_KINDS), 'job', 'customer', 'email', 'sales_lead']

function rowUrl(entity, uuid) {
  return entity === 'job' ? `https://express.shopvox.com/jobs/${uuid}/Jobs::Normal` : `https://express.shopvox.com/transactions/${{ quote: 'quotes', sales_order: 'sales-orders', invoice: 'invoices' }[entity] || entity}/${uuid}`
}

function main_discover(rows, index, discoveries) {
  return (entity, uuid) => {
    const key = `${entity}|${uuid}`
    if (index.has(key)) return

    // Phantom-detection guard: a mistagged discover() call queues the same
    // real-world transaction uuid under the WRONG entity kind — diagnosed
    // three separate times and never fixed until now (Sames 108, Bolillos
    // 13, Indiana Transport SA de CV 3), always from trusting a stale/
    // ambiguous type hint (job.orderId's reported type, previous_
    // transactions' reported type) instead of the uuid's real kind.
    // transactions/{kind}/{id} is confirmed type-checked (scripts/api-probe/
    // 13_endpoint_confirm_and_customer_lookups.mjs) — a wrong-kind fetch
    // ALWAYS 404s, it can never legitimately be captured. If this exact
    // uuid already has a DONE row under some other entity, we already know
    // its real kind; queueing it again under a different one would only
    // reproduce the same dead-on-arrival capture drain() would eventually
    // mark 'done' with a 404 body anyway (see the parse-failure notes in
    // SHOPVOX_MIGRATION_NOTES.md for why that's misleading downstream).
    // Recording it as 'skipped' up front costs nothing and is honest about
    // what it is. This only catches the case where the correct-kind row
    // already finished by the time the wrong-kind discovery fires — order
    // of capture within a run still matters; it's a guard against the
    // known failure mode, not a structural guarantee.
    for (const otherEntity of ALL_ENTITY_KINDS) {
      if (otherEntity === entity) continue
      const otherIdx = index.get(`${otherEntity}|${uuid}`)
      if (otherIdx !== undefined && rows[otherIdx].status === 'done') {
        const row = {
          entity, shopvox_uuid: uuid, url: rowUrl(entity, uuid),
          number: null, source: 'discovered_during_capture', discovered_at: new Date().toISOString(),
          status: 'skipped',
          reason: `phantom_entity_mistag: already captured as '${otherEntity}' (done) — transactions/{kind}/{id} is type-checked, this uuid cannot also be a real '${entity}'`,
        }
        rows.push(row)
        index.set(key, rows.length - 1)
        discoveries.count++ // still worth counting as "discovered" for visibility, even though pre-resolved
        flushDirty = true
        return
      }
    }

    const row = {
      entity, shopvox_uuid: uuid, url: rowUrl(entity, uuid),
      number: null, source: 'discovered_during_capture', discovered_at: new Date().toISOString(), status: 'pending',
    }
    rows.push(row)
    index.set(key, rows.length - 1)
    discoveries.count++
    flushDirty = true
  }
}

async function captureOne(api, row, discover) {
  if (row.entity in TX_KINDS) return captureTransaction(api, row.entity, row.shopvox_uuid, discover)
  if (row.entity in SIMPLE_KINDS) return captureSimple(api, row.entity, row.shopvox_uuid)
  if (row.entity === 'job') return captureJob(api, row.shopvox_uuid, discover)
  if (row.entity === 'customer') return captureCustomer(api, row.shopvox_uuid)
  if (row.entity === 'email') return captureEmail(api, row.shopvox_uuid)
  if (row.entity === 'sales_lead') return captureSalesLead(api, row.shopvox_uuid)
  throw new Error(`unknown entity kind: ${row.entity}`)
}

function writeRecordFile(row, result) {
  const dir = join(CAPTURE_DIR, row.entity)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const out = { entity: row.entity, shopvox_uuid: row.shopvox_uuid, source: row.source, capturedAt: new Date().toISOString(), endpoints: result.endpoints, lineItems: result.lineItems }
  writeFileSync(join(dir, `${row.shopvox_uuid}.json`), JSON.stringify(out, null, 2))
}

// ── historical_import_runs bookkeeping ───────────────────────────────────
async function openRun(scope) {
  const { data, error } = await sb.from('historical_import_runs').insert({ entity: 'shopvox_capture', scope, machine: hostname(), status: 'running', started_at: new Date().toISOString(), records_seen: 0, records_captured: 0, records_failed: 0 }).select().single()
  if (error) { console.error('WARNING: could not open historical_import_runs row:', error.message); return null }
  return data.id
}
async function closeRun(runId, { status, seen, captured, failed, notes }) {
  if (!runId) return
  await sb.from('historical_import_runs').update({ status, finished_at: new Date().toISOString(), records_seen: seen, records_captured: captured, records_failed: failed, notes }).eq('id', runId)
}

// Pulled out of drain()'s loop body so the synthetic phantom-guard test can
// assert against the SAME scan predicate drain() actually runs, rather than
// a re-implementation that could silently drift from it. Behavior
// unchanged: linear scan forward from scanCursor for the next row whose
// status is exactly 'pending' (so 'done'/'failed'/'skipped' are all
// equally invisible to it) and matches filterFn.
function findNextPendingIndex(rows, scanCursor, filterFn) {
  for (let i = scanCursor; i < rows.length; i++) {
    if (rows[i].status === 'pending' && filterFn(rows[i])) return i
  }
  return -1
}

// ── Main drain loop ───────────────────────────────────────────────────────
async function drain({ context, page, api, filterFn, limit, scopeLabel }) {
  const { rows, index } = loadQueue()
  const discoveries = { count: 0 }
  const discover = main_discover(rows, index, discoveries)

  const initialPendingCount = rows.filter((r) => r.status === 'pending' && filterFn(r)).length
  console.log(`${scopeLabel}: ${initialPendingCount} pending record(s) match filter at start${limit ? ` (capped at ${limit} total — a smoke-test/testing cap, not a claim of completion)` : ''}`)

  const runId = await openRun(scopeLabel)
  let captured = 0, failed = 0
  let reachedCompletion = false // true only if the loop ended because nothing pending remained, not because --limit cut it short
  const t0 = Date.now()
  let sigintFlush = () => flushQueue(rows, true)
  process.on('SIGINT', () => { console.log('\nSIGINT — flushing checkpoint before exit...'); sigintFlush(); process.exit(130) })
  logMemory('drain_start', { scopeLabel })

  // CONFIRMED LIVE this matters: the old version fixed `toProcess` once at
  // the start from a snapshot of `pending`. Rows appended mid-run by
  // discover() (a captured record's line item pointing to a job/parent
  // transaction not yet queued) were never revisited — they sat as
  // 'pending' in the persisted queue forever, only picked up by a
  // completely separate later run. 11 jobs were stranded exactly this way
  // on Sames alone (see scripts/api-probe/_voided-coverage.md). Loop until
  // nothing pending remains — including anything discovered along the way
  // — rather than stopping at the initial snapshot's length. `scanCursor`
  // makes this amortized O(n) over the whole run, same as before, just
  // correctly re-scanning forward instead of stopping at a fixed boundary.
  let processed = 0
  let scanCursor = 0
  for (;;) {
    if (limit && processed >= limit) { console.log(`  --limit=${limit} reached — stopping. Pending rows may remain; this is a deliberate cap, not completion.`); break }
    const nextIdx = findNextPendingIndex(rows, scanCursor, filterFn)
    if (nextIdx === -1) { console.log('  no pending records remain — drain complete.'); reachedCompletion = true; break }
    scanCursor = nextIdx

    const row = rows[nextIdx]
    processed++
    console.log(`[${processed}${limit ? '/' + limit : ''}] ${row.entity} ${row.shopvox_uuid} (${row.number ?? ''})`)
    try {
      const result = await captureOne(api, row, discover)
      writeRecordFile(row, result)
      row.status = 'done'
      row.captured_at = new Date().toISOString()
      captured++
    } catch (e) {
      console.error(`  ✗ FAILED: ${e.message}`)
      row.status = 'failed'
      row.error = String(e.message || e)
      failed++
    }
    flushDirty = true
    flushQueue(rows) // time-boxed — only actually writes every ~10s
    if (processed % 20 === 0) console.log(`  discovered ${discoveries.count} new record(s) so far`)
    if (processed % MEMORY_LOG_INTERVAL === 0) logMemory('drain_progress', { scopeLabel, processed, captured, failed })
  }
  flushQueue(rows, true) // final flush, always
  logMemory('drain_end', { scopeLabel, processed, captured, failed })
  const elapsedSec = (Date.now() - t0) / 1000

  await closeRun(runId, { status: 'succeeded', seen: processed, captured, failed, notes: JSON.stringify({ discoveries: discoveries.count }) })

  console.log(`\n=== ${scopeLabel} summary ===`)
  console.log(`captured=${captured} failed=${failed} discovered=${discoveries.count} elapsedSec=${elapsedSec.toFixed(1)} recordsPerHour=${Math.round((captured / elapsedSec) * 3600)}`)
  return { captured, failed, discovered: discoveries.count, elapsedSec, reachedCompletion }
}

// ── Chain A validation ────────────────────────────────────────────────────
async function validateChainA({ api }) {
  console.log('\n=== VALIDATE: re-capturing chain A via API ===')
  const CHAIN_A = [
    { entity: 'quote', uuid: '9ca037d8-d093-4f3c-9fbf-f6d6790bdc0a', label: 'QT #13556' },
    { entity: 'sales_order', uuid: '6af526c8-44d1-407a-a6d4-6962cbcc710b', label: 'SO #9380' },
    { entity: 'invoice', uuid: '4dd07ab8-553b-4df8-93b9-10b3f9980b1a', label: 'IN #9380' },
    { entity: 'job', uuid: 'ae287bfc-2711-4e26-82f1-63ef85ff782b', label: 'JB #14597' },
  ]
  if (!existsSync(VALIDATE_DIR)) mkdirSync(VALIDATE_DIR, { recursive: true })
  const noop = () => {}
  for (const rec of CHAIN_A) {
    console.log(`  capturing ${rec.label}...`)
    const result = await captureOne(api, { entity: rec.entity, shopvox_uuid: rec.uuid }, noop)
    writeFileSync(join(VALIDATE_DIR, `${rec.entity}_${rec.uuid}.json`), JSON.stringify({ entity: rec.entity, shopvox_uuid: rec.uuid, endpoints: result.endpoints, lineItems: result.lineItems }, null, 2))
  }
  console.log(`  wrote API captures to ${VALIDATE_DIR}`)
  console.log('  Run scripts/api-probe/03_diff_chainA.mjs to compare against scripts/chain-capture/chainA/*.json')
}

// ── Job-discovery closure pass ──────────────────────────────────────────
// Formalizes what started as a one-off probe (scripts/api-probe/
// 11_job_closure_pass.mjs) into a standard post-drain step. Per
// scripts/api-probe/_voided-coverage.md: pro_jobs/list cannot enumerate
// voided jobs by ANY filter tested (workflowState, active, txnNumber —
// equal/greaterThan/greaterThanOrEqual all fail on a job proven to exist).
// The only route to them is whatever already-captured data references
// them. Scans every 'done' row's capture file for job-uuid-shaped
// references — transaction line items' jobId, an email's parent.jobId
// (JobProof) / parent.id (Job), a job's own referenceJobId — captures
// anything not already queued, and repeats until a pass finds nothing new.
// Residual caveat, stated plainly rather than implied away: a voided job
// referenced by NOTHING we've captured stays invisible to this too. This
// raises confidence, it doesn't prove completeness.
function scanCapturedFilesForJobIds(rows) {
  const found = new Set()
  for (const row of rows) {
    if (row.status !== 'done') continue
    const filePath = join(CAPTURE_DIR, row.entity, `${row.shopvox_uuid}.json`)
    if (!existsSync(filePath)) continue
    let data
    try { data = JSON.parse(readFileSync(filePath, 'utf8')) } catch { continue }

    if (row.entity in TX_KINDS) {
      for (const li of data.endpoints?.line_items?.body?.lineItems || []) {
        if (li.jobId) found.add(li.jobId)
      }
    }
    if (row.entity === 'email') {
      const parent = data.endpoints?.detail?.body?.emails?.[0]?.parent
      if (parent?.type === 'JobProof' && parent.jobId) found.add(parent.jobId)
      if (parent?.type === 'Job' && parent.id) found.add(parent.id)
    }
    if (row.entity === 'job') {
      const job = data.endpoints?.detail?.body?.job
      if (job?.referenceJobId) found.add(job.referenceJobId)
    }
  }
  return found
}

async function closureScanJobs({ api }) {
  console.log('\n=== Job-discovery closure pass ===')
  const passReports = []
  let passNum = 0
  for (;;) {
    passNum++
    const { rows, index } = loadQueue()
    const enumeratedJobIds = new Set(rows.filter((r) => r.entity === 'job').map((r) => r.shopvox_uuid))
    const scanned = scanCapturedFilesForJobIds(rows)
    const newIds = [...scanned].filter((id) => !enumeratedJobIds.has(id))
    console.log(`  pass ${passNum}: enumerated=${enumeratedJobIds.size} scanned=${scanned.size} new=${newIds.length}`)
    passReports.push({ pass: passNum, enumeratedBefore: enumeratedJobIds.size, scanned: scanned.size, new: newIds.length })

    // Sweep in any job rows sitting pending too (e.g. from a previous run's
    // mid-drain discovery, or from this pass's own prior iteration) — a
    // second safety net alongside the drain-loop fix, not a replacement for it.
    for (const jobId of newIds) {
      const key = `job|${jobId}`
      if (!index.has(key)) {
        rows.push({ entity: 'job', shopvox_uuid: jobId, url: `https://express.shopvox.com/jobs/${jobId}/Jobs::Normal`, number: null, source: 'closure_pass', discovered_at: new Date().toISOString(), status: 'pending' })
        index.set(key, rows.length - 1)
      }
    }
    const pendingJobs = rows.filter((r) => r.entity === 'job' && r.status === 'pending')
    if (pendingJobs.length === 0) { console.log('  closure reached — no new job ids found.'); break }

    const discoveries = { count: 0 }
    const discover = main_discover(rows, index, discoveries)
    for (const row of pendingJobs) {
      console.log(`    capturing ${row.shopvox_uuid}...`)
      try {
        const result = await captureOne(api, row, discover)
        writeRecordFile(row, result)
        row.status = 'done'
        row.captured_at = new Date().toISOString()
      } catch (e) {
        console.error(`    ✗ FAILED: ${e.message}`)
        row.status = 'failed'
        row.error = String(e.message || e)
      }
    }
    flushQueue(rows, true)
    logMemory('closure_pass_end', { passNum, newIds: newIds.length })
    if (passNum >= 10) { console.log('  safety cap: 10 passes reached, stopping.'); break }
  }

  const { rows: finalRows } = loadQueue()
  const finalJobCount = finalRows.filter((r) => r.entity === 'job' && r.status === 'done').length
  console.log(`=== Closure pass complete: ${finalJobCount} job(s) captured across ${passReports.length} pass(es) ===`)
  return { passReports, finalJobCount }
}

async function main() {
  logMemory('process_start', { pid: process.pid })
  acquireLock() // MUST be first — before any browser/network work, so a blocked second instance exits fast and touches nothing.
  const { context } = await launchBrowser()
  const page = context.pages()[0] ?? (await context.newPage())
  await ensureLoggedInLazy(page)
  await page.goto('https://express.shopvox.com/transactions/quotes', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await sleep(1500)

  const authLog = makeAuthLog(CAPTURE_DIR)
  const api = makeApiClient({ context, page, rps: RPS, authLog }) // includes getBinary() for PDFs, sharing the same paced/backoff/token loop

  if (VALIDATE_CHAIN_A) {
    await validateChainA({ api })
    await context.close()
    return
  }

  const filterFn = (row) => {
    if (ONLY_ENTITIES && !ONLY_ENTITIES.has(row.entity)) return false
    // --range only has a defined meaning for the customer entity (alphabetic
    // split on the customer name in `number`). Names starting with a digit
    // or symbol sort before 'A' and won't fall in ANY A-Z range — after
    // splitting customer across ranges, run one more no-range pass (it will
    // only touch the leftover pending rows, per the resumable design) to
    // pick those up. See the file header for the full 2-machine split note.
    if (RANGE && row.entity === 'customer') {
      const [lo, hi] = RANGE.toUpperCase().split('-')
      const c = (row.number || '')[0]?.toUpperCase() || ''
      if (!(c >= lo && c <= hi)) return false
    }
    return true
  }
  const scopeLabel = [ONLY_ENTITIES ? [...ONLY_ENTITIES].join('+') : 'all-entities', RANGE ? `range=${RANGE}` : null, LIMIT ? `limit=${LIMIT}` : null].filter(Boolean).join(' ')

  // drain() and closureScanJobs() alternate until BOTH report nothing left
  // to do — not a single drain-then-closure pair. CONFIRMED LIVE this
  // matters: closureScanJobs's own inner loop only re-drains newly-found
  // JOB rows (its termination check is `pendingJobs.length === 0`, scoped
  // to entity==='job'). But capturing a closure-discovered job can itself
  // call discover() for that job's order transaction (job.orderId — see
  // captureJob), which pushes a non-job (invoice/sales_order/quote) row
  // onto the SAME queue. That row is invisible to closure's own job-only
  // termination check, and drain() had already exited (reachedCompletion)
  // before closure ran, so nothing ever came back to capture it — it sat
  // 'pending' forever despite the run logging as finished. Found on Laredo
  // Chamber of Commerce and Indiana Transport SA de CV (1 and 2 leftover
  // 'invoice' rows respectively, both discovered mid-closure). Loop until a
  // full drain finds zero pending AND the closure pass that follows it
  // finds zero new jobs on its very first internal pass — typically
  // converges in 2 outer iterations, since the second drain is almost
  // always tiny (just the leftover rows) and its own closure pass then has
  // nothing new to find.
  // Unbounded until now — a genuine risk on a 2-3 day unattended run: if
  // ANYTHING ever stays 'pending' without drain() resolving it to 'done'/
  // 'failed'/'skipped' (a bug we haven't hit yet, but the loop had no
  // defense against one), this alternates drain<->closure forever with no
  // error, no crash, just silence. maxOuterIterations is a backstop against
  // an unknown-unknown, not a tuning knob — the documented normal case
  // converges in 2 iterations (see comment above), so hitting 10 means
  // something is genuinely stuck and the run needs a human, not more time.
  const MAX_OUTER_ITERATIONS = 10
  let drainResult
  let outerIteration = 0
  for (;;) {
    outerIteration++
    console.log(`\n=== Outer iteration ${outerIteration}/${MAX_OUTER_ITERATIONS} ===`) // unconditional — must be visible on every pass, not just the "still pending after closure" continuation case, or a --limit run (which always exits after iteration 1, before closure even runs) would never show it
    if (outerIteration > MAX_OUTER_ITERATIONS) {
      console.error('\n' + '!'.repeat(70))
      console.error(`FATAL: drain/closure outer loop hit maxOuterIterations=${MAX_OUTER_ITERATIONS} without converging.`)
      console.error(`This means some row is staying 'pending' without drain() ever resolving it to 'done'/'failed'/'skipped' — a real bug, not a slow run. Left unbounded, this would spin silently for the rest of a multi-day run.`)
      console.error(`Queue checkpoint is intact at ${QUEUE_FILE} — inspect which rows are still 'pending' after ${MAX_OUTER_ITERATIONS} passes before re-running.`)
      console.error('!'.repeat(70) + '\n')
      process.exitCode = 1 // signal failure to any orchestration watching the exit code, but still fall through to a clean context.close() below
      break
    }
    drainResult = await drain({ context, page, api, filterFn, limit: LIMIT, scopeLabel })
    if (!drainResult.reachedCompletion) {
      console.log('\nSkipping job-discovery closure pass — drain did not reach completion (--limit cap or filtered run).')
      break
    }
    const closureResult = await closureScanJobs({ api })
    const { rows: checkRows } = loadQueue()
    const stillPending = checkRows.some((r) => filterFn(r) && r.status === 'pending')
    if (!stillPending) break
    console.log(`\nClosure pass left ${checkRows.filter((r) => filterFn(r) && r.status === 'pending').length} non-job record(s) pending (discovered via a closure-captured job's own references) — re-draining to capture them before finishing... [outer iteration ${outerIteration}/${MAX_OUTER_ITERATIONS}]`)
  }

  await context.close()
}

// Exported for scripts/api-probe's synthetic unit test of main_discover()'s
// phantom-detection guard — importing this module must NOT trigger a live
// run (browser launch, network calls). Guard main()'s auto-invocation so it
// only fires when this file is executed directly, same as before for the
// normal `node scripts/shopvox-capture.mjs` usage.
export { main_discover, rowUrl, ALL_ENTITY_KINDS, findNextPendingIndex }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
}
