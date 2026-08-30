/**
 * import-api-capture.mjs
 *
 * Loads RAW API captures written by scripts/shopvox-capture.mjs
 * (scripts/capture/<entity>/<uuid>.json) into the same shopvox_* staging
 * tables scripts/import-chain-capture.mjs uses for the DOM pilot — reusing
 * that script's table/natural-key/FK-backfill conventions, but written as a
 * separate file (import-chain-capture.mjs is explicitly off-limits to edit).
 * Writes ONLY to shopvox_* tables and historical_import_runs. Never touches
 * public.quotes/sales_orders/invoices/jobs or any other native PrintOS
 * table. Never writes/runs a migration.
 *
 * SCOPE: by default reads --queue=<path> (a queue.jsonl / customer-<uuid>.jsonl
 * file) and imports exactly the (entity, shopvox_uuid) pairs it lists whose
 * capture file exists on disk — NOT everything under scripts/capture/, so a
 * customer-scoped run doesn't accidentally pull in unrelated captures (e.g.
 * the Phase 6 smoke-test records that happen to share scripts/capture/'s
 * directory tree). Pass --all instead to import every file on disk.
 *
 * Usage:
 *   node scripts/import-api-capture.mjs --queue=scripts/queue/customer-<uuid>.jsonl --dry-run
 *   node scripts/import-api-capture.mjs --queue=scripts/queue/customer-<uuid>.jsonl
 *   node scripts/import-api-capture.mjs --all --dry-run
 *
 * MEMORY (2026-08-26): this script USED TO load every referenced capture
 * file FULLY into memory before processing any of it. Confirmed live at the
 * time: 37,795 capture files already total 3.67 GiB on disk against this
 * machine's default Node heap ceiling of 2.19 GiB (`node -e
 * "console.log(require('v8').getHeapStatistics().heap_size_limit)"`) — an
 * unscoped run against the full queue.jsonl reliably OOM'd. Fixed properly
 * (not just papered over) via bounded-batch processing: a lightweight
 * pass-1 index (`parentCompanyIndex`, see below) is built once up front so
 * resolveEmailParent() no longer needs any other record's FULL content in
 * memory, then pass 2 (inside main()) loads/maps/uploads/discards
 * `queueEntries` in `BATCH_RECORDS`-sized chunks instead of all at once. See
 * SHOPVOX_MIGRATION_NOTES.md, "queue.jsonl / OOM" for the proof this
 * produced identical output to the old single-pass code (Sames dump-and-diff,
 * emails and attachments).
 *
 * Still run with an explicit --max-old-space-size as a safety margin — the
 * batching bounds PEAK memory per run to roughly one batch's worth of file
 * content plus the pass-1 index (tens of MB), which should stay well inside
 * the 2.19 GiB default, but the flag costs nothing and protects against a
 * pathologically large single batch (e.g. one giant transaction capture):
 *
 *   node --max-old-space-size=8192 scripts/import-api-capture.mjs --queue=... [--dry-run]
 *
 * Idempotent: every table is upserted on a natural key (documented per
 * table below, same keys as the DOM importer) so re-running replaces rather
 * than duplicates.
 *
 * MIGRATION 186 (schema read live from PostgREST, not supabase/migrations/):
 *   - shopvox_job_workflow_steps gained actual_seconds (integer — the raw
 *     API actualTime, confirmed seconds), has_time_spents, last_event_type,
 *     last_event_user, and TEXT columns estimated_user_time /
 *     estimated_machine_time / manual_time for the H:M:S strings (never
 *     parsed as durations — stored verbatim, a different shape from actualTime).
 *   - shopvox_bom_items gained transaction_shopvox_id and job_shopvox_id
 *     became nullable: BOM is attributed to job_shopvox_id when a
 *     transaction's line items resolve to exactly 1 distinct job, otherwise
 *     to transaction_shopvox_id (0 or >1 jobs). Nothing is skipped any more.
 *   - shopvox_sales_leads is a new table — sales leads are a genuinely
 *     separate ShopVOX resource from Quote, not a Quote sub-status.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostname } from 'node:os'
import * as P from './lib/shopvox-import-parse.mjs'
import { fetchAllIdsForOrg } from './lib/supabase-paginate.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const DRY_RUN = process.argv.includes('--dry-run')
const ALL = process.argv.includes('--all')
const argv = process.argv.slice(2)
function getFlag(name) { const a = argv.find((a) => a.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null }
const QUEUE_PATH = getFlag('queue')
if (!ALL && !QUEUE_PATH) { console.error('FATAL: pass --queue=<path> or --all'); process.exit(1) }

const ORGANIZATION_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'
const CAPTURE_DIR = join(root, 'scripts', 'capture')

function loadEnv() {
  const envPath = join(root, '.env.local')
  if (!existsSync(envPath)) { console.error('FATAL: .env.local not found at', envPath); process.exit(1) }
  const env = readFileSync(envPath, 'utf8')
  return Object.fromEntries(env.split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
}
const vars = loadEnv()
if (!vars.SUPABASE_SERVICE_ROLE_KEY) { console.error('FATAL: SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(1) }
// Always create the client, even in --dry-run: the BOM terminal-stage check
// needs ONE read-only SELECT (count of stale rows that would be deleted
// without replacement) so the dry-run number is real, not a guess. Every
// write in this file stays gated behind `if (DRY_RUN) { ...; return }`
// further down — this client is never used to write during a dry run.
const sb = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ── Load source files (batched, 2026-08-26 — see the MEMORY header note) ──
// readSkips: files that exist but failed to JSON.parse — the concurrent-
// capture torn-read race (a file mid-writeFileSync when this importer reads
// it). Both load sites below are wrapped so ONE bad file skips (logged,
// counted) instead of throwing uncaught and aborting the entire run. A
// missing file (capture hasn't produced it yet) is a separate, expected
// case, tracked separately below, not a skip.
const readSkips = [] // {path, reason}
let naturalKeyCollisions = 0 // rows dropped by upsertTable()'s in-batch dedupe — see the comment there
function loadFile(entity, uuid) {
  const p = join(CAPTURE_DIR, entity, `${uuid}.json`)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch (e) {
    readSkips.push({ path: p, reason: e.message })
    return null
  }
}
// queueEntries: the full (entity, uuid) list for this run — NOT file
// contents. This alone is cheap regardless of run size (queue.jsonl itself
// is 15.7 MiB at 54,625 lines; a directory listing is cheaper still). The
// actual memory cost — every REFERENCED capture file, fully loaded — used
// to happen right here, all at once, before any processing. It now happens
// per-batch, inside main() below, loading and discarding one batch's files
// at a time instead of all 37,795+ simultaneously.
let queueEntries = []
if (ALL) {
  const { readdirSync } = await import('node:fs')
  for (const entity of readdirSync(CAPTURE_DIR)) {
    const dir = join(CAPTURE_DIR, entity)
    if (!existsSync(dir) || !readdirSync(dir).length) continue
    let stat
    try { stat = (await import('node:fs')).statSync(dir) } catch { continue }
    if (!stat.isDirectory()) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      queueEntries.push({ entity, uuid: f.replace(/\.json$/, '') })
    }
  }
} else {
  const queueRows = readFileSync(QUEUE_PATH, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  queueEntries = queueRows.map((r) => ({ entity: r.entity, uuid: r.shopvox_uuid }))
}
console.log(`Queue lists ${queueEntries.length} (entity, uuid) pair(s).`)

// ── Row accumulators (per-batch, 2026-08-26) ─────────────────────────────
// `rows` used to accumulate for the whole run — every mapped row, including
// its embedded `raw:` copy of the source file, held until the very end.
// That defeated the batching fix on its own (loading files in bounded
// chunks doesn't help if the MAPPED output still piles up unboundedly). Now
// reset per batch (`rows = freshRows()`) and uploaded before the next batch
// loads — cumulativeCounts/sampleRows below carry what printSummary() needs
// across the whole run without holding every row in memory simultaneously.
function freshRows() {
  return {
    shopvox_transactions: [], shopvox_line_items: [], shopvox_transaction_charges: [],
    shopvox_jobs: [], shopvox_job_line_items: [], shopvox_proofs: [], shopvox_activities: [],
    shopvox_documents: [], shopvox_job_workflow_steps: [], shopvox_bom_items: [],
    shopvox_emails: [], shopvox_email_attachments: [], shopvox_sales_leads: [],
  }
}
let rows = freshRows()
const cumulativeCounts = Object.fromEntries(Object.keys(freshRows()).map((t) => [t, 0]))
const sampleRows = {} // first non-empty row seen per table, across all batches — for printSummary()'s preview
// entries per outer batch — keeps peak resident file content well under the
// heap ceiling; tune if memory pressure is still seen at this size.
// --batch-records=N overrides it — not needed for normal use, but lets a
// small customer-scoped run (e.g. Sames' ~2,568 entries, under the 3,000
// default — one batch) be forced into several batches on purpose, to prove
// cross-batch FK resolution (shopvox_email_attachments.email_id, in
// particular) rather than accidentally not exercising it at all.
const BATCH_RECORDS = Number(getFlag('batch-records')) || 3000
// Entities/fields with NO destination table/column at all (not a parse
// failure — a genuine schema gap). Reported loudly, never silently dropped.
// sales_lead had no table as of the first pass of this script — migration
// 186 added shopvox_sales_leads, so it's mapped now (see mapSalesLead below)
// and removed from this bucket. customer still has no destination table.
const unmappedEntities = { customer: 0 }
const unmappedNotes = new Set()
const parseFailures = []
let bomAttributedToJob = 0 // line items resolve to exactly 1 distinct job — job_shopvox_id set, transaction_shopvox_id null
let bomAttributedToTransaction = 0 // 0 or >1 distinct jobs — transaction_shopvox_id set, job_shopvox_id null (migration 186 made this column nullable; nothing skipped any more)
let bomSkippedNonTerminal = 0 // a later stage (quote->SO->invoice) exists — this transaction's BOM is a duplicate, not imported
// BOM is a transaction-level aggregate and IDENTICAL across every stage of a
// quote->SO->invoice chain (confirmed live: compared 5 real chains line by
// line — 4 byte-identical, 1 identical content in a different order, 0
// actual divergence). Importing from every stage triple-counts material
// cost in any report that sums shopvox_bom_items. Fix: import ONLY from the
// chain's current TERMINAL stage — the one with no downstream Quote/
// WorkOrder/Invoice in its own next_transactions (Payment/Refund/CreditMemo
// entries don't count; they're not further BOM stages). This is a per-
// transaction local check, robust to partial/in-progress captures.
//
// A transaction skipped as non-terminal must still have any PREVIOUSLY
// imported rows for it deleted (not just skipped going forward) — otherwise
// a chain that was terminal-at-quote on one run and terminal-at-invoice on
// a later run leaves stale quote-attributed rows behind forever, and we're
// duplicated again via the delta instead of the initial import. These sets
// collect the attribution keys that a skipped transaction WOULD have used,
// purely so the delete phase can clean them up with nothing re-inserted.
//
// BUG FOUND AND FIXED (2026-08-27, Task investigation): this used to have a
// second, per-batch copy of these two sets (`bomDeleteOnlyJobIdsBatch`/
// `TransactionIdsBatch`, reset every batch), and each batch issued its OWN
// delete-without-replacement call using only ITS OWN batch's candidates.
// That's wrong: whether a non-terminal transaction's key should actually be
// deleted depends on whether the chain's CURRENT terminal transaction was
// found ANYWHERE in this run — not on whether it happened to land in the
// SAME batch. A key whose terminal stage was correctly inserted in batch 2
// got permanently deleted by a non-terminal sibling in batch 14, with
// nothing to replace it, because batch 14's own `arr` (all it ever checked)
// had no rows for that key. Proven live: 3,037+ keys lost this way in one
// full run, confirmed by direct query (25/25 sampled had zero rows after).
//
// Fixed by making the decision run-wide instead of batch-wide: these two
// sets accumulate every non-terminal-transaction candidate across ALL
// batches (unchanged from before), and two NEW sets below
// (`bomInsertedJobIdsAllRun`/`TransactionIdsAllRun`) accumulate every key
// that a TERMINAL transaction with real BOM content actually inserted for,
// also across all batches. The actual delete-without-replacement pass now
// runs exactly ONCE, after every batch has finished inserting — see "Final
// BOM delete-only cleanup" near the end of main() — computed as
// (every non-terminal candidate this run) MINUS (every key this run
// actually inserted real terminal data for), so a key's insert is always
// visible before this run ever decides to delete it, regardless of which
// batch produced either half.
const bomDeleteOnlyJobIdsAllRun = new Set()
const bomDeleteOnlyTransactionIdsAllRun = new Set()
// Keys a TERMINAL transaction with real BOM content actually inserted for,
// this run — the run-wide "don't delete this, it's correct" set. Only
// tracks the key when at least one real row was pushed (a terminal
// transaction with a genuinely empty BOM does NOT suppress cleanup — if the
// true current state really is empty, a stale leftover row for that key
// should still be removed).
const bomInsertedJobIdsAllRun = new Set()
const bomInsertedTransactionIdsAllRun = new Set()
function isTerminalTransaction(file) {
  const nextTx = file.endpoints?.next_transactions?.body?.nextTransactions || []
  return !nextTx.some((t) => t.type === 'Quote' || t.type === 'WorkOrder' || t.type === 'Invoice')
}

const now = () => new Date().toISOString()

const KIND_URI_PATH = { quote: 'quotes', sales_order: 'sales-orders', invoice: 'invoices', purchase_order: 'purchase-orders', credit_memo: 'credit-memos' }
const WRAP_KEY = { quote: 'quote', sales_order: 'workOrder', invoice: 'invoice', purchase_order: 'purchaseOrder', credit_memo: 'creditMemo', payment: 'payment', refund: 'refund' }
const DOC_TYPE = { quote: 'quote_pdf', sales_order: 'sales_order_wo_pdf', invoice: 'invoice_pdf' }
const PREV_TYPE_TO_KIND = { Quote: 'quote', WorkOrder: 'sales_order', Invoice: 'invoice' }

function num(v) { return P.parseNumber(v) }
function money(v) { return P.parseMoney(v) }

// ── Pass 1: lightweight parent-company index (2026-08-26) ────────────────
// Built once, up front, so resolveEmailParent() below (batched pass 2)
// never needs another record's FULL content in memory to resolve an
// email's customer — only that record's companyId. Reads every job and
// transaction-kind file exactly once, keeps only a tiny string per file,
// lets everything else be garbage-collected immediately. Final index size:
// tens of MB at most (id strings), not gigabytes — this is the piece that
// lets pass 2 batch safely without losing cross-record resolution.
const PARENT_INDEX_ENTITIES = new Set(['job', ...Object.keys(WRAP_KEY)])
const parentCompanyIndex = new Map() // "entity|uuid" -> companyId
let missingForIndex = 0
for (const { entity, uuid } of queueEntries) {
  if (!PARENT_INDEX_ENTITIES.has(entity)) continue
  const data = loadFile(entity, uuid)
  if (!data) { missingForIndex++; continue }
  const body = entity === 'job' ? data.endpoints?.detail?.body?.job : data.endpoints?.detail?.body?.[WRAP_KEY[entity]]
  const companyId = body?.company?.id ?? body?.companyId ?? null
  if (companyId) parentCompanyIndex.set(`${entity}|${uuid}`, companyId)
}
console.log(`Parent-company index built: ${parentCompanyIndex.size} entries (${missingForIndex} referenced files not yet on disk).`)

// Migration 187: parse the H:M:S text fields (estimatedUserTime,
// estimatedMachineTime, manualTime — "0:15:38", "1:0:0", no zero-padding)
// into integer-seconds companion columns. A missing/empty/unparseable value
// returns null, NEVER 0 — "no labor recorded" and "zero labor" are
// different facts a costing report needs to tell apart. An actual "0:0:0"
// IS a real recorded zero and correctly parses to 0, not null.
function parseHMSToSeconds(v) {
  if (v == null) return null
  const s = String(v).trim()
  if (s === '') return null
  const m = s.match(/^(\d+):(\d+):(\d+)$/)
  if (!m) return null
  const [, h, mi, se] = m
  return Number(h) * 3600 + Number(mi) * 60 + Number(se)
}

// ── Transaction mapper (quote/sales_order/invoice/purchase_order/credit_memo/payment/refund) ──
function mapTransaction(entity, uuid, file) {
  const wrapKey = WRAP_KEY[entity]
  const body = file.endpoints?.detail?.body?.[wrapKey]
  if (!body) { parseFailures.push({ file: `${entity}/${uuid}`, field: 'endpoints.detail.body', rawValue: null, note: `expected wrap key "${wrapKey}" not found — detail status was ${file.endpoints?.detail?.status}` }); return }

  const prices = file.endpoints?.prices?.body?.prices || null
  const prevTx = file.endpoints?.previous_transactions?.body?.previousTransactions || []
  let parentQuote = null, parentSalesOrder = null
  for (const t of prevTx) {
    const k = PREV_TYPE_TO_KIND[t.type]
    if (k === 'quote' && !parentQuote) parentQuote = t.id
    if (k === 'sales_order' && !parentSalesOrder) parentSalesOrder = t.id
  }

  // payment/refund have no `prices` sub-resource — their own amount field stands in for `total`.
  const isSimple = entity === 'payment' || entity === 'refund'

  rows.shopvox_transactions.push({
    shopvox_id: uuid,
    kind: entity,
    number: body.txnNumber ?? null,
    number_int: P.parseIntSafe(body.txnNumber),
    title: body.title ?? null,
    customer_shopvox_id: body.company?.id ?? body.companyId ?? null,
    primary_contact_name: body.primaryContact?.name ?? null,
    status: body.workflowState ?? null,
    accounting_status: body.accountingSyncState ?? null,
    parent_quote_shopvox_id: parentQuote,
    parent_sales_order_shopvox_id: parentSalesOrder,
    transaction_date: body.txnDate ?? body.paidOn ?? null,
    due_date: body.dueDate ?? null,
    sales_rep: body.primarySalesRep?.name ?? null,
    // WAS "not exposed on the transaction record itself (job-level only)"
    // — that claim was wrong too (confirmed live, 2026-08-26, same sweep
    // that found line_items_price below): body.productionManagerId and
    // body.projectManagerId ARE on the transaction record. Left null
    // anyway, correctly this time — these two columns are `text` (a
    // resolved name, matching sales_rep's own primarySalesRep?.name
    // sibling), and the transaction record only carries the bare id, no
    // expanded {name} object the way primarySalesRep gets. No
    // profile/staff-name resolution path exists for this id anywhere in
    // what's captured (same gap as sales_rep_id/created_by elsewhere in
    // this project) — the id itself is not lost, it's preserved in `raw`
    // for whenever that resolution exists.
    production_manager: null,
    project_manager: null,
    subtotal: prices ? money(prices.totalPriceInDollars) : null,
    tax_total: prices ? money(prices.totalTaxInDollars) : null,
    total: prices ? money(prices.totalPriceWithTaxInDollars) : (isSimple ? money(body.amountInDollars) : null),
    payments_total: prices ? money(prices.totalPaymentsInDollars) : null,
    // WAS `null` with a comment claiming no field existed for this — that
    // claim was wrong (confirmed live, 2026-08-25): prices.creditInDollars
    // is real and populated. The earlier mapper simply never looked; nobody
    // had checked the raw payload underneath this column, only the columns
    // that already existed. Fixed here rather than routed around — same
    // money() handling every sibling field on `prices` already uses.
    credit_total: prices ? money(prices.creditInDollars) : null,
    balance: prices ? money(prices.balanceInDollars) : (isSimple ? money(body.balanceInDollars) : null),
    is_voided: body.active === false,
    source_url: KIND_URI_PATH[entity] ? `https://express.shopvox.com/transactions/${KIND_URI_PATH[entity]}/${uuid}` : null,
    raw: file, // the FULL captured record (all endpoints + lineItems), not just the detail page — richer re-parse insurance than the DOM importer's single-page raw
    captured_at: file.capturedAt ?? null,
    imported_at: now(),
    organization_id: ORGANIZATION_ID,
  })
  if (!prices && !isSimple) unmappedNotes.add(`${entity}: no "prices" endpoint captured for this record — subtotal/tax_total/payments_total left null (only happens if detail 200'd but prices didn't)`)

  // Line items (not fetched at all for payment/refund).
  const liList = file.endpoints?.line_items?.body?.lineItems || []
  for (const li of liList) {
    const liEntry = file.lineItems?.[li.id] || {}
    const product = liEntry.product?.body?.product ?? liEntry.product?.body ?? null
    const params = liEntry.parameters?.body || null
    const modifiers = (params?.pricingAttributes || []).map((a) => a.name ?? a.value ?? JSON.stringify(a)).filter(Boolean)
    const machineLabor = (params?.pricingItems || []).map((p) => p.name).filter(Boolean)

    rows.shopvox_line_items.push({
      transaction_shopvox_id: uuid,
      shopvox_line_item_id: li.id ?? null, // the line item's own real ShopVOX id (Migration I, 2026-08-25) — was buried in raw.lineItem.id only; now its own column and the natural key (see NATURAL_KEYS below)
      position: P.parseIntSafe(li.position),
      product_name: li.productName ?? li.name ?? null,
      category: product?.category?.name ?? null,
      secondary_category: product?.subCategory?.name ?? null,
      description: li.description ?? null,
      quantity: num(li.quantity),
      unit: li.uom ?? null,
      unit_discount: li.discountIsPercentage ? num(li.discountPercent) : money(li.discountInDollars),
      unit_price: money(li.priceInDollars),
      total_price: money(li.totalPriceInDollars),
      taxable: li.taxable === true,
      modifiers: modifiers.length ? modifiers.join(', ') : null,
      total_area: /sqft/i.test(li.uom || '') ? num(li.quantity) : null,
      area_uom: li.uom ?? null,
      price_per_uom: money(li.priceInDollars),
      machine: machineLabor.length ? [...new Set(machineLabor)].join(', ') : null,
      copy_text: null, // no equivalent field found on the API line item — see unmapped report
      internal_notes: li.internalNotes || null,
      design_details: li.designDetails || null,
      production_details: li.productionDetails || null,
      install_details: li.installDetails || null,
      shipping_details: li.shippingDetails || null,
      shipping_tracking: li.shippingTracking || null,
      buying_cost: product ? money(product.costInDollars) : null,
      markup: product ? num(product.markup) : null,
      list_price: product ? money(product.priceInDollars) : null,
      income_account: product?.incomeCoaAccount?.name ?? null,
      cog_account: product?.cogCoaAccount?.name ?? null,
      part_number: product?.partNumber ?? null,
      default_sale_type: product?.saleType ?? null,
      product_other_info: product?.otherInfo || null,
      po_description: product?.poDescription || null,
      product_description: product?.description ?? null,
      product_image_url: null, // product images were not in this capture's endpoint scope — see unmapped report
      raw: { lineItem: li, parameters: params, product },
      captured_at: file.capturedAt ?? null,
      imported_at: now(),
      organization_id: ORGANIZATION_ID,
    })

    if (li.jobId) {
      rows.shopvox_job_line_items.push({
        job_shopvox_id: li.jobId,
        transaction_shopvox_id: uuid,
        line_item_position: P.parseIntSafe(li.position),
        transaction_kind: entity,
        imported_at: now(),
        organization_id: ORGANIZATION_ID,
      })
    }
  }

  // Transaction charges — only non-zero named fee rows (Setup/Misc/Shipping/
  // Finance/CC Fee), same convention as the DOM importer's summary-vs-named-fee split.
  if (prices) {
    const CHARGE_DEFS = [
      { key: 'setupCharges', label: 'Setup' },
      { key: 'miscCharges', label: prices.miscChargesLabel || 'Misc' },
      { key: 'shippingCharges', label: 'Shipping' },
      { key: 'financeCharges', label: 'Finance' },
      { key: 'ccFeeCharges', label: 'CC Fee' },
    ]
    let sortOrder = 0
    for (const { key, label } of CHARGE_DEFS) {
      const amount = money(prices[`${key}InDollars`])
      if (!amount) continue
      rows.shopvox_transaction_charges.push({
        transaction_shopvox_id: uuid,
        label,
        amount,
        taxable: prices[`${key}Taxable`] ?? null,
        tax_amount: money(prices[`${key}TaxInDollars`]),
        sort_order: sortOrder++,
        raw: { key, ...Object.fromEntries(Object.entries(prices).filter(([k]) => k.startsWith(key))) },
        imported_at: now(),
        organization_id: ORGANIZATION_ID,
      })
    }
  }

  // PDF -> shopvox_documents (quote/sales_order/invoice only — matches capture scope).
  const pdf = file.endpoints?.pdf
  if (pdf && pdf.savedTo && DOC_TYPE[entity]) {
    rows.shopvox_documents.push({
      parent_kind: entity,
      parent_shopvox_id: uuid,
      doc_type: DOC_TYPE[entity],
      filename: basename(pdf.savedTo),
      source_url: pdf.url,
      storage_bucket: null, // not uploaded to Supabase Storage — local path only, same as the DOM importer
      storage_path: pdf.savedTo,
      content_type: 'application/pdf',
      file_size_bytes: pdf.sizeBytes ?? null,
      sha256: null, // not computed — see unmapped report
      raw: pdf,
      captured_at: file.capturedAt ?? null,
      imported_at: now(),
      organization_id: ORGANIZATION_ID,
    })
  }

  // Activities -> shopvox_activities. Far richer than the DOM's regex-parsed
  // text: structured actor/action/actionData/timestamp straight from the API.
  const activities = file.endpoints?.activities?.body?.activities || []
  activities.forEach((a, idx) => {
    rows.shopvox_activities.push({
      parent_kind: entity,
      parent_shopvox_id: uuid,
      actor: a.actor?.name ?? null,
      action_text: a.action ?? null,
      field_name: a.actionData && 'oldState' in a.actionData ? 'workflowState' : '', // '' not null — NULL breaks ON CONFLICT idempotency, same as the DOM importer. actionData is ALWAYS an object (often {}) — checking truthiness alone mislabels every activity, confirmed live.
      old_value: a.actionData?.oldState ?? null,
      new_value: a.actionData?.newState ?? null,
      occurred_at: a.createdAt ?? null,
      sequence: idx,
      raw: a,
      captured_at: file.capturedAt ?? null,
      imported_at: now(),
      organization_id: ORGANIZATION_ID,
    })
  })

  // BOM -> shopvox_bom_items. Terminal-stage-only (see isTerminalTransaction
  // above) — a non-terminal transaction's BOM is a confirmed duplicate of
  // its downstream stage's, so it's never inserted. Attribution (when
  // importing): migration 186 added transaction_shopvox_id and made
  // job_shopvox_id nullable, so when the transaction's line items resolve
  // to exactly ONE distinct job, attribute to that job (job_shopvox_id set,
  // transaction_shopvox_id null — matches the original DOM-era per-job
  // shape); otherwise (0 or >1 jobs) attribute to the transaction instead.
  const bom = file.endpoints?.bom?.body?.bom
  if (bom) {
    const distinctJobIds = [...new Set(liList.map((li) => li.jobId).filter(Boolean))]
    const attributedToJob = distinctJobIds.length === 1
    const terminal = isTerminalTransaction(file)

    if (!terminal) {
      bomSkippedNonTerminal++
      if (attributedToJob) bomDeleteOnlyJobIdsAllRun.add(distinctJobIds[0])
      else bomDeleteOnlyTransactionIdsAllRun.add(uuid)
    } else {
      if (attributedToJob) bomAttributedToJob++
      else bomAttributedToTransaction++
      let position = 0
      let pushedAnyBomRow = false
      for (const section of ['materials', 'laborRates', 'machineRates']) {
        for (const r of bom[section]?.records || []) {
          pushedAnyBomRow = true
          rows.shopvox_bom_items.push({
            job_shopvox_id: attributedToJob ? distinctJobIds[0] : null,
            transaction_shopvox_id: attributedToJob ? null : uuid,
            position: position++,
            material_name: r.name ?? null,
            quantity: num(r.quantity),
            uom: r.units ?? null,
            unit_cost: money(r.costInDollars),
            total_cost: money(r.totalCostInDollars),
            notes: `type: ${r.type ?? section}`,
            raw: r,
            imported_at: now(),
            organization_id: ORGANIZATION_ID,
          })
        }
      }
      // Record this key as "resolved, has real content" run-wide — this is
      // the exemption checked by the deferred delete-only pass, regardless
      // of which batch actually inserted these rows.
      if (pushedAnyBomRow) {
        if (attributedToJob) bomInsertedJobIdsAllRun.add(distinctJobIds[0])
        else bomInsertedTransactionIdsAllRun.add(uuid)
      }
    }
  }
}

// ── Job mapper ────────────────────────────────────────────────────────
function mapJob(uuid, file) {
  const body = file.endpoints?.detail?.body?.job
  if (!body) { parseFailures.push({ file: `job/${uuid}`, field: 'endpoints.detail.body.job', rawValue: null, note: `detail status was ${file.endpoints?.detail?.status}` }); return }
  const assignments = file.endpoints?.assignments?.body?.assignments || file.endpoints?.assignments?.body || {}

  rows.shopvox_jobs.push({
    shopvox_id: uuid,
    number: body.txnNumber ?? null, // pro_jobs doesn't have its own display number distinct from the parent txn in this API shape — see unmapped report
    number_int: null,
    title: body.name ?? body.title ?? null,
    customer_shopvox_id: body.companyId ?? body.company?.id ?? null,
    job_status: body.workflowState ?? null,
    job_color: body.color ?? null, // real hex code from the API — better than the DOM's rendered swatch RGB
    priority: P.parseIntSafe(body.priority),
    qty: num(body.quantity),
    qty_completed: num(body.quantityCompleted ?? body.qtyCompleted),
    description: body.description ?? null,
    customer_po: body.poNumber ?? null,
    design_details: body.designDetails || null,
    production_details: body.productionDetails || null,
    shipping_details: body.shippingDetails || null,
    installation_details: body.installDetails || null,
    special_info: body.specialInstruction || null,
    local_file_path: body.localFilePath || null,
    // WAS "not confirmed on pro_jobs detail" — that claim was wrong
    // (confirmed live, 2026-08-26): body.totalPriceInDollars is real and
    // populated (checked 20 job files directly — varied real dollar
    // values, not a placeholder). Nobody had gone back to confirm it after
    // the first "not confirmed" hedge; fixed rather than left as a
    // standing question. Same money() handling as every other dollar
    // field on this mapper.
    line_items_price: money(body.totalPriceInDollars),
    workflow_name: file.endpoints?.steps?.body?.job?.template?.name ?? null,
    due_date: body.dueDate ?? null,
    due_time: null,
    production_due_date: body.productionDueDate ?? null,
    hard_due_date: body.hardDueDate ?? null,
    customer_due_date: body.customerDueDate ?? null,
    art_due_date: body.artDueDate ?? null,
    install_due_date: body.installDueDate ?? null,
    shipping_due_date: body.shippingDueDate ?? null,
    production_manager: assignments.productionManager?.name ?? null,
    project_manager: assignments.projectManager?.name ?? null,
    sales_rep: assignments.salesRep?.name ?? null,
    designer: assignments.designer?.name ?? null,
    estimator: assignments.estimator?.name ?? null,
    installer: assignments.installer?.name ?? null,
    billing_address: null, // not in this capture's endpoint scope — see unmapped report
    shipping_address: null,
    install_address: null,
    shipping_method: null,
    created_by_source: body.createdBy?.name ?? null,
    created_at_source: body.createdAt ?? null,
    updated_by_source: body.updatedBy?.name ?? null,
    updated_at_source: body.updatedAt ?? null,
    source_url: `https://express.shopvox.com/jobs/${uuid}/Jobs::Normal`,
    raw: file,
    captured_at: file.capturedAt ?? null,
    imported_at: now(),
    import_run_id: null,
    organization_id: ORGANIZATION_ID,
  })

  // Proofs — API gives structured version history (workflowState/viewCount/
  // contactId/reviewId) vs the DOM's HTML-scrape-derived approval status.
  const proofs = file.endpoints?.proofs?.body?.proofs || []
  for (const p of proofs) {
    rows.shopvox_proofs.push({
      shopvox_id: p.id ?? null, // the API DOES expose a real id, unlike the DOM capture
      job_shopvox_id: uuid,
      filename: p.fileName ?? p.name ?? null,
      version: P.parseIntSafe(p.version),
      uploaded_at: p.updatedAt ?? null, // no distinct "uploadedAt" field observed — updatedAt is the closest proxy; see unmapped report
      approval_status: p.workflowState ?? null,
      approved_by: null, // not on the proof record itself — derivable from job activities (proof_send_to_review/client_changed_state entries), not joined here
      approved_at: null,
      view_count: P.parseIntSafe(p.viewCount),
      comment_count: P.parseIntSafe(p.commentCount),
      thumbnail_url: null, // not fetched separately — fileUrl below is the full asset
      download_url: p.fileUrl ?? null,
      content_type: p.fileMimetype ?? null,
      file_size_bytes: null, // not exposed by this endpoint
      storage_path: null, // hosted on ShopVOX's CDN, not downloaded
      raw: p,
      captured_at: file.capturedAt ?? null,
      imported_at: now(),
      organization_id: ORGANIZATION_ID,
    })
  }

  // Workflow steps — THE big upgrade over the DOM importer: real per-step
  // timestamps (lastEvent.eventStartAt) and actualTime (seconds), not just
  // an assignee count.
  // actual_seconds / actualTime: CONFIRMED this is CYCLE TIME (wall-clock
  // elapsed between the step's workflow-state transitions), NOT labor time.
  // Evidence: summed across all of Sames' 1,168 completed steps it comes to
  // ~14,201 hours — about 12 hours/step on average, which only makes sense
  // as calendar time (a step opened Friday and closed Monday racks up the
  // whole weekend) — confirmed originally via the Customer Review
  // cross-check (49s gap in the activity feed vs actualTime:48, i.e. it
  // tracks elapsed time between state changes, not active work).
  //
  // manualTime IS a separate, genuine labor-time field — confirmed live:
  // non-zero on 703 of 3,243 Sames steps, and consistently much smaller and
  // plausible as real work duration where it's set (e.g. one Customer
  // Review step: manualTime "0:15:38" vs actualTime 56,299s/~15.6h for the
  // very same step). It does NOT correlate with hasTimeSpents (every
  // populated example above had hasTimeSpents:false, so that flag isn't a
  // reliable "has real time data" signal either — noted for anyone tempted
  // to use it as one). No dedicated GET endpoint exposing per-entry time
  // logs was found (network-captured a full job-detail page load — 44
  // calls, none time-spent-shaped); "Record Time Spent" is a write-only UI
  // action never exercised, per this pipeline's read-only rule, so this is
  // as far as this investigation can safely go. manualTime is already
  // captured in its own text column below (migration 186) — if it needs to
  // be usable numerically for a costing report, it needs an H:M:S parse
  // into a companion seconds column, which does not exist yet.
  const stages = file.endpoints?.steps?.body?.job?.stages || []
  for (const stage of stages) {
    for (const s of stage.steps || []) {
      const lastEvent = s.lastEvent || null
      const isComplete = lastEvent?.eventType === 'complete'
      rows.shopvox_job_workflow_steps.push({
        job_shopvox_id: uuid,
        stage: stage.name || '',
        step_name: s.name ?? null,
        position: P.parseIntSafe(s.position),
        status: s.workflowState ?? null,
        assignee_count: (s.assignedTo || []).length,
        assignees: (s.assignedTo || []).map((a) => a.name).filter(Boolean).join(', ') || null,
        recorded_time_minutes: s.actualTime != null ? Number(s.actualTime) / 60 : null, // kept for back-compat — this is CYCLE time in minutes, same caveat as actual_seconds above
        started_at: !isComplete ? (lastEvent?.eventStartAt ?? null) : null,
        completed_at: isComplete ? (lastEvent?.eventStartAt ?? null) : null,
        // migration 186 additions:
        actual_seconds: s.actualTime != null ? P.parseIntSafe(s.actualTime) : null, // CYCLE TIME, not labor time — see the block comment above this loop
        has_time_spents: s.hasTimeSpents ?? null,
        last_event_type: lastEvent?.eventType ?? null,
        last_event_user: lastEvent?.user?.name ?? null,
        // H:M:S STRINGS — do NOT run through the actualTime/seconds parser, store verbatim.
        // manual_time is the genuine labor-time candidate — see the block comment above this loop.
        estimated_user_time: s.estimatedUserTime ?? null,
        estimated_machine_time: s.estimatedMachineTime ?? null,
        manual_time: s.manualTime ?? null,
        // migration 187 additions — parsed companions to the three text
        // columns above, same source values, null (not 0) when absent.
        estimated_user_seconds: parseHMSToSeconds(s.estimatedUserTime),
        estimated_machine_seconds: parseHMSToSeconds(s.estimatedMachineTime),
        manual_time_seconds: parseHMSToSeconds(s.manualTime),
        raw: s,
        captured_at: file.capturedAt ?? null,
        imported_at: now(),
        organization_id: ORGANIZATION_ID,
      })
    }
  }

  // Activities (same shape/handling as transactions).
  const activities = file.endpoints?.activities?.body?.activities || []
  activities.forEach((a, idx) => {
    rows.shopvox_activities.push({
      parent_kind: 'job',
      parent_shopvox_id: uuid,
      actor: a.actor?.name ?? null,
      action_text: a.action ?? null,
      field_name: a.actionData && 'oldState' in a.actionData ? 'workflowState' : '',
      old_value: a.actionData?.oldState ?? null,
      new_value: a.actionData?.newState ?? null,
      occurred_at: a.createdAt ?? null,
      sequence: idx,
      raw: a,
      captured_at: file.capturedAt ?? null,
      imported_at: now(),
      organization_id: ORGANIZATION_ID,
    })
  })
}

// The email record has NO companyId/transactableId/transactableType field —
// that was a guess made before ever seeing a real captured email, and it
// was wrong (confirmed live: querying shopvox_emails.customer_shopvox_id
// for Sames returned 0 of 931 rows). What's actually there is
// `parent: {id, type, jobId?, txnNumber?}` identifying what the email is
// ATTACHED to. Sampled the full set of 931 Sames emails to find every
// value: JobProof (562), Invoice (331), Quote (27), WorkOrder (9),
// Payment (2) — no bare "Job" or "Company" type seen, but handled below
// defensively in case another customer's mail has one.
const PARENT_TYPE_TO_ENTITY = { Quote: 'quote', WorkOrder: 'sales_order', Invoice: 'invoice', CreditMemo: 'credit_memo', PurchaseOrder: 'purchase_order', Payment: 'payment', Refund: 'refund' }

// Resolve customer_shopvox_id via the pass-1 parentCompanyIndex (2026-08-26
// — was recordsByKey, a live lookup against every OTHER record's full
// loaded content; that only worked because everything was in memory at
// once, which is exactly what batching removes). Every transaction/job kind
// captures its own `company`/`companyId`, so this is still a real join, not
// a guess — just against a pre-extracted id instead of a full record.
// Returns { customerShopvoxId, parentKind, parentShopvoxId }.
function resolveEmailParent(body) {
  const parent = body.parent
  if (!parent?.type) return { customerShopvoxId: null, parentKind: null, parentShopvoxId: null }

  // A general customer email (not attached to any specific transaction/job)
  // — confirmed live on a contrast customer, never seen on Sames. parent.id
  // IS the customer's own uuid directly here, no lookup needed.
  if (parent.type === 'Company') return { customerShopvoxId: parent.id ?? null, parentKind: 'customer', parentShopvoxId: parent.id ?? null }

  if (parent.type === 'JobProof' || parent.type === 'Job') {
    const jobUuid = parent.jobId ?? (parent.type === 'Job' ? parent.id : null)
    if (!jobUuid) return { customerShopvoxId: null, parentKind: 'job', parentShopvoxId: null }
    const companyId = parentCompanyIndex.get(`job|${jobUuid}`) ?? null
    return { customerShopvoxId: companyId, parentKind: 'job', parentShopvoxId: jobUuid }
  }

  const entity = PARENT_TYPE_TO_ENTITY[parent.type]
  if (!entity) return { customerShopvoxId: null, parentKind: parent.type.toLowerCase(), parentShopvoxId: parent.id ?? null }
  const companyId = parentCompanyIndex.get(`${entity}|${parent.id}`) ?? null
  return { customerShopvoxId: companyId, parentKind: entity, parentShopvoxId: parent.id ?? null }
}

// ── Email mapper — NO shopvox_id collision risk table already has one ────
function mapEmail(uuid, file) {
  const list = file.endpoints?.detail?.body?.emails
  const body = Array.isArray(list) ? list[0] : null
  if (!body) { parseFailures.push({ file: `email/${uuid}`, field: 'endpoints.detail.body.emails[0]', rawValue: null, note: `single-id refetch returned 0 rows (status ${file.endpoints?.detail?.status}) — the email may have been deleted between enumeration and capture` }); return }

  const sender = body.sender || {}
  const toList = (body.recipients || []).map((r) => r.email || r.name).filter(Boolean)
  const ccList = (body.ccRecipients || []).map((r) => r.email || r.name).filter(Boolean)
  const { customerShopvoxId, parentKind, parentShopvoxId } = resolveEmailParent(body)
  if (body.parent?.type && customerShopvoxId == null) { parseFailures.push({ file: `email/${uuid}`, field: 'parent', rawValue: JSON.stringify(body.parent), note: `could not resolve customer_shopvox_id — parent type "${body.parent.type}" record not found in this run's loaded capture set (not captured, or outside this queue's scope)` }) }

  rows.shopvox_emails.push({
    shopvox_id: uuid,
    customer_shopvox_id: customerShopvoxId,
    parent_kind: parentKind,
    parent_shopvox_id: parentShopvoxId,
    from_name: sender.name ?? null,
    from_email: sender.email ?? null,
    sent_to: toList.length ? toList.join(', ') : null,
    cc_to: ccList.length ? ccList.join(', ') : null,
    subject: body.emailSubject ?? null,
    body_html: body.note ?? null,
    body_text: null, // no plain-text variant observed — see unmapped report
    template_name: null, // not observed on this record — see unmapped report
    sent_at: body.createdAt ?? null,
    opened: body.openedAt != null,
    raw: body,
    captured_at: file.capturedAt ?? null,
    imported_at: now(),
    organization_id: ORGANIZATION_ID,
  })

  for (const att of body.attachments || []) {
    rows.shopvox_email_attachments.push({
      email_id: null, // backfilled after shopvox_emails insert, same FK pattern as line_items/transactions
      shopvox_attachment_id: att.id ?? null, // the attachment's own real ShopVOX id (Migration M, 2026-08-26) — same pattern as shopvox_line_item_id, populated the same way it's always been read (att.raw?.id in the promoter) but now its own staging column and natural key instead of buried in raw
      filename: att.fileName ?? att.filename ?? att.name ?? null,
      source_url: att.url ?? att.fileUrl ?? null,
      content_type: att.contentType ?? att.mimeType ?? null,
      file_size_bytes: att.sizeBytes ?? att.fileSize ?? null,
      storage_path: null,
      raw: att,
      imported_at: now(),
      organization_id: ORGANIZATION_ID,
      _email_shopvox_id: uuid, // internal only — used for backfill lookup, stripped before insert
    })
  }
}

// ── Sales lead mapper — shopvox_sales_leads (migration 186). Confirmed live
// against the real API (see the sales_leads investigation in this
// conversation's history) that sales leads are a genuinely separate
// resource from Quote — own id/workflowState/dealValueInDollars — not a
// Quote sub-status, hence the dedicated table. No "number"-like field was
// observed on the record (unlike transactions' txnNumber); left null. ──────
function mapSalesLead(uuid, file) {
  const body = file.endpoints?.detail?.body?.salesLead
  if (!body) { parseFailures.push({ file: `sales_lead/${uuid}`, field: 'endpoints.detail.body.salesLead', rawValue: null, note: `detail status was ${file.endpoints?.detail?.status}` }); return }

  rows.shopvox_sales_leads.push({
    shopvox_id: uuid,
    number: null, // not observed on this record type — see header comment
    number_int: null,
    title: body.title ?? null,
    customer_shopvox_id: body.company?.id ?? body.companyId ?? null,
    customer_id: null, // resolved elsewhere, same convention as shopvox_transactions.customer_shopvox_id
    workflow_state: body.workflowState ?? null,
    deal_value: money(body.dealValueInDollars),
    sales_rep: body.salesRep?.name ?? body.primarySalesRep?.name ?? null,
    lead_source: body.leadSource?.name ?? null,
    expected_close_date: body.expectedCloseDate ?? null,
    created_at_source: body.createdAt ?? null,
    updated_at_source: body.updatedAt ?? null,
    source_url: `https://express.shopvox.com/sales-leads/${uuid}`,
    raw: file,
    captured_at: file.capturedAt ?? null,
    imported_at: now(),
    import_run_id: null, // backfilled after historical_import_runs row exists, same as shopvox_jobs
    organization_id: ORGANIZATION_ID,
  })
}

// ── Dispatch: map one loaded (entity, uuid, data) into `rows` ────────────
// Called once per queue entry, inside main()'s per-batch loop below — right
// after that entry's file is loaded, so load+map+discard happens one entry
// at a time rather than building a full in-memory list first (2026-08-26).
let missingFiles = 0 // queue entries whose capture file doesn't exist yet (capture still running) — expected, never a skip
function mapEntry(entity, uuid, data) {
  if (entity in WRAP_KEY) mapTransaction(entity, uuid, data)
  else if (entity === 'job') mapJob(uuid, data)
  else if (entity === 'email') mapEmail(uuid, data)
  else if (entity === 'sales_lead') mapSalesLead(uuid, data)
  else if (entity === 'customer') { unmappedEntities.customer++; unmappedNotes.add('customer: NO destination table exists (no shopvox_customers/shopvox_companies/shopvox_contacts). The customer\'s own companies/{id}+contacts capture is not imported anywhere by this script — raw capture on disk is the only record. (Native customer identity likely already flows through scripts/import-customers.mjs against a different source, not this pipeline.)') }
  else console.warn(`WARNING: ${entity}/${uuid} has no mapper — skipped`)
}

// ── Report / dry-run output ──────────────────────────────────────────
// cumulativeCounts/sampleRows (not `rows`) drive this now (2026-08-26) —
// `rows` holds only the CURRENT batch by the time this runs at the end of
// main(), since it's reset per batch. cumulativeCounts/sampleRows are
// maintained by main()'s batch loop specifically so this summary still
// describes the whole run.
function printSummary(bomDeleteOnlyPreview) {
  console.log(`\n=== File read skips (torn reads, concurrent capture) ===`)
  console.log(`  ${readSkips.length} file(s) skipped this run`)
  console.log(`\n=== Referenced files not yet on disk (capture still running — expected, not a skip) ===`)
  console.log(`  ${missingFiles} queue entr${missingFiles === 1 ? 'y' : 'ies'}`)
  console.log(`\n=== In-batch natural-key collisions (source data, e.g. ShopVOX's own duplicate line-item positions) ===`)
  console.log(`  ${naturalKeyCollisions} row(s) dropped by the last-wins dedupe`)
  console.log('\n=== Row counts per table (cumulative across all batches) ===')
  for (const [table, count] of Object.entries(cumulativeCounts)) console.log(`  ${table}: ${count}`)
  if (bomAttributedToJob || bomAttributedToTransaction || bomSkippedNonTerminal) {
    console.log(`\n=== BOM attribution — terminal stage only (confirmed live: BOM is identical across a chain's quote/SO/invoice, so only the current terminal stage is imported) ===`)
    console.log(`  imported, attributed to job_shopvox_id (terminal, exactly 1 distinct job on the transaction's line items): ${bomAttributedToJob} transaction(s)`)
    console.log(`  imported, attributed to transaction_shopvox_id (terminal, 0 or >1 distinct jobs): ${bomAttributedToTransaction} transaction(s)`)
    console.log(`  skipped, non-terminal (a downstream Quote/WorkOrder/Invoice exists — this one's BOM is a duplicate): ${bomSkippedNonTerminal} transaction(s)`)
    console.log(`  of the skipped ones, distinct attribution keys needing stale-row cleanup: ${bomDeleteOnlyJobIdsAllRun.size} job(s) + ${bomDeleteOnlyTransactionIdsAllRun.size} transaction(s)`)
    // bomDeleteOnlyPreview: null (nothing to preview this run — the two sets
    // above were both empty) | {failed:false, count} | {failed:true,
    // failures}. A failed chunk must NEVER be absorbed into a printed number
    // (2026-08-26 — see chunkedCount()'s comment): a confirmed zero and a
    // failed query that defaulted to zero are different facts, and printing
    // "0" either way made them indistinguishable. Confirmed live at full-
    // queue scale: this exact query, unchunked, failed 400/414 with an empty
    // response body and printed "0" as if it were a real answer.
    if (bomDeleteOnlyPreview?.failed) {
      console.log(`  rows that would be DELETED WITHOUT REPLACEMENT on --apply: COULD NOT BE COMPUTED — ${bomDeleteOnlyPreview.failures.length} chunk(s) failed:`)
      bomDeleteOnlyPreview.failures.forEach((f) => console.log(`    [${f.column}, chunk ${f.chunkIndex}] HTTP ${f.status} ${f.statusText}${f.message ? ' — ' + f.message : ' (server returned no error body)'}`))
    } else if (bomDeleteOnlyPreview != null) {
      console.log(`  rows that would be DELETED WITHOUT REPLACEMENT on --apply (read-only preview, nothing deleted): ${bomDeleteOnlyPreview.count}`)
      console.log(`    (should be 0 on a first/initial import; a nonzero number on a later run means that many chains advanced a stage since last import)`)
    }
  }
  if (unmappedEntities.customer) {
    console.log('\n=== Entities with NO destination table (0 rows by design, not a bug) ===')
    console.log(`  customer: ${unmappedEntities.customer} captured, 0 imported`)
  }
  console.log('\n=== Sample row per non-empty table (first one seen, any batch) ===')
  for (const [table, sample0] of Object.entries(sampleRows)) {
    const sample = { ...sample0 }
    if (sample.raw) sample.raw = '<raw jsonb omitted from preview — ' + JSON.stringify(sample.raw).length + ' chars>'
    console.log(`\n--- ${table} ---`)
    console.log(JSON.stringify(sample, null, 2))
  }
  console.log('\n=== Unmapped-field / structural notes ===')
  if (unmappedNotes.size) [...unmappedNotes].forEach((n) => console.log(` - ${n}`))
  else console.log('  (none)')
  if (parseFailures.length) {
    console.log(`\n=== Parse failures (${parseFailures.length}) ===`)
    parseFailures.slice(0, 50).forEach((f) => console.log(` [${f.file}] ${f.field}: ${f.note}`))
    if (parseFailures.length > 50) console.log(`  ... and ${parseFailures.length - 50} more`)
  } else {
    console.log('\nNo parse failures.')
  }
}

// Chunked, loudly-failing count helper — CONFIRMED LIVE (2026-08-26) that
// this project's chunking rule (DELETE_CHUNK, below) had been applied to
// the live DELETE_THEN_INSERT delete phase but NOT to this dry-run-only
// preview count, and at full-queue scale (1,332/3,495 distinct ids) that
// unchunked .in() failed every time: reproduced directly against
// shopvox_bom_items with synthetic ids — n=100 succeeds (200), n=700 and
// n=1332 both fail 400 Bad Request, n=3495 fails 414 Request-URI Too Large.
// PostgREST/the gateway in front of it return NO response body on either
// failure, so supabase-js's `error.message` is genuinely the empty string
// '' every time — not a masked real message, an actually-empty one.
// `status`/`statusText` DO carry the real reason and are what gets reported
// instead. Chunk size reuses `DELETE_CHUNK` (150) — the same size already
// proven safe for this exact table/column shape by the live delete phase
// below, and the same size the promoter uses for its own chunked `.in()`
// calls.
async function chunkedCount(table, column, ids) {
  let count = 0
  const failures = [] // { chunkIndex, status, statusText, message }
  const idList = [...ids]
  for (let i = 0; i < idList.length; i += DELETE_CHUNK) {
    const chunk = idList.slice(i, i + DELETE_CHUNK)
    const { count: chunkCount, error, status, statusText } = await sb.from(table).select('id', { count: 'exact', head: true }).in(column, chunk)
    if (error) failures.push({ chunkIndex: i / DELETE_CHUNK, status, statusText, message: error.message })
    else count += chunkCount ?? 0
  }
  return { count, failures }
}

// Called from main() once every batch has been mapped (DRY_RUN only) —
// moved off the old top-level `if (DRY_RUN) { ...; process.exit(0) }`
// (2026-08-26) so mapping can happen batch-by-batch inside main() instead
// of all at once before main() is ever reached.
async function finishDryRun() {
  console.log('\n--dry-run: mapping complete, NOT touching the database.')
  // The ONE read-only exception to "dry run touches nothing": a count query
  // (no write) so the delete-without-replacement number reported is real,
  // not a guess. See the header comment on the `sb` client declaration.
  // bomDeleteOnlyPreview stays null when there's nothing to preview (both
  // sets below are empty) — printSummary() reads that as "omit the line
  // entirely," same as before. Once ANY count query is attempted, the
  // result is either a real total or an explicit failure — never a number
  // that could be either, see chunkedCount()'s comment and the printSummary
  // rendering below.
  // Same run-wide exemption the live path applies (see "Final BOM
  // delete-only cleanup" in main()) — a key that a terminal transaction
  // already inserted real content for, ANYWHERE in this run, is never a
  // real deletion candidate, so it's excluded from the preview too. Without
  // this the dry-run number would keep reporting the old, wrong (batch-
  // scoped) figure even after the live path was fixed.
  const previewJobIds = new Set([...bomDeleteOnlyJobIdsAllRun].filter((id) => !bomInsertedJobIdsAllRun.has(id)))
  const previewTransactionIds = new Set([...bomDeleteOnlyTransactionIdsAllRun].filter((id) => !bomInsertedTransactionIdsAllRun.has(id)))
  let bomDeleteOnlyPreview = null
  if (previewJobIds.size || previewTransactionIds.size) {
    let count = 0
    const failures = []
    if (previewJobIds.size) {
      const r = await chunkedCount('shopvox_bom_items', 'job_shopvox_id', previewJobIds)
      count += r.count
      failures.push(...r.failures.map((f) => ({ ...f, column: 'job_shopvox_id' })))
    }
    if (previewTransactionIds.size) {
      const r = await chunkedCount('shopvox_bom_items', 'transaction_shopvox_id', previewTransactionIds)
      count += r.count
      failures.push(...r.failures.map((f) => ({ ...f, column: 'transaction_shopvox_id' })))
    }
    bomDeleteOnlyPreview = failures.length ? { failed: true, failures } : { failed: false, count }
  }
  printSummary(bomDeleteOnlyPreview)
}

// ── Live run ─────────────────────────────────────────────────────────
const NATURAL_KEYS = {
  shopvox_transactions: 'shopvox_id',
  shopvox_line_items: 'shopvox_line_item_id', // Migration I (2026-08-25) — was 'transaction_shopvox_id,position', which collided on the rare ShopVOX transaction with two line items sharing a position (4 known instances). The real per-line-item id is unique; that old pair is not.
  shopvox_jobs: 'shopvox_id',
  shopvox_job_line_items: 'job_shopvox_id,transaction_shopvox_id,line_item_position',
  shopvox_proofs: 'job_shopvox_id,filename,version',
  shopvox_activities: 'parent_shopvox_id,occurred_at,sequence,field_name',
  shopvox_documents: 'parent_shopvox_id,doc_type,filename',
  shopvox_job_workflow_steps: 'job_shopvox_id,stage,step_name',
  shopvox_sales_leads: 'shopvox_id',
  shopvox_emails: 'shopvox_id', // Migration M (2026-08-26) — was delete-then-insert (no unique constraint existed); shopvox_id already existed as a column, just needed a plain index
  shopvox_email_attachments: 'shopvox_attachment_id', // Migration M (2026-08-26) — was delete-then-insert; shopvox_attachment_id is a new column, backfilled from raw->>'id', same pattern as shopvox_line_item_id
}
const DELETE_THEN_INSERT = {
  shopvox_transaction_charges: { parentCols: ['transaction_shopvox_id'] },
  // BOM rows are attributed to EITHER job_shopvox_id OR transaction_shopvox_id
  // (never both — see the BOM comment in mapTransaction()), so re-running
  // idempotently needs to clear stale rows on WHICHEVER column a given
  // batch's rows used. Deleting only on job_shopvox_id would miss cleaning
  // up transaction-attributed rows on re-import (duplicate rows on re-run).
  shopvox_bom_items: { parentCols: ['job_shopvox_id', 'transaction_shopvox_id'] },
  // shopvox_emails and shopvox_email_attachments USED to be here — removed
  // 2026-08-26 (Migration M). They originally had no unique/exclusion
  // constraint in the live schema at all, so .upsert({onConflict:...})
  // failed with "no unique or exclusion constraint matching the ON CONFLICT
  // specification" (same failure mode the DOM importer hit on
  // shopvox_transaction_charges/shopvox_bom_items originally), and
  // delete-then-insert was the workaround. Both tables' real ShopVOX ids
  // (shopvox_emails.shopvox_id — already existed, just unindexed;
  // shopvox_email_attachments.shopvox_attachment_id — new column, backfilled
  // from raw->>'id') now have a PLAIN (non-partial) unique index each, so
  // both upsert cleanly on their own natural key below. This pattern
  // (delete-then-insert as a workaround for "no real key exists") should
  // not exist for any table where a real key actually does — check before
  // reaching for it again, the way this project didn't the first time.
}
// Default insert batch size. Reduced per-table below when a table's raw
// jsonb payload is large enough that 100-at-a-time risks a statement
// timeout — CONFIRMED LIVE: shopvox_transactions (avg 182KB/row, max 3MB —
// the full captured record: all endpoints + lineItems, richer than the DOM
// importer's single-page raw) timed out at BATCH=100 on the first real run.
const BATCH_SIZE = { shopvox_transactions: 10, shopvox_jobs: 25, shopvox_line_items: 25 }
const DEFAULT_BATCH = 100
// PostgREST's .in() filter serializes every id into the URL query string —
// CONFIRMED LIVE: shopvox_transaction_charges' delete-phase failed with a
// flat "Bad Request" once the distinct id list got large enough (708 rows'
// worth of transaction_shopvox_id values). Chunk delete .in() calls same as
// insert batches, for the same reason.
const DELETE_CHUNK = 150

// extraDeleteIds: { columnName: Set<id> } — parent ids whose rows must be
// deleted with NOTHING re-inserted (the terminal-stage BOM skip case). Only
// meaningful for DELETE_THEN_INSERT tables; ignored otherwise.
async function upsertTable(table, arr, extraDeleteIds = {}) {
  const hasExtraDeletes = Object.values(extraDeleteIds).some((s) => s && s.size)
  if (!arr.length && !hasExtraDeletes) return { table, inserted: 0, error: null, deletedWithReplacement: 0, deletedWithoutReplacement: 0 }
  const BATCH = BATCH_SIZE[table] ?? DEFAULT_BATCH
  if (DELETE_THEN_INSERT[table]) {
    const { parentCols } = DELETE_THEN_INSERT[table]
    let deletedWithReplacement = 0, deletedWithoutReplacement = 0
    for (const parentCol of parentCols) {
      const replacementIds = [...new Set(arr.map((r) => r[parentCol]).filter(Boolean))]
      const replacementSet = new Set(replacementIds)
      const deleteOnlyIds = [...(extraDeleteIds[parentCol] || [])].filter((id) => !replacementSet.has(id))
      for (let i = 0; i < replacementIds.length; i += DELETE_CHUNK) {
        const chunk = replacementIds.slice(i, i + DELETE_CHUNK)
        const { data, error: delErr } = await sb.from(table).delete().in(parentCol, chunk).select('id')
        if (delErr) return { table, inserted: 0, error: `delete-phase (${parentCol}, replacement): ${delErr.message}`, deletedWithReplacement, deletedWithoutReplacement }
        deletedWithReplacement += data?.length ?? 0
      }
      for (let i = 0; i < deleteOnlyIds.length; i += DELETE_CHUNK) {
        const chunk = deleteOnlyIds.slice(i, i + DELETE_CHUNK)
        const { data, error: delErr } = await sb.from(table).delete().in(parentCol, chunk).select('id')
        if (delErr) return { table, inserted: 0, error: `delete-phase (${parentCol}, delete-only): ${delErr.message}`, deletedWithReplacement, deletedWithoutReplacement }
        deletedWithoutReplacement += data?.length ?? 0
      }
    }
    let total = 0
    for (let i = 0; i < arr.length; i += BATCH) {
      const { error } = await sb.from(table).insert(arr.slice(i, i + BATCH))
      if (error) return { table, inserted: total, error: error.message, deletedWithReplacement, deletedWithoutReplacement }
      total += Math.min(BATCH, arr.length - i)
    }
    return { table, inserted: total, error: null, deletedWithReplacement, deletedWithoutReplacement }
  }
  const onConflict = NATURAL_KEYS[table]
  if (!onConflict) return { table, inserted: 0, error: 'no natural key defined and rows were produced — refusing to insert non-idempotently' }
  const keyCols = onConflict.split(',')
  let total = 0
  for (let i = 0; i < arr.length; i += BATCH) {
    // Generic safety net for every table upserted here, kept after its
    // original trigger was fixed properly: CONFIRMED LIVE 2026-08-25, the
    // first full org-wide --queue run hit "ON CONFLICT DO UPDATE command
    // cannot affect row a second time" on shopvox_line_items — ShopVOX
    // itself had 4 quotes with two line items sharing one position, and the
    // natural key back then was (transaction_shopvox_id, position). Migration
    // I (2026-08-25) fixed the real cause: shopvox_line_items now keys on
    // shopvox_line_item_id, the line item's own real ShopVOX id, which
    // cannot collide the way a shared position could. This dedupe should
    // report 0 for shopvox_line_items from here on — if it ever fires again
    // there, that's a genuine duplicate ShopVOX line-item id, not the old
    // position collision, and worth investigating as its own finding, not
    // waved through. Left in place for every table (not just this one) as a
    // general defense: dedupe each batch on its own natural key right before
    // sending it (keep the LAST occurrence) rather than lose the entire
    // batch to one bad row — logged and counted, never silent.
    const batch = arr.slice(i, i + BATCH)
    const seenKeys = new Map()
    for (const row of batch) {
      const key = keyCols.map((c) => row[c]).join('')
      seenKeys.set(key, row) // later occurrence overwrites earlier — last-wins, deterministic
    }
    const deduped = [...seenKeys.values()]
    if (deduped.length < batch.length) {
      naturalKeyCollisions += batch.length - deduped.length
      console.warn(`  [dedupe] ${table} batch at offset ${i}: ${batch.length - deduped.length} row(s) shared a natural key with another row in the same batch — kept the last, dropped the rest`)
    }
    const { error } = await sb.from(table).upsert(deduped, { onConflict })
    if (error) return { table, inserted: total, error: error.message }
    total += deduped.length
  }
  return { table, inserted: total, error: null }
}

function makeBatches(entries, size) {
  const batches = []
  for (let i = 0; i < entries.length; i += size) batches.push(entries.slice(i, i + size))
  return batches
}

async function main() {
  const startedAt = new Date().toISOString()
  // historical_import_runs is opened/closed once for the WHOLE run, not per
  // batch — batching is an internal memory-management detail, not something
  // that should fragment the run's own bookkeeping into N rows. In DRY_RUN
  // this is skipped entirely (matches the pre-batching behavior: dry runs
  // never touched historical_import_runs).
  let runRow = null
  if (!DRY_RUN) {
    const { data, error: runErr } = await sb.from('historical_import_runs').insert({
      entity: 'shopvox_api_import',
      scope: ALL ? 'all-captured' : QUEUE_PATH,
      machine: hostname(),
      status: 'running',
      started_at: startedAt,
      records_seen: queueEntries.length,
      records_captured: 0,
      records_failed: 0,
    }).select().single()
    if (runErr) { console.error('FATAL: could not open historical_import_runs row:', runErr.message); process.exit(1) }
    runRow = data
    console.log(`Opened historical_import_runs id=${runRow.id}`)
  }

  // CONFIRMED LIVE this matters: an unpaginated .select() silently caps at
  // PostgREST's default max-rows (1000) — shopvox_transactions already has
  // 1079 rows for this org, so a plain select() returned exactly 1000 and
  // the missing 79 became NULL transaction_id on every dependent line_item/
  // charge below. Same risk applies to shopvox_jobs/shopvox_emails as this
  // pipeline scales past 1000 rows per table, so all three FK lookups use
  // this helper, not just the one that already broke. Delegates to the
  // shared scripts/lib/supabase-paginate.mjs helper — pulled out into one
  // place after the SAME cap was hit a second time, independently, in an
  // ad-hoc diagnostic query elsewhere in this migration (see
  // SHOPVOX_MIGRATION_NOTES.md). Re-fetches the FULL org table every call —
  // under batching that's necessary, not just tolerated: a later batch's
  // rows can reference a parent inserted by an EARLIER batch (e.g. an email
  // in batch 3 attached to a transaction from batch 1), so each batch needs
  // a fresh, complete id map, not just its own batch's inserts.
  async function fetchAllIds(table) {
    try {
      return { data: await fetchAllIdsForOrg(sb, table, ORGANIZATION_ID), error: null }
    } catch (e) {
      return { data: null, error: { message: e.message } }
    }
  }

  // aggregated: table -> {table, inserted, error, deletedWithReplacement,
  // deletedWithoutReplacement} — folds every batch's upsertTable() result
  // into ONE row per table (matching the pre-batching shape of `results`)
  // rather than leaving one entry per (table, batch) pair.
  const aggregated = {}
  let recordsCaptured = 0, recordsFailed = 0
  async function run(table, extraDeleteIds) {
    // Captured here (live-run path only — DRY_RUN's sample is captured
    // earlier, per the comment above) so the preview reflects the row as it
    // was actually sent to the database: every FK-backfill assignment for
    // `table` above has already run by the time its own run(table) call is
    // reached (see the ordering comment above the batch loop's FK-backfill
    // block for why that's guaranteed).
    if (rows[table].length && !sampleRows[table]) sampleRows[table] = rows[table][0]
    const res = await upsertTable(table, rows[table], extraDeleteIds)
    const cur = aggregated[table] || { table, inserted: 0, error: null, deletedWithReplacement: 0, deletedWithoutReplacement: 0 }
    cur.inserted += res.inserted
    cur.deletedWithReplacement += res.deletedWithReplacement ?? 0
    cur.deletedWithoutReplacement += res.deletedWithoutReplacement ?? 0
    if (res.error) cur.error = cur.error ? `${cur.error}; ${res.error}` : res.error
    aggregated[table] = cur
    if (res.error) { recordsFailed += rows[table].length; console.error(`  ✗ ${table}: ${res.error}`) }
    else {
      recordsCaptured += res.inserted
      console.log(`  ✓ ${table}: ${res.inserted} row(s) upserted`)
      if (res.deletedWithoutReplacement) console.log(`    ⚠ ${res.deletedWithoutReplacement} row(s) deleted WITHOUT replacement (stale — the transaction that owned them is no longer the terminal stage of its chain, per this run)`)
    }
    return res
  }

  const batches = makeBatches(queueEntries, BATCH_RECORDS)
  console.log(`Processing ${queueEntries.length} queue entr${queueEntries.length === 1 ? 'y' : 'ies'} in ${batches.length} batch(es) of up to ${BATCH_RECORDS}.`)

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    console.log(`\n=== Batch ${b + 1}/${batches.length} (${batch.length} entries) ===`)

    // Load + map THIS batch's files only, into a fresh accumulator — the
    // previous batch's `rows` (and the file content it was built from) is
    // now eligible for GC, not held for the rest of the run.
    rows = freshRows()
    for (const { entity, uuid } of batch) {
      const data = loadFile(entity, uuid)
      if (!data) { missingFiles++; continue }
      mapEntry(entity, uuid, data)
    }

    // Fold this batch's mapped ROW COUNTS into the run-wide counters now —
    // counts are the same whether this run is DRY_RUN or live (backfill
    // below only mutates existing rows' FK columns, it never adds/removes
    // rows). Sample rows are handled differently: a dry run captures its
    // sample HERE, before continuing to the next batch, because nothing
    // else will ever run for it. A live run instead captures each table's
    // sample lazily inside run() below, AFTER that table's own FK-backfill
    // mutations are applied — capturing it here, pre-backfill, would freeze
    // in a sample showing unbackfilled nulls (transaction_id/job_id/
    // email_id) that the row actually sent to the database never had.
    for (const [table, arr] of Object.entries(rows)) {
      cumulativeCounts[table] += arr.length
      if (DRY_RUN && arr.length && !sampleRows[table]) sampleRows[table] = arr[0]
    }

    if (DRY_RUN) continue // mapping only — no database write in a dry run

    const txRes = await run('shopvox_transactions')
    // CONFIRMED LIVE this matters: on the first real run, shopvox_transactions
    // timed out but the script carried on to the FK backfill anyway, handing
    // shopvox_line_items a stale/incomplete id map and producing a cascade of
    // NOT NULL violations that had nothing to do with the actual bug. Every
    // downstream table depends on this one — stop here, not three failures later.
    if (txRes.error) { console.error('\nFATAL: shopvox_transactions upsert failed — aborting rather than backfilling FKs from a stale/incomplete table.'); process.exit(1) }
    const { data: txIdRows, error: txIdErr } = await fetchAllIds('shopvox_transactions')
    if (txIdErr) { console.error('FATAL: could not look up shopvox_transactions internal ids for FK backfill:', txIdErr.message); process.exit(1) }
    const txIdByShopvoxId = new Map(txIdRows.map((r) => [r.shopvox_id, r.id]))
    rows.shopvox_line_items.forEach((r) => { r.transaction_id = txIdByShopvoxId.get(r.transaction_shopvox_id) ?? null })
    rows.shopvox_transaction_charges.forEach((r) => { r.transaction_id = txIdByShopvoxId.get(r.transaction_shopvox_id) ?? null })

    rows.shopvox_jobs.forEach((r) => { r.import_run_id = runRow.id })
    const jobRes = await run('shopvox_jobs')
    if (jobRes.error) { console.error('\nFATAL: shopvox_jobs upsert failed — aborting rather than backfilling FKs from a stale/incomplete table.'); process.exit(1) }
    const { data: jobIdRows, error: jobIdErr } = await fetchAllIds('shopvox_jobs')
    if (jobIdErr) { console.error('FATAL: could not look up shopvox_jobs internal ids for FK backfill:', jobIdErr.message); process.exit(1) }
    const jobIdByShopvoxId = new Map(jobIdRows.map((r) => [r.shopvox_id, r.id]))
    rows.shopvox_proofs.forEach((r) => { r.job_id = jobIdByShopvoxId.get(r.job_shopvox_id) ?? null })
    rows.shopvox_job_workflow_steps.forEach((r) => { r.job_id = jobIdByShopvoxId.get(r.job_shopvox_id) ?? null })
    rows.shopvox_bom_items.forEach((r) => { r.job_id = jobIdByShopvoxId.get(r.job_shopvox_id) ?? null })

    // bom_items is in this same generic loop now — each batch inserts ONLY
    // its own terminal-with-content rows (normal delete-then-insert against
    // this batch's own parent ids, same as every other DELETE_THEN_INSERT
    // table here). It deliberately does NOT get an extraDeleteIds argument
    // any more — the non-terminal-sibling cleanup is no longer decided per
    // batch. See "Final BOM delete-only cleanup" after the batch loop for
    // why, and why doing it per batch was the actual bug.
    for (const table of ['shopvox_line_items', 'shopvox_transaction_charges', 'shopvox_job_line_items', 'shopvox_proofs', 'shopvox_activities', 'shopvox_documents', 'shopvox_job_workflow_steps', 'shopvox_bom_items']) {
      await run(table)
    }

    const emailRes = await run('shopvox_emails')
    if (emailRes.error) { console.error('\nFATAL: shopvox_emails upsert failed — aborting rather than backfilling FKs from a stale/incomplete table.'); process.exit(1) }
    const { data: emailIdRows, error: emailIdErr } = await fetchAllIds('shopvox_emails')
    if (emailIdErr) { console.error('FATAL: could not look up shopvox_emails internal ids for FK backfill:', emailIdErr.message); process.exit(1) }
    const emailIdByShopvoxId = new Map(emailIdRows.map((r) => [r.shopvox_id, r.id]))
    rows.shopvox_email_attachments.forEach((r) => { r.email_id = emailIdByShopvoxId.get(r._email_shopvox_id) ?? null; delete r._email_shopvox_id })
    await run('shopvox_email_attachments')

    rows.shopvox_sales_leads.forEach((r) => { r.import_run_id = runRow.id })
    await run('shopvox_sales_leads')
  }

  if (DRY_RUN) {
    await finishDryRun()
    process.exit(0)
  }

  // ── Final BOM delete-only cleanup — runs exactly ONCE, after every batch
  // has already inserted whatever real terminal BOM data it found. This is
  // the fix for the batch-scoped deletion bug: a key only gets deleted here
  // if NO batch anywhere in this run inserted real content for it. `arr` is
  // deliberately empty — this call is delete-only, nothing to (re-)insert.
  const finalDeleteOnlyJobIds = new Set([...bomDeleteOnlyJobIdsAllRun].filter((id) => !bomInsertedJobIdsAllRun.has(id)))
  const finalDeleteOnlyTransactionIds = new Set([...bomDeleteOnlyTransactionIdsAllRun].filter((id) => !bomInsertedTransactionIdsAllRun.has(id)))
  if (finalDeleteOnlyJobIds.size || finalDeleteOnlyTransactionIds.size) {
    console.log(`\n=== Final BOM delete-only cleanup (run-wide, after all ${batches.length} batches) ===`)
    console.log(`  non-terminal candidates this run: ${bomDeleteOnlyJobIdsAllRun.size} job(s) + ${bomDeleteOnlyTransactionIdsAllRun.size} transaction(s)`)
    console.log(`  of those, already replaced by a real terminal insert somewhere this run (exempt): ${bomDeleteOnlyJobIdsAllRun.size - finalDeleteOnlyJobIds.size} job(s) + ${bomDeleteOnlyTransactionIdsAllRun.size - finalDeleteOnlyTransactionIds.size} transaction(s)`)
    console.log(`  genuinely unreplaced, will be deleted: ${finalDeleteOnlyJobIds.size} job(s) + ${finalDeleteOnlyTransactionIds.size} transaction(s)`)
    const finalRes = await upsertTable('shopvox_bom_items', [], { job_shopvox_id: finalDeleteOnlyJobIds, transaction_shopvox_id: finalDeleteOnlyTransactionIds })
    if (finalRes.error) {
      console.error(`  ✗ final BOM cleanup failed: ${finalRes.error}`)
      recordsFailed += finalDeleteOnlyJobIds.size + finalDeleteOnlyTransactionIds.size
    } else {
      console.log(`  ✓ final BOM cleanup: ${finalRes.deletedWithoutReplacement} row(s) deleted without replacement (confirmed no replacement exists anywhere in this run)`)
    }
    const cur = aggregated['shopvox_bom_items'] || { table: 'shopvox_bom_items', inserted: 0, error: null, deletedWithReplacement: 0, deletedWithoutReplacement: 0 }
    cur.deletedWithoutReplacement += finalRes.deletedWithoutReplacement ?? 0
    if (finalRes.error) cur.error = cur.error ? `${cur.error}; ${finalRes.error}` : finalRes.error
    aggregated['shopvox_bom_items'] = cur
  }

  const results = Object.values(aggregated)
  const finishedAt = new Date().toISOString()
  const anyError = results.some((r) => r.error)
  await sb.from('historical_import_runs').update({
    status: anyError ? 'failed' : 'succeeded',
    finished_at: finishedAt,
    records_seen: queueEntries.length,
    records_captured: recordsCaptured,
    records_failed: recordsFailed,
    notes: JSON.stringify({ results: results.map((r) => ({ table: r.table, inserted: r.inserted, error: r.error, deletedWithReplacement: r.deletedWithReplacement, deletedWithoutReplacement: r.deletedWithoutReplacement })), unmappedEntities, unmappedNotes: [...unmappedNotes], bomAttributedToJob, bomAttributedToTransaction, bomSkippedNonTerminal, readSkips: readSkips.length, missingFiles, naturalKeyCollisions }),
    error: anyError ? results.filter((r) => r.error).map((r) => `${r.table}: ${r.error}`).join('; ') : null,
  }).eq('id', runRow.id)

  console.log(`\nClosed historical_import_runs id=${runRow.id} (status: ${anyError ? 'failed' : 'succeeded'})`)
  printSummary()
  console.log(`\nhistorical_import_runs id: ${runRow.id}`)
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
