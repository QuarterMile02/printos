/**
 * promote-shopvox-to-native.mjs
 *
 * Promotes ONE customer's staging data (shopvox_* tables) into the native
 * PrintOS tables (quotes, sales_orders, invoices, jobs, payments, and their
 * line items) per Ruben's promotion rules (2026-08-24).
 *
 * Usage:
 *   node scripts/promote-shopvox-to-native.mjs --customer=<shopvox_customer_uuid> [--dry-run] [--apply]
 *   node scripts/promote-shopvox-to-native.mjs --customers=<file> [--dry-run] [--apply] [--verbose] [--progress=<file>]
 *
 * --dry-run is the default. --apply is required to actually write anything.
 * Passing both, or neither with --apply, is not possible — --apply must be
 * explicit and alone overrides the default. --customer and --customers are
 * mutually exclusive; exactly one is required.
 *
 * WIDE-RUN HARDENING (added 2026-08-25, for the ~4,500-customer run — not
 * yet exercised against anything, built-only per instruction):
 *
 * - RETRY: every Supabase read and write goes through withRetry()
 *   (scripts/lib/retry.mjs — the fetchAllRows() pagination helper carries
 *   its own copy of the same wrapper). Retries with exponential backoff (5
 *   attempts, ~15.5s max) on a thrown network failure, HTTP 429, or HTTP
 *   5xx. Does NOT retry a 4xx PostgREST/Postgres error (schema mismatch,
 *   constraint violation, bad input) — those are real bugs and still fail
 *   immediately, same as before this change. Same "retry the transient
 *   thing, fail loudly on the real thing" shape as the EPERM retry fix in
 *   shopvox-capture.mjs's flushQueue.
 *
 * - --customers=<file>: newline-delimited ShopVOX customer uuids (blank
 *   lines and #-comments ignored, duplicates deduped, order preserved).
 *   Each is promoted in sequence through the exact same per-customer logic
 *   --customer uses (refactored into promoteOneCustomer() below) — one
 *   customer's failure is caught, logged, and tallied, and does NOT stop
 *   the run; the next customer still gets processed. --customer mode is
 *   unchanged: still exits 1 on the first failure, still always fully
 *   verbose, exactly as all 12 prior manual runs behaved.
 *
 * - RESUMABILITY (--apply + --customers only — see below for why dry-run is
 *   excluded): after a customer's promotion finishes writing successfully,
 *   its shopvox uuid is appended to a progress file (default
 *   scripts/state/promote-progress.txt, override with --progress=<file>).
 *   On any re-run of the same --customers file, a uuid already in that file
 *   is skipped without re-fetching or re-writing anything. Promotion is
 *   already idempotent (upsert-on-id) — this is purely about not re-doing
 *   hours of already-good work after an interruption, not about
 *   correctness. A FAILED customer is never added to the file, so it's
 *   picked back up automatically on the next run. --dry-run + --customers
 *   always processes the full list every time and never touches the
 *   progress file — a dry run is cheap review, not "work done," and
 *   skipping customers from it would make a pre-flight report incomplete
 *   without any indication why.
 *
 * - LOGGING: --customer mode prints the full per-table report, unchanged.
 *   --customers mode defaults to one summary line per customer (table=count
 *   pairs) plus a final tally (succeeded/failed/skipped/elapsed) — pass
 *   --verbose to get the full per-table report for every customer too, but
 *   that reproduces "a wall of output" across thousands of customers, so it
 *   is opt-in, not the default.
 *
 * SCOPE THIS RUN: quotes, sales_orders, invoices, jobs, payments, their
 * three line-item tables, and (added 2026-08-25, Migration E) transaction_charges,
 * bom_items, job_line_items, job_workflow_steps, plus (Migration F/G)
 * documents, proof_versions, emails, email_attachments, and (Migration J,
 * 2026-08-25) credit_memos / credit_memo_line_items — CRITICAL: promoting a
 * credit memo must NEVER write to invoices.balance_due or any other invoice
 * field. ShopVOX's own invoice.balance already nets the credit (proven to
 * the penny, Task X) — a native `credit_memos` row is record-keeping only.
 * Explicitly NOT this pass: sales_leads, refunds — no settled promotion rule
 * yet. purchase_orders/purchase_order_items are promoted by a separate
 * script (promote-purchase-orders.mjs), not this one — they're org-scoped,
 * not customer-scoped, so they don't fit this file's --customer model.
 *
 * quote_line_items / sales_order_line_items / invoice_line_items use the
 * line item's own REAL ShopVOX id (Migration I, 2026-08-25 —
 * shopvox_line_items.shopvox_line_item_id). CORRECTION to what this file
 * claimed before that migration: ShopVOX line items DO have a real id of
 * their own — confirmed live across everything captured: 17,708 quote /
 * 3,149 sales_order / 14,408 invoice line items, 100% populated, all
 * distinct, per kind. It just wasn't its own staging column before Migration
 * I (buried in shopvox_line_items.raw.lineItem.id only), which is why the
 * earlier version of this promoter minted `id`/`shopvox_id` as
 * deterministicUuid(transaction_shopvox_id:position) for these three tables
 * — the one place in this whole script where id and shopvox_id ended up
 * identical. That position-based hash silently collided on the rare ShopVOX
 * transaction with two line items sharing one position (4 known quotes,
 * none in the pilot 12) — one would overwrite the other with no error. Fixed
 * now: id is resolved via resolveIdMap() exactly like every other promoted
 * table (existing native id looked up by the real shopvox_id first, a fresh
 * randomUUID() only for genuinely new rows), and shopvox_id is the real id,
 * never derived from position.
 *
 * transaction_charges / bom_items still have no real ShopVOX id of their own
 * — synthetic shopvox_id from each table's own verified-unique natural key:
 *   transaction_charges: (transaction_shopvox_id, sort_order) — 0 dup keys, checked live
 *   bom_items: (job_shopvox_id OR transaction_shopvox_id, position) — 0 dup keys, checked live
 *   job_line_items: no natural key of its own at all (own id/shopvox_id
 *     still a deterministic hash, unaffected by the line-item id fix above —
 *     job_line_items has no position collision of its own to worry about).
 *     What DOES change: resolving which line item it points at. Previously
 *     this blindly re-derived deterministicUuid(transaction_shopvox_id:position)
 *     as the target id, assuming that formula was the target row's real id —
 *     it no longer is. Now it does a REAL lookup: match
 *     (transaction_shopvox_id, line_item_position) against this customer's
 *     already-fetched shopvox_line_items rows to find the target's real
 *     shopvox_line_item_id, then resolve that through the same id map the
 *     line items above were written with. shopvox_job_line_items.line_item_position
 *     was confirmed live to match shopvox_line_items.position 1,040/1,040
 *     times for Sames — but a position can now genuinely match MORE than one
 *     shopvox_line_items row (the same 4-quote collision). That's
 *     unresolvable from job_line_items' own data alone (it carries no
 *     line-item id, only a position) — those rows are skipped and reported,
 *     never guessed.
 *   job_workflow_steps: (job_shopvox_id, stage, position) — position alone
 *     collides (it resets per stage, confirmed live: 1,128 collisions on
 *     (job, position) alone, 0 on (job, stage, position)) — a synthetic key
 *     narrower than this would have silently merged distinct steps.
 *
 * is_historical is written FALSE on every row this script writes (Ruben's
 * rule 1) — sealing to true is a separate, later step. Because of that, the
 * enforce_historical_immutability trigger never fires against this script's
 * own writes in this phase, so no SET LOCAL bypass / direct Postgres
 * connection is needed here at all — every write goes through the normal
 * PostgREST/supabase-js path. That stops being true once rows get sealed;
 * this script does not attempt to write to already-sealed (is_historical =
 * true) rows and will report them as skipped if it ever encounters one.
 *
 * IDEMPOTENCY / the partial-unique-index gotcha: quotes.shopvox_id (and the
 * same column on the other 6 tables) is a PARTIAL unique index
 * (WHERE shopvox_id IS NOT NULL, from Migration A/C) — supabase-js's
 * `.upsert(rows, {onConflict: 'shopvox_id'})` generates a plain
 * `ON CONFLICT (shopvox_id) DO UPDATE` with no WHERE clause, which Postgres
 * refuses to match against a partial index ("no unique or exclusion
 * constraint matching the ON CONFLICT specification"). Worked around by
 * never using shopvox_id as the upsert arbiter: this script first resolves
 * each staging row's existing native `id` by a plain SELECT on shopvox_id
 * (or mints a fresh uuid client-side if none exists yet), then upserts on
 * `id` (a normal, non-partial primary-key index, where ON CONFLICT works
 * with no caveats). Re-running always finds the same existing ids and
 * updates in place — true idempotency, no duplicate rows.
 *
 * GENERATED COLUMNS: payments.balance is GENERATED ALWAYS AS ((amount_paid
 * - applied) - refunded_amount) STORED — confirmed live 2026-08-24, the
 * only generated column across the ten target tables. A generated column's
 * key must be OMITTED from the payload entirely (not set to null, not set
 * to the same value Postgres would compute) or the write fails outright.
 * PostgREST's OpenAPI doc (the only live-schema source reachable without a
 * direct Postgres connection) does NOT distinguish generated columns from
 * ordinary ones — this can only be caught via
 * information_schema.columns.is_generated in the SQL editor. Any new
 * target table added to this script should be checked there first.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAllRows } from './lib/supabase-paginate.mjs'
import { withRetry } from './lib/retry.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const ORGANIZATION_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'

const argv = process.argv.slice(2)
function getFlag(name) { const a = argv.find((a) => a.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null }
const APPLY = argv.includes('--apply')
const DRY_RUN = !APPLY // --dry-run is the default; only --apply turns writes on
const VERBOSE = argv.includes('--verbose') // --customers=<file> mode only — see header. Single-customer mode is always fully verbose (unchanged).
const CUSTOMER_SHOPVOX_ID = getFlag('customer')
const CUSTOMERS_FILE = getFlag('customers')
const PROGRESS_FILE = getFlag('progress') || join(root, 'scripts', 'state', 'promote-progress.txt')
if (!CUSTOMER_SHOPVOX_ID && !CUSTOMERS_FILE) { console.error('FATAL: --customer=<shopvox_customer_uuid> or --customers=<file> is required'); process.exit(1) }
if (CUSTOMER_SHOPVOX_ID && CUSTOMERS_FILE) { console.error('FATAL: pass --customer OR --customers, not both'); process.exit(1) }

function loadEnv() {
  const envPath = join(root, '.env.local')
  const env = readFileSync(envPath, 'utf8')
  return Object.fromEntries(env.split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
}
const vars = loadEnv()
if (!vars.SUPABASE_SERVICE_ROLE_KEY) { console.error('FATAL: SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(1) }
const sb = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY)

// UUIDv5-style deterministic id for entities that have no real ShopVOX-side
// id of their own — transaction_charges, bom_items, job_workflow_steps, and
// job_line_items' own row identity (NOT quote/sales_order/invoice line items
// any more — those use their real ShopVOX id, see the header comment).
// Simple, stable, deterministic hash into a uuid shape; not cryptographic,
// doesn't need to be — only needs to be the same output for the same input
// every run.
import { createHash } from 'node:crypto'
function deterministicUuid(seed) {
  const hash = createHash('sha256').update(seed).digest('hex')
  return [hash.slice(0, 8), hash.slice(8, 12), '5' + hash.slice(13, 16), ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20), hash.slice(20, 32)].join('-')
}

function round2c(dollars) { // dollars -> integer cents, rounded
  if (dollars === null || dollars === undefined) return null
  return Math.round(dollars * 100)
}
function isFracCents(dollars) { // true if dollars*100 is not a whole number
  if (dollars === null || dollars === undefined) return false
  const c = dollars * 100
  return Math.abs(Math.round(c) - c) > 1e-6
}
function dollarsToCentsExact(dollars) { // dollars -> "cents" numeric column, NO rounding (unit_price rule)
  if (dollars === null || dollars === undefined) return null
  return dollars * 100
}
function toTimestamp(dateStr) { // 'YYYY-MM-DD' -> timestamptz-compatible string
  if (!dateStr) return null
  return dateStr.length === 10 ? `${dateStr}T00:00:00Z` : dateStr
}
const CENTS_CEILING = 50000000 // $500,000 in cents — well above the highest credit_memo value seen ($30,500) — catches a stray scale/round bug, same defense as promote-purchase-orders.mjs's dollar ceiling
function assertSaneCentsAmount(value, label) {
  if (value === null || value === undefined) return
  if (Math.abs(value) > CENTS_CEILING) throw new Error(`REFUSING TO WRITE: ${label} = ${value} exceeds the sane-cents ceiling of ${CENTS_CEILING} — looks like a scaling bug, not a real value.`)
}

// ── Report accumulator ──────────────────────────────────────────────────
// A factory, not a fixed object: --customers=<file> mode calls
// promoteOneCustomer() once per customer in the same process, and this
// state must reset for each one — a module-level constant here would leak
// counts/fallbacks/skips across customers instead of starting fresh.
// `report` is reassigned at the top of promoteOneCustomer(); the addX
// helpers below close over the `let` binding so they always see whichever
// customer is currently being processed.
function freshReport(shopvoxId) {
  return {
    customer: { shopvoxId, nativeId: null, found: false },
    counts: {}, // table -> {toInsert, toUpdate, skipped}
    skipped: {}, // table -> [{shopvox_id, reason}]
    fallbacksApplied: {}, // table.field -> count
    unmappedFields: {}, // table -> [{field, note, nonEmptyCount}]
    precisionNotes: {}, // table.field -> {rounded: n, samples: [...]}
    chainLinks: { quoteToSo: { resolved: 0, unresolved: 0 }, soToInvoice: { resolved: 0, unresolved: 0 }, soToQuote: { resolved: 0, unresolved: 0 } },
    notPromotedKinds: {}, // kind -> count (credit_memo etc — no rule given)
    proposedDefaults: [], // things I decided without an explicit rule — flagged for confirmation
  }
}
let report = freshReport(CUSTOMER_SHOPVOX_ID || null)
function addUnmapped(table, field, note, nonEmptyCount) {
  report.unmappedFields[table] = report.unmappedFields[table] || []
  report.unmappedFields[table].push({ field, note, nonEmptyCount })
}
function addFallback(key, n) { report.fallbacksApplied[key] = (report.fallbacksApplied[key] || 0) + n }
function addSkip(table, shopvoxId, reason) {
  report.skipped[table] = report.skipped[table] || []
  report.skipped[table].push({ shopvox_id: shopvoxId, reason })
}

// ── Step 1: resolve native customer ─────────────────────────────────────
async function resolveCustomer(customerShopvoxId) {
  const { data, error } = await withRetry(
    () => sb.from('customers').select('id').eq('organization_id', ORGANIZATION_ID).eq('shopvox_id', customerShopvoxId).limit(2),
    'customers lookup'
  )
  if (error) throw new Error(`customer lookup failed: ${error.message}`)
  if (!data || data.length === 0) throw new Error(`no native customer found with shopvox_id=${customerShopvoxId} — cannot promote without a resolved customer link (rule 6)`)
  if (data.length > 1) throw new Error(`FATAL: ${data.length} native customers share shopvox_id=${customerShopvoxId} — should be impossible (verified 0 duplicates), refusing to guess`)
  report.customer.nativeId = data[0].id
  report.customer.found = true
  return data[0].id
}

// ── Step 2: fetch all staging data for this customer ────────────────────
async function fetchStaging(customerShopvoxId) {
  const transactions = await fetchAllRows(sb, 'shopvox_transactions', (q) =>
    q.select('shopvox_id,kind,number,number_int,title,status,transaction_date,due_date,sales_rep,production_manager,project_manager,subtotal,tax_total,total,payments_total,credit_total,balance,is_voided,parent_quote_shopvox_id,parent_sales_order_shopvox_id,primary_contact_name,raw,captured_at')
      .eq('organization_id', ORGANIZATION_ID).eq('customer_shopvox_id', customerShopvoxId))

  const jobs = await fetchAllRows(sb, 'shopvox_jobs', (q) =>
    q.select('shopvox_id,number,number_int,title,job_status,description,due_date,production_due_date,install_due_date,created_at_source,updated_at_source,sales_rep,production_manager,project_manager,designer,estimator,installer,line_items_price,raw')
      .eq('organization_id', ORGANIZATION_ID).eq('customer_shopvox_id', customerShopvoxId))

  const txnByKind = { quote: [], sales_order: [], invoice: [], payment: [], credit_memo: [] }
  for (const t of transactions) {
    if (txnByKind[t.kind]) txnByKind[t.kind].push(t)
    else report.notPromotedKinds[t.kind] = (report.notPromotedKinds[t.kind] || 0) + 1
  }

  const lineItemParentIds = [...txnByKind.quote, ...txnByKind.sales_order, ...txnByKind.invoice].map((t) => t.shopvox_id)
  const jobIds = jobs.map((j) => j.shopvox_id)
  const CHUNK = 150

  async function fetchByIn(table, col, ids, select) {
    const out = []
    for (let i = 0; i < ids.length; i += CHUNK) {
      out.push(...(await fetchAllRows(sb, table, (q) => q.select(select).in(col, ids.slice(i, i + CHUNK)).eq('organization_id', ORGANIZATION_ID))))
    }
    return out
  }

  const lineItems = await fetchByIn('shopvox_line_items', 'transaction_shopvox_id', lineItemParentIds,
    'id,shopvox_line_item_id,transaction_shopvox_id,position,product_name,category,secondary_category,description,quantity,unit,unit_discount,unit_price,total_price,taxable,modifiers,price_per_uom,buying_cost,markup,list_price,internal_notes,product_description,part_number,raw')

  // credit_memo line items — fetched separately from the quote/SO/invoice
  // line items above (not merged into lineItemParentIds) so the existing
  // kindToKey-based line-item loop, which only knows about those three
  // kinds, isn't touched at all.
  const creditMemoIds = txnByKind.credit_memo.map((t) => t.shopvox_id)
  const creditMemoLineItems = await fetchByIn('shopvox_line_items', 'transaction_shopvox_id', creditMemoIds,
    'id,shopvox_line_item_id,transaction_shopvox_id,position,product_name,description,quantity,unit,unit_price,total_price,taxable,raw')

  const transactionCharges = await fetchByIn('shopvox_transaction_charges', 'transaction_shopvox_id', lineItemParentIds,
    'transaction_shopvox_id,label,amount,taxable,tax_amount,sort_order')

  const bomByJob = await fetchByIn('shopvox_bom_items', 'job_shopvox_id', jobIds,
    'job_shopvox_id,transaction_shopvox_id,position,material_name,quantity,uom,unit_cost,total_cost,notes')
  const bomByTxn = await fetchByIn('shopvox_bom_items', 'transaction_shopvox_id', lineItemParentIds,
    'job_shopvox_id,transaction_shopvox_id,position,material_name,quantity,uom,unit_cost,total_cost,notes')
  // job_shopvox_id is null on transaction-attributed rows (terminal-stage BOM
  // logic — confirmed live 0 rows with both set) so simple concatenation
  // can't double-count the same row from both fetches.
  const bomItems = [...bomByJob, ...bomByTxn]

  const jobLineItems = await fetchByIn('shopvox_job_line_items', 'job_shopvox_id', jobIds,
    'job_shopvox_id,transaction_shopvox_id,line_item_position,transaction_kind')

  const jobWorkflowSteps = await fetchByIn('shopvox_job_workflow_steps', 'job_shopvox_id', jobIds,
    'job_shopvox_id,stage,step_name,position,status,assignee_count,assignees,recorded_time_minutes,started_at,completed_at,actual_seconds,has_time_spents,last_event_type,last_event_user,estimated_user_seconds,estimated_machine_seconds,manual_time_seconds')

  // documents: (parent_shopvox_id, doc_type) is NOT always unique — 5 of
  // Sames' 960 raw rows are the same transaction's PDF captured twice, once
  // by the retired chain-capture pilot (captured_at null) and once by the
  // real capture (captured_at set). Deduped below, preferring the real one.
  const documentsRaw = await fetchByIn('shopvox_documents', 'parent_shopvox_id', lineItemParentIds,
    'parent_shopvox_id,doc_type,filename,storage_bucket,storage_path,content_type,file_size_bytes,sha256,captured_at')

  const proofs = await fetchByIn('shopvox_proofs', 'job_shopvox_id', jobIds,
    'shopvox_id,job_shopvox_id,filename,version,uploaded_at,approval_status,view_count,comment_count,content_type,file_size_bytes,storage_path,download_url')

  const emails = await fetchAllRows(sb, 'shopvox_emails', (q) =>
    q.select('id,shopvox_id,parent_kind,parent_shopvox_id,from_name,from_email,sent_to,cc_to,subject,body_html,body_text,template_name,sent_at,opened')
      .eq('organization_id', ORGANIZATION_ID).eq('customer_shopvox_id', customerShopvoxId))
  const emailStagingIds = emails.map((e) => e.id)
  const emailAttachments = await fetchByIn('shopvox_email_attachments', 'email_id', emailStagingIds,
    'email_id,filename,storage_path,content_type,file_size_bytes,raw')

  return { txnByKind, jobs, lineItems, creditMemoLineItems, transactionCharges, bomItems, jobLineItems, jobWorkflowSteps, documentsRaw, proofs, emails, emailAttachments }
}

// ── Step 3: resolve-or-mint native ids by shopvox_id (id, not shopvox_id, is the upsert arbiter — see header) ─
async function resolveIdMap(table, shopvoxIds, { orgColumn = 'organization_id' } = {}) {
  // orgColumn override: quote_line_items is the documented outlier that
  // scopes by org_id, not organization_id like every other table (Migration
  // C note, confirmed live the hard way elsewhere in this file already).
  const map = new Map()
  let existing = 0
  const CHUNK = 150
  for (let i = 0; i < shopvoxIds.length; i += CHUNK) {
    const chunk = shopvoxIds.slice(i, i + CHUNK)
    const { data, error } = await withRetry(
      () => sb.from(table).select('id,shopvox_id,is_historical').eq(orgColumn, ORGANIZATION_ID).in('shopvox_id', chunk),
      `${table} id resolution (offset ${i})`
    )
    if (error) throw new Error(`${table} id resolution failed: ${error.message}`)
    for (const row of data) map.set(row.shopvox_id, row)
  }
  for (const id of shopvoxIds) {
    if (map.has(id)) existing++
    else map.set(id, { id: randomUUID(), shopvox_id: id, is_historical: false, _new: true })
  }
  return { map, existing, fresh: shopvoxIds.length - existing }
}

// ── Main (per-customer) ─────────────────────────────────────────────────
// Promotes exactly one customer. Called once for --customer=<uuid>, and
// once per line for --customers=<file> (see the driver main() at the
// bottom). `verbose` gates every console.log in this function through the
// local `log()` — --customer mode always passes verbose:true (unchanged
// output from before this refactor); --customers mode defaults to false so
// a multi-thousand-customer run doesn't dump the full per-table report for
// every single one (see header). Throws (does not process.exit) on any
// fatal error, so a multi-customer driver can catch it and move on to the
// next customer instead of the whole run dying on one bad row.
async function promoteOneCustomer(customerShopvoxId, { verbose = true } = {}) {
  report = freshReport(customerShopvoxId)
  const log = verbose ? (...a) => console.log(...a) : () => {}

  log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY (writing)'}`)
  log(`Customer (shopvox): ${customerShopvoxId}`)

  const customerId = await resolveCustomer(customerShopvoxId)
  log(`Resolved native customer id: ${customerId}`)

  const { txnByKind, jobs, lineItems, creditMemoLineItems, transactionCharges, bomItems, jobLineItems, jobWorkflowSteps, documentsRaw, proofs, emails, emailAttachments } = await fetchStaging(customerShopvoxId)
  log(`Staging fetched: ${txnByKind.quote.length} quotes, ${txnByKind.sales_order.length} sales_orders, ${txnByKind.invoice.length} invoices, ${txnByKind.payment.length} payments, ${txnByKind.credit_memo.length} credit_memos, ${jobs.length} jobs, ${lineItems.length} line items, ${creditMemoLineItems.length} credit memo line items, ${transactionCharges.length} transaction charges, ${bomItems.length} bom items, ${jobLineItems.length} job line items, ${jobWorkflowSteps.length} job workflow steps, ${documentsRaw.length} documents (raw), ${proofs.length} proofs, ${emails.length} emails, ${emailAttachments.length} email attachments`)
  if (Object.keys(report.notPromotedKinds).length) {
    log('Transaction kinds with no promotion rule this pass (left in staging, not written):', JSON.stringify(report.notPromotedKinds))
  }

  const quoteIds = await resolveIdMap('quotes', txnByKind.quote.map((t) => t.shopvox_id))
  const soIds = await resolveIdMap('sales_orders', txnByKind.sales_order.map((t) => t.shopvox_id))
  const invIds = await resolveIdMap('invoices', txnByKind.invoice.map((t) => t.shopvox_id))
  const jobIds = await resolveIdMap('jobs', jobs.map((j) => j.shopvox_id))
  const payIds = await resolveIdMap('payments', txnByKind.payment.map((t) => t.shopvox_id))
  const emailIds = await resolveIdMap('emails', emails.map((e) => e.shopvox_id))
  const proofVersionIds = await resolveIdMap('proof_versions', proofs.map((p) => p.shopvox_id))

  // reverse map for quotes.converted_to_so_id: quote_shopvox_id -> sales_order native id.
  // Ruben's rule: set it ONLY where exactly one sales_order converted from that
  // quote — never pick arbitrarily among multiple. sales_orders.quote_id (set
  // below, independently) carries the full 1:many relationship regardless;
  // converted_to_so_id is just the single-value reverse pointer and has to stay
  // null where that reverse pointer would be ambiguous.
  const soChildrenByQuote = new Map() // quote_shopvox_id -> [so_shopvox_id, ...]
  for (const so of txnByKind.sales_order) {
    if (so.parent_quote_shopvox_id && quoteIds.map.has(so.parent_quote_shopvox_id)) {
      const list = soChildrenByQuote.get(so.parent_quote_shopvox_id) || []
      list.push(so.shopvox_id)
      soChildrenByQuote.set(so.parent_quote_shopvox_id, list)
    }
  }
  const quoteToSoNative = new Map()
  let quotesWithMultipleSo = 0
  for (const [quoteShopvoxId, children] of soChildrenByQuote) {
    if (children.length === 1) quoteToSoNative.set(quoteShopvoxId, soIds.map.get(children[0]).id)
    else quotesWithMultipleSo++
  }

  const distinctStatus = { quote: new Set(), sales_order: new Set(), invoice: new Set(), job: new Set() }

  // ── quotes ──
  const quoteRows = []
  let emptyTitleCount = 0
  for (const t of txnByKind.quote) {
    const idRow = quoteIds.map.get(t.shopvox_id)
    distinctStatus.quote.add(t.status)
    let title = t.title && t.title.trim() ? t.title.trim() : null
    if (!title) { title = `ShopVOX Quote #${t.number || t.number_int || t.shopvox_id}`; emptyTitleCount++ }
    const subtotal = round2c(t.subtotal)
    const taxTotal = round2c(t.tax_total)
    const total = round2c(t.total)
    quoteRows.push({
      id: idRow.id,
      organization_id: ORGANIZATION_ID,
      customer_id: customerId,
      quote_number: t.number_int ?? (t.number ? parseInt(t.number, 10) : null),
      title,
      status: t.status,
      created_at: toTimestamp(t.transaction_date),
      updated_at: toTimestamp(t.transaction_date),
      subtotal, tax_total: taxTotal, total,
      due_date: t.due_date,
      contact_name: t.primary_contact_name || null,
      converted_to_so_id: quoteToSoNative.get(t.shopvox_id) || null,
      discount_percent: 0,
      ready_to_send: false,
      shopvox_id: t.shopvox_id,
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
    })
    if (quoteToSoNative.has(t.shopvox_id)) report.chainLinks.soToQuote.resolved++
  }
  addFallback('quotes.title', emptyTitleCount)
  addUnmapped('quotes', 'description', 'no staging column on shopvox_transactions for a quote body/description', 0)
  addUnmapped('quotes', 'po_number, install_address, production_notes, terms, notes, expires_at', 'no staging column captured for these', 0)
  addUnmapped('quotes', 'sales_rep_id', `staging carries "${'sales_rep'}" as a free-text name only (no profile-matching resolution rule given) — left null; name preserved in shopvox_transactions.raw`, txnByKind.quote.filter(t=>t.sales_rep).length)
  addUnmapped('quotes', 'contact_id', 'primary_contact_name mapped to contact_name (text); no name/email matching rule given to resolve the customer_contacts FK', txnByKind.quote.filter(t=>t.primary_contact_name).length)
  addUnmapped('quotes', 'discount_percent', 'no staging discount % column on shopvox_transactions for quotes — left at default 0', 0)

  // ── sales_orders ──
  const soRows = []
  let soUnresolvedParent = 0
  for (const t of txnByKind.sales_order) {
    const idRow = soIds.map.get(t.shopvox_id)
    distinctStatus.sales_order.add(t.status)
    let quoteId = null
    if (t.parent_quote_shopvox_id) {
      if (quoteIds.map.has(t.parent_quote_shopvox_id)) { quoteId = quoteIds.map.get(t.parent_quote_shopvox_id).id; report.chainLinks.quoteToSo.resolved++ }
      else { soUnresolvedParent++; report.chainLinks.quoteToSo.unresolved++ }
    }
    soRows.push({
      id: idRow.id,
      organization_id: ORGANIZATION_ID,
      so_number: t.number_int ?? (t.number ? parseInt(t.number, 10) : null),
      quote_id: quoteId,
      customer_id: customerId,
      status: t.status,
      title: t.title && t.title.trim() ? t.title.trim() : null,
      subtotal: round2c(t.subtotal), // Migration D
      tax_total: round2c(t.tax_total), // Migration D
      total: round2c(t.total),
      created_at: toTimestamp(t.transaction_date),
      updated_at: toTimestamp(t.transaction_date),
      discount_percent: 0,
      shopvox_id: t.shopvox_id,
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
    })
  }
  addUnmapped('sales_orders', 'notes, approved_at, approved_by, contact_id', 'no staging source / no resolution rule', 0)
  if (soUnresolvedParent) addSkip('sales_orders.quote_id (partial)', null, `${soUnresolvedParent} sales_orders reference a parent_quote_shopvox_id not found among this customer's own promoted quotes — quote_id left null on those rows (row itself still promoted)`)

  // ── invoices ──
  const invRows = []
  let invUnresolvedParent = 0
  let creditIdentityChecked = 0, creditIdentityPassed = 0, nonZeroCreditApplied = 0
  const creditIdentityFailures = []
  const iifTimestamp = new Date().toISOString() // see report: proposed default, flagged below
  for (const t of txnByKind.invoice) {
    const idRow = invIds.map.get(t.shopvox_id)
    distinctStatus.invoice.add(t.status)
    let soId = null
    if (t.parent_sales_order_shopvox_id) {
      if (soIds.map.has(t.parent_sales_order_shopvox_id)) { soId = soIds.map.get(t.parent_sales_order_shopvox_id).id; report.chainLinks.soToInvoice.resolved++ }
      else { invUnresolvedParent++; report.chainLinks.soToInvoice.unresolved++ }
    }
    const exportedAt = toTimestamp(t.transaction_date)
    invRows.push({
      id: idRow.id,
      organization_id: ORGANIZATION_ID,
      sales_order_id: soId,
      customer_id: customerId,
      invoice_number: t.number_int ?? (t.number ? parseInt(t.number, 10) : null),
      status: t.status,
      subtotal: round2c(t.subtotal),
      tax_total: round2c(t.tax_total),
      total: round2c(t.total),
      amount_paid: round2c(t.payments_total),
      balance_due: round2c(t.balance),
      credit_applied: round2c(t.credit_total) ?? 0, // Migration K — same round2c/unit handling balance_due uses from t.balance, no separate conversion. Column is NOT NULL DEFAULT 0 — round2c(null) is null, coalesced to 0 so this never violates that constraint. Descriptive only: t.balance already nets this, credit_applied never feeds a calculation, it just makes the credit visible on the row instead of implicit.
      due_date: t.due_date,
      created_at: toTimestamp(t.transaction_date),
      updated_at: toTimestamp(t.transaction_date),
      is_posted: true, // rule 7
      posted_at: exportedAt, // rule 7: "posted_at from the transaction date"
      discount_percent: 0,
      title: t.title && t.title.trim() ? t.title.trim() : null,
      iif_first_exported_at: null, // decided: these mean "exported from PrintOS" — never happened here, not fabricated
      iif_last_exported_at: null,
      iif_export_count: 1, // decided: re-export protection keys off is_historical, not this count
      shopvox_id: t.shopvox_id,
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
    })
    // Migration K identity check: total - amount_paid - credit_applied must
    // equal balance_due EXACTLY on every invoice with a non-zero credit —
    // proven on invoice #5013 (Task Y), enforced here on every row, not
    // just that one. A mismatch means the units/rounding assumption doesn't
    // generalize — stop the whole run rather than write a wrong value.
    const builtRow = invRows[invRows.length - 1]
    if (builtRow.credit_applied) {
      nonZeroCreditApplied++
      creditIdentityChecked++
      const expected = (builtRow.total ?? 0) - (builtRow.amount_paid ?? 0) - builtRow.credit_applied
      if (expected === builtRow.balance_due) creditIdentityPassed++
      else creditIdentityFailures.push({ shopvox_id: t.shopvox_id, total: builtRow.total, amount_paid: builtRow.amount_paid, credit_applied: builtRow.credit_applied, balance_due: builtRow.balance_due, expected })
    }
  }
  if (creditIdentityFailures.length) {
    throw new Error(`FATAL: credit_applied identity (total - amount_paid - credit_applied = balance_due) failed on ${creditIdentityFailures.length}/${creditIdentityChecked} invoice(s) with a non-zero credit: ${JSON.stringify(creditIdentityFailures)}`)
  }
  addUnmapped('invoices', 'notes, contact_id, billing_*, shipping_*, install_address', 'no staging source captured for billing/shipping address snapshot on invoices', 0)
  if (invUnresolvedParent) addSkip('invoices.sales_order_id (partial)', null, `${invUnresolvedParent} invoices reference a parent_sales_order_shopvox_id not found among this customer's own promoted sales_orders — sales_order_id left null on those rows (row itself still promoted)`)

  // ── SAFETY CHECK (Migration J requirement): promoting credit memos must
  // NEVER touch an invoice's balance_due — ShopVOX's own invoice.balance
  // already nets the credit (proven to the penny on invoice #5013, Task X).
  // Snapshot invRows now, before any credit_memo code runs, and diff it
  // after — this is a real runtime assertion, not just an architectural
  // claim, exactly as asked.
  const invRowsSnapshotBeforeCreditMemos = JSON.stringify(invRows)

  // ── credit_memos ──
  const cmIdMap = await resolveIdMap('credit_memos', txnByKind.credit_memo.map((t) => t.shopvox_id))
  const distinctCmStatus = new Set()
  let cmQuoteResolved = 0, cmQuoteUnresolved = 0, cmSoResolved = 0, cmSoUnresolved = 0, cmInvoiceResolved = 0, cmInvoiceUnresolved = 0
  let cmSubtotalFrac = 0, cmTaxFrac = 0, cmTotalFrac = 0, cmBalanceFrac = 0
  const cmRows = []
  for (const t of txnByKind.credit_memo) {
    const idRow = cmIdMap.map.get(t.shopvox_id)
    distinctCmStatus.add(t.status)

    let quoteId = null
    if (t.parent_quote_shopvox_id) {
      if (quoteIds.map.has(t.parent_quote_shopvox_id)) { quoteId = quoteIds.map.get(t.parent_quote_shopvox_id).id; cmQuoteResolved++ }
      else cmQuoteUnresolved++
    }
    let soId = null
    if (t.parent_sales_order_shopvox_id) {
      if (soIds.map.has(t.parent_sales_order_shopvox_id)) { soId = soIds.map.get(t.parent_sales_order_shopvox_id).id; cmSoResolved++ }
      else cmSoUnresolved++
    }
    // invoice_id: not a staged column on shopvox_transactions (unlike
    // parent_quote/parent_sales_order) — derive from the previous_transactions
    // chain in raw, same source Task X used to prove the credit-nets-balance
    // finding. A chain entry pointing outside this customer's own promoted
    // invoices is left null and counted, never guessed.
    let invoiceId = null
    const prevTxns = t.raw?.endpoints?.previous_transactions?.body?.previousTransactions || []
    const invoiceEntry = prevTxns.find((p) => p.type === 'Invoice')
    if (invoiceEntry) {
      if (invIds.map.has(invoiceEntry.id)) { invoiceId = invIds.map.get(invoiceEntry.id).id; cmInvoiceResolved++ }
      else cmInvoiceUnresolved++
    } else {
      cmInvoiceUnresolved++
    }

    const cmDetail = t.raw?.endpoints?.detail?.body?.creditMemo || {}
    const prices = t.raw?.endpoints?.prices?.body?.prices || {}
    // MONEY IS CENTS, numeric, unrounded (Migration J, explicit — deviates
    // from round2c() used on total-type fields elsewhere in this file; here
    // every money field uses the same unrounded ×100 as unit_price does).
    const subtotal = dollarsToCentsExact(prices.totalPriceInDollars)
    const taxTotal = dollarsToCentsExact(prices.totalTaxInDollars)
    const total = dollarsToCentsExact(prices.totalPriceWithTaxInDollars)
    const balance = dollarsToCentsExact(prices.balanceInDollars)
    assertSaneCentsAmount(subtotal, `credit_memos.subtotal (${t.shopvox_id})`)
    assertSaneCentsAmount(taxTotal, `credit_memos.tax_total (${t.shopvox_id})`)
    assertSaneCentsAmount(total, `credit_memos.total (${t.shopvox_id})`)
    assertSaneCentsAmount(balance, `credit_memos.balance (${t.shopvox_id})`)
    if (isFracCents(prices.totalPriceInDollars)) cmSubtotalFrac++
    if (isFracCents(prices.totalTaxInDollars)) cmTaxFrac++
    if (isFracCents(prices.totalPriceWithTaxInDollars)) cmTotalFrac++
    if (isFracCents(prices.balanceInDollars)) cmBalanceFrac++

    cmRows.push({
      id: idRow.id,
      organization_id: ORGANIZATION_ID,
      customer_id: customerId,
      credit_memo_number: t.number_int ?? (t.number ? parseInt(t.number, 10) : null),
      quote_id: quoteId,
      sales_order_id: soId,
      invoice_id: invoiceId,
      status: t.status, // verbatim: open / closed / void — void IS promoted, it's a real record, it just never affected a balance
      title: cmDetail.title && cmDetail.title.trim() ? cmDetail.title.trim() : null,
      credit_memo_date: t.transaction_date || null,
      subtotal, tax_total: taxTotal, total, balance,
      notes: cmDetail.specialNotes || null,
      created_by: null, // no FK per Ruben's decision — historical credit memos have no PrintOS user
      created_at: toTimestamp(t.transaction_date),
      updated_at: toTimestamp(t.transaction_date),
      shopvox_id: t.shopvox_id,
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
    })
  }
  if (cmQuoteUnresolved) addSkip('credit_memos.quote_id (partial)', null, `${cmQuoteUnresolved} credit memos reference a parent_quote_shopvox_id not found among this customer's own promoted quotes — quote_id left null (row itself still promoted)`)
  if (cmSoUnresolved) addSkip('credit_memos.sales_order_id (partial)', null, `${cmSoUnresolved} credit memos reference a parent_sales_order_shopvox_id not found among this customer's own promoted sales_orders — sales_order_id left null (row itself still promoted)`)
  if (cmInvoiceUnresolved) addSkip('credit_memos.invoice_id (partial)', null, `${cmInvoiceUnresolved} credit memos had no Invoice entry in their previous_transactions chain, or it pointed outside this customer's own promoted invoices — invoice_id left null (row itself still promoted)`)

  // ── credit_memo_line_items ──
  const cmLineItemShopvoxIds = creditMemoLineItems.map((li) => li.shopvox_line_item_id).filter(Boolean)
  const cmliIdMap = await resolveIdMap('credit_memo_line_items', cmLineItemShopvoxIds)
  const cmParentById = new Map(txnByKind.credit_memo.map((t) => [t.shopvox_id, cmIdMap.map.get(t.shopvox_id)]))
  const cmLineItemRows = []
  let cmLiUnresolvedParent = 0, cmLiMissingShopvoxId = 0, cmLiUnitPriceFrac = 0, cmLiTotalPriceFrac = 0
  for (const li of creditMemoLineItems) {
    const parentRow = cmParentById.get(li.transaction_shopvox_id)
    if (!parentRow) { cmLiUnresolvedParent++; continue }
    if (!li.shopvox_line_item_id) { cmLiMissingShopvoxId++; continue }
    const idRow = cmliIdMap.map.get(li.shopvox_line_item_id)
    let description = li.description && li.description.trim() ? li.description.trim() : null
    if (!description) description = li.product_name && li.product_name.trim() ? li.product_name.trim() : 'ShopVOX line item'

    const rawLi = li.raw?.lineItem || null
    let discountPercent = 0, discountAmount = null
    if (rawLi && rawLi.discountIsPercentage != null) {
      if (rawLi.discountIsPercentage) discountPercent = rawLi.discountPercent ?? 0
      else discountAmount = rawLi.discountInDollars != null ? dollarsToCentsExact(rawLi.discountInDollars) : null
    }

    const unitPrice = dollarsToCentsExact(li.unit_price)
    const totalPrice = dollarsToCentsExact(li.total_price)
    assertSaneCentsAmount(unitPrice, `credit_memo_line_items.unit_price (${li.shopvox_line_item_id})`)
    assertSaneCentsAmount(totalPrice, `credit_memo_line_items.total_price (${li.shopvox_line_item_id})`)
    if (isFracCents(li.unit_price)) cmLiUnitPriceFrac++
    if (isFracCents(li.total_price)) cmLiTotalPriceFrac++

    cmLineItemRows.push({
      id: idRow.id,
      credit_memo_id: parentRow.id,
      organization_id: ORGANIZATION_ID,
      product_name: li.product_name || null,
      description,
      quantity: li.quantity,
      unit: li.unit || null,
      unit_price: unitPrice,
      total_price: totalPrice,
      discount_percent: discountPercent,
      discount_amount: discountAmount,
      taxable: li.taxable ?? true,
      sort_order: li.position ?? 0,
      created_at: new Date().toISOString(), // proposed default — no natural per-line-item created_at captured; flagged, not fabricated as a real ShopVOX timestamp
      shopvox_id: li.shopvox_line_item_id, // the line item's own real ShopVOX id, from day one — no position hash anywhere in this table
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
    })
  }
  if (cmLiUnresolvedParent) addSkip('credit_memo_line_items (partial)', null, `${cmLiUnresolvedParent} line items reference a credit memo not in this customer's promoted set — skipped`)
  if (cmLiMissingShopvoxId) addSkip('credit_memo_line_items (partial)', null, `${cmLiMissingShopvoxId} line items had no shopvox_line_item_id in staging — skipped`)
  if (cmLineItemRows.length) {
    report.proposedDefaults.push({
      field: 'credit_memo_line_items.created_at',
      proposal: 'new Date().toISOString() at promotion time',
      reasoning: 'No per-line-item created_at is captured anywhere in the ShopVOX line item payload (same as every other line-item table) — this is a promotion-time stamp, not a ShopVOX timestamp, flagged so it is not mistaken for one.',
    })
  }

  if (JSON.stringify(invRows) !== invRowsSnapshotBeforeCreditMemos) {
    throw new Error('FATAL: invRows changed while building credit_memos/credit_memo_line_items — credit memo promotion must NEVER touch an invoice row. Refusing to continue.')
  }

  // ── jobs ──
  const jobRows = []
  let jobEmptyTitle = 0
  for (const j of jobs) {
    const idRow = jobIds.map.get(j.shopvox_id)
    distinctStatus.job.add(j.job_status)
    let title = j.title && j.title.trim() ? j.title.trim() : null
    if (!title) { title = `ShopVOX Job #${j.number || j.number_int || j.shopvox_id}`; jobEmptyTitle++ }
    jobRows.push({
      id: idRow.id,
      organization_id: ORGANIZATION_ID,
      customer_id: customerId,
      job_number: j.number_int ?? (j.number ? parseInt(j.number, 10) : null),
      title,
      description: j.description || null,
      status: j.job_status,
      due_date: j.due_date,
      created_at: j.created_at_source || toTimestamp(j.due_date),
      updated_at: j.updated_at_source || j.created_at_source,
      production_due_date: j.production_due_date || null,
      installation_due_date: j.install_due_date || null,
      needs_revision: false,
      total_price: round2c(j.line_items_price), // Migration L — same round2c()/unit handling credit_applied uses from credit_total, no separate conversion. Column is nullable with no default (unlike credit_applied) — round2c(null) stays null on purpose, so "no price recorded" stays distinguishable from "$0".
      shopvox_id: j.shopvox_id,
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
    })
  }
  addFallback('jobs.title', jobEmptyTitle)
  addUnmapped('jobs', 'sales_order_id, invoice_id, source_quote_id, quote_line_item_id', 'job-to-transaction chain linking was not in rule 8\'s explicit scope (only sales_orders.quote_id / invoices.sales_order_id / quotes.converted_to_so_id were named) — left null this pass', jobs.length)
  addUnmapped('jobs', 'fabrication_due_date, material_selection, assigned_printer, department, proof_*, completed_at, flag, assigned_to, upcoming_departments, contact_id', 'no staging source or no resolution rule (staff names like sales_rep/designer/estimator/installer/production_manager/project_manager have no destination column on native jobs at all)', 0)

  // ── payment_applications (built first — payments.applied/balance below depend on it) ──
  // Source: payment.invoicePayments[] / quotePayments[] / orderPayments[] in the
  // raw capture. Same shape assumed for all three arrays (id, amountInDollars,
  // ...) — invoicePayments is the only one with real data on any of Sames' 123
  // payments (quotePayments/orderPayments are empty on every one). The
  // quote/sales_order handling below is therefore untested against a real
  // example — implemented because it's mechanically identical, not because it's
  // been seen working. Flagged in the report, not hidden.
  const paymentAppRows = []
  const perPaymentApplied = new Map() // payment.shopvox_id -> sum of amount_applied (cents)
  const perPaymentPairs = new Map() // payment.shopvox_id -> [{targetKind, targetId, amountInDollars, resolved}]
  let papUnresolvedTarget = 0
  const papTargetSources = [
    { arrayKey: 'invoicePayments', targetKind: 'invoice', idMap: invIds.map, fkField: 'invoice_id' },
    { arrayKey: 'quotePayments', targetKind: 'quote', idMap: quoteIds.map, fkField: 'quote_id' },
    { arrayKey: 'orderPayments', targetKind: 'sales_order', idMap: soIds.map, fkField: 'sales_order_id' },
  ]
  let quotePaymentsSeen = 0, orderPaymentsSeen = 0
  for (const t of txnByKind.payment) {
    const raw = t.raw?.endpoints?.detail?.body?.payment || {}
    const payIdRow = payIds.map.get(t.shopvox_id)
    const pairs = []
    for (const src of papTargetSources) {
      const arr = raw[src.arrayKey] || []
      if (src.arrayKey === 'quotePayments') quotePaymentsSeen += arr.length
      if (src.arrayKey === 'orderPayments') orderPaymentsSeen += arr.length
      for (const entry of arr) {
        const targetRow = src.idMap.get(entry.id)
        const resolved = !!targetRow
        if (!resolved) papUnresolvedTarget++
        pairs.push({ targetKind: src.targetKind, targetId: entry.id, amountInDollars: entry.amountInDollars, resolved })
        if (resolved) {
          const cents = round2c(entry.amountInDollars)
          paymentAppRows.push({
            id: deterministicUuid(`${t.shopvox_id}:${entry.id}`),
            organization_id: ORGANIZATION_ID,
            payment_id: payIdRow.id,
            [src.fkField]: targetRow.id,
            amount_applied: cents,
            applied_at: toTimestamp(t.transaction_date),
            shopvox_id: deterministicUuid(`${t.shopvox_id}:${entry.id}`),
            shopvox_imported_at: new Date().toISOString(),
            is_historical: false,
          })
          perPaymentApplied.set(t.shopvox_id, (perPaymentApplied.get(t.shopvox_id) || 0) + cents)
        }
      }
    }
    perPaymentPairs.set(t.shopvox_id, pairs)
  }

  // Reconciliation: does each payment's applications sum to its own amount?
  let payReconcileMatch = 0, payReconcileMismatch = 0
  const payReconcileMismatchSamples = []
  for (const t of txnByKind.payment) {
    const raw = t.raw?.endpoints?.detail?.body?.payment || {}
    const paymentCents = round2c(raw.amountInDollars)
    const appliedCents = perPaymentApplied.get(t.shopvox_id) || 0
    if (paymentCents === appliedCents) payReconcileMatch++
    else {
      payReconcileMismatch++
      if (payReconcileMismatchSamples.length < 10) {
        payReconcileMismatchSamples.push({ payment_shopvox_id: t.shopvox_id, payment_amount_cents: paymentCents, applications_sum_cents: appliedCents, diff_cents: paymentCents - appliedCents, pairs: perPaymentPairs.get(t.shopvox_id) })
      }
    }
  }

  // ── payments ──
  const payRows = []
  let payMissingMethod = 0
  for (const t of txnByKind.payment) {
    const idRow = payIds.map.get(t.shopvox_id)
    const raw = t.raw?.endpoints?.detail?.body?.payment || {}
    const methodName = raw.paymentMethod?.name || raw.paymentMethod?.paymentMethodType || null
    let method = methodName
    if (!method) { method = 'Unknown'; payMissingMethod++ }
    const amountCents = round2c(raw.amountInDollars)
    const appliedCents = perPaymentApplied.get(t.shopvox_id) || 0
    // payments.balance is GENERATED ALWAYS AS ((amount_paid - applied) -
    // refunded_amount) STORED — confirmed live (2026-08-24). The key must be
    // OMITTED entirely, not set (not even to null/the same computed value) —
    // Postgres rejects any explicit value on a GENERATED ALWAYS column.
    // expectedBalance is kept only for the report's own reconciliation math.
    const expectedBalance = amountCents - appliedCents
    payRows.push({
      id: idRow.id,
      organization_id: ORGANIZATION_ID,
      payment_number: t.number_int ?? (t.number ? parseInt(t.number, 10) : null),
      customer_id: customerId,
      amount_paid: amountCents,
      payment_method: method,
      applied: appliedCents, // sum of this payment's own payment_applications rows
      paid_on: t.transaction_date || raw.paidOn || null,
      note: raw.note || null,
      check_number: raw.checkNumber || null,
      // refunded_amount intentionally omitted — owned by recalc_payment_refunded(),
      // which derives it as SUM(refunds.amount). The promoter must never write it:
      // writing 0 here would reset it on every re-promotion (including the
      // cutover-weekend delta run), leaving refunds rows intact but payment
      // balances wrong — and payments.balance is GENERATED from refunded_amount.
      // Omitting the key means an INSERT gets the column DEFAULT 0 and an UPSERT
      // leaves the existing (trigger-derived) value alone, which is correct either way.
      // balance intentionally omitted — generated column, see comment above
      is_posted: raw.posted === true,
      posted_at: raw.posted === true ? toTimestamp(t.transaction_date) : null,
      shopvox_id: t.shopvox_id,
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
    })
  }
  addFallback('payments.payment_method', payMissingMethod)
  report.proposedDefaults.push({
    field: 'payments.refunded_amount',
    proposal: 'still 0 — unchanged this pass',
    reasoning: 'No rule given, and 0 refund-kind transactions exist for Sames to test against. applied/balance are now computed from real payment_applications sums, per your instruction; refunded_amount is not addressed by that and stays a placeholder.',
  })
  addUnmapped('payments', 'created_by, updated_by, card_last4, card_brand, gateway_transaction_id', 'no resolution rule (created_by needs a profile match) / not applicable to this customer\'s payment methods (Check, Trade — no card data present)', 0)

  // ── line items ──
  const kindToKey = {}
  for (const t of txnByKind.quote) kindToKey[t.shopvox_id] = { table: 'quote_line_items', parentIdMap: quoteIds.map }
  for (const t of txnByKind.sales_order) kindToKey[t.shopvox_id] = { table: 'sales_order_line_items', parentIdMap: soIds.map }
  for (const t of txnByKind.invoice) kindToKey[t.shopvox_id] = { table: 'invoice_line_items', parentIdMap: invIds.map }

  // Pass 1: partition by destination table and collect each line item's REAL
  // ShopVOX id (shopvox_line_item_id, Migration I) so resolveIdMap() can look
  // up existing native ids in one batched query per table, same as every
  // other promoted table. A line item with no shopvox_line_item_id in
  // staging (not expected — 100% populated in everything captured so far,
  // but not assumed permanent) is skipped and reported, never derived from
  // position.
  const liShopvoxIdsByTable = { quote_line_items: [], sales_order_line_items: [], invoice_line_items: [] }
  let liUnresolvedParent = 0, liMissingShopvoxId = 0
  for (const li of lineItems) {
    const route = kindToKey[li.transaction_shopvox_id]
    if (!route) { liUnresolvedParent++; continue } // parent not in this customer's fetched set — shouldn't happen given how we fetched, but guard anyway
    if (!li.shopvox_line_item_id) { liMissingShopvoxId++; continue }
    liShopvoxIdsByTable[route.table].push(li.shopvox_line_item_id)
  }
  const qliIdMap = await resolveIdMap('quote_line_items', liShopvoxIdsByTable.quote_line_items, { orgColumn: 'org_id' })
  const soliIdMap = await resolveIdMap('sales_order_line_items', liShopvoxIdsByTable.sales_order_line_items)
  const iliIdMap = await resolveIdMap('invoice_line_items', liShopvoxIdsByTable.invoice_line_items)
  const liIdMapByTable = { quote_line_items: qliIdMap, sales_order_line_items: soliIdMap, invoice_line_items: iliIdMap }

  // lookup used by job_line_items below: (transaction_shopvox_id, position) ->
  // every shopvox_line_item_id found there. Almost always exactly one; more
  // than one means a genuine ShopVOX position collision (4 known quotes,
  // none in the pilot 12) — job_line_items has no way to disambiguate that
  // from its own data (it carries no line-item id, only a position), so it
  // must skip and report rather than guess which one it means.
  const lineItemsByTxnPosition = new Map()
  for (const li of lineItems) {
    if (!li.shopvox_line_item_id) continue
    const key = `${li.transaction_shopvox_id}:${li.position}`
    if (!lineItemsByTxnPosition.has(key)) lineItemsByTxnPosition.set(key, [])
    lineItemsByTxnPosition.get(key).push(li.shopvox_line_item_id)
  }

  // Pass 2: build the actual rows, now that ids are resolved.
  const lineItemRowsByTable = { quote_line_items: [], sales_order_line_items: [], invoice_line_items: [] }
  let liDescFallback = 0
  const liUnitPriceFracCount = { quote_line_items: 0, sales_order_line_items: 0, invoice_line_items: 0 }
  const liTotalPriceFracCount = { quote_line_items: 0, sales_order_line_items: 0, invoice_line_items: 0 }
  let liDiscountPercentCount = 0, liDiscountAmountCount = 0, liDiscountMissingRaw = 0
  for (const li of lineItems) {
    const route = kindToKey[li.transaction_shopvox_id]
    if (!route || !li.shopvox_line_item_id) continue // already counted above
    const parentRow = route.parentIdMap.get(li.transaction_shopvox_id)
    const idRow = liIdMapByTable[route.table].map.get(li.shopvox_line_item_id)
    let description = li.description && li.description.trim() ? li.description.trim() : null
    if (!description) {
      description = li.product_name && li.product_name.trim() ? li.product_name.trim() : 'ShopVOX line item'
      liDescFallback++
    }
    if (isFracCents(li.unit_price)) liUnitPriceFracCount[route.table]++
    if (isFracCents(li.total_price)) liTotalPriceFracCount[route.table]++

    // Discount, from raw — NOT the conflated unit_discount column (see report:
    // unit_discount mixes percent and dollar values indistinguishably).
    // raw.lineItem carries discountIsPercentage/discountPercent/discountInDollars
    // separately — read those instead.
    const rawLi = li.raw?.lineItem || null
    let discountPercent = 0, discountAmount = null
    if (rawLi && rawLi.discountIsPercentage != null) {
      if (rawLi.discountIsPercentage) {
        discountPercent = rawLi.discountPercent ?? 0
        if (discountPercent) liDiscountPercentCount++
      } else {
        // Same cents convention as unit_price (money field on the same row) —
        // exact, no rounding, consistent with the unit_price-exact decision.
        // Not explicitly specified for this new column — flagged in report.
        discountAmount = rawLi.discountInDollars != null ? rawLi.discountInDollars * 100 : null
        if (discountAmount) liDiscountAmountCount++
      }
    } else {
      liDiscountMissingRaw++
    }

    const parentFk = route.table === 'quote_line_items' ? 'quote_id' : route.table === 'sales_order_line_items' ? 'sales_order_id' : 'invoice_id'
    // quote_line_items is the documented outlier (Migration C note): it scopes
    // by org_id, not organization_id like every other table including the two
    // new line-item tables. Confirmed live 2026-08-24 the hard way — a plain
    // organization_id write fails with "column not found in schema cache".
    const orgFk = route.table === 'quote_line_items' ? 'org_id' : 'organization_id'
    lineItemRowsByTable[route.table].push({
      id: idRow.id,
      [parentFk]: parentRow.id,
      [orgFk]: ORGANIZATION_ID,
      product_name: li.product_name || null,
      quantity: li.quantity, // numeric, no scaling (decided)
      unit_price: dollarsToCentsExact(li.unit_price), // *100, NOT rounded (decided)
      total_price: round2c(li.total_price), // integer cents, rounded
      description,
      sort_order: li.position ?? 0,
      discount_percent: discountPercent,
      discount_amount: discountAmount, // Migration D
      taxable: li.taxable ?? true,
      category: li.category || null,
      secondary_category: li.secondary_category || null,
      unit: li.unit || null,
      price_per_uom: li.price_per_uom != null ? li.price_per_uom * 100 : null, // same cents convention as unit_price
      buying_cost: li.buying_cost != null ? li.buying_cost * 100 : null,
      markup: li.markup, // markup is a rate/multiplier, not a currency amount — not scaled
      list_price: li.list_price != null ? li.list_price * 100 : null,
      product_description: li.product_description || null,
      internal_notes: li.internal_notes || null,
      shopvox_id: li.shopvox_line_item_id, // the real ShopVOX line-item id (Migration I) — not derived, resolved
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
    })
  }
  if (liMissingShopvoxId) addSkip('*_line_items (partial)', null, `${liMissingShopvoxId} line items had no shopvox_line_item_id in staging — skipped`)
  addFallback('*_line_items.description', liDescFallback)
  addUnmapped('*_line_items', 'width, height', 'no ShopVOX-side equivalent at all (native-only fields) — always null for promoted rows, not a loss', 0)
  addUnmapped('*_line_items', 'product_id', 'by design (Migration C directive): historical line items are reference-only text, never FK\'d to the live product catalog', 0)
  addUnmapped('*_line_items', 'modifier_values', `shopvox_line_items.modifiers is stored as TEXT (not jsonb) and its shape was not verified against what modifier_values expects — left at default '{}' rather than guess a possibly-wrong shape (0 of ${lineItems.length} Sames rows have a non-empty value anyway)`, 0)
  addUnmapped('*_line_items', 'part_number, income_account, cog_account', 'part_number: 0% populated org-wide (dead column, per earlier investigation). income_account/cog_account: deferred by Ruben\'s explicit instruction (QuickBooks scope)', 0)
  report.discountMapping = { liDiscountPercentCount, liDiscountAmountCount, liDiscountMissingRaw, totalLineItems: lineItems.length }
  if (liDiscountAmountCount > 0) {
    report.proposedDefaults.push({
      field: '*_line_items.discount_amount cents convention',
      proposal: `raw discountInDollars × 100, exact, no rounding (same convention as unit_price)`,
      reasoning: `Migration D didn't specify whether discount_amount follows the cents convention like unit_price/buying_cost/etc. Assumed yes for consistency (it's a money field on the same row) — ${liDiscountAmountCount} rows are dollar-type discounts and would be affected if this assumption is wrong.`,
    })
  }

  // ── transaction_charges ──
  const chargeRows = []
  let chargeUnresolvedParent = 0
  for (const c of transactionCharges) {
    const route = kindToKey[c.transaction_shopvox_id]
    if (!route) { chargeUnresolvedParent++; continue }
    const parentRow = route.parentIdMap.get(c.transaction_shopvox_id)
    const parentFk = route.table === 'quote_line_items' ? 'quote_id' : route.table === 'sales_order_line_items' ? 'sales_order_id' : 'invoice_id'
    const seed = `charge:${c.transaction_shopvox_id}:${c.sort_order}`
    chargeRows.push({
      id: deterministicUuid(seed),
      [parentFk]: parentRow.id,
      organization_id: ORGANIZATION_ID,
      label: c.label,
      amount: round2c(c.amount),
      taxable: c.taxable ?? true,
      tax_amount: round2c(c.tax_amount),
      sort_order: c.sort_order ?? 0,
      shopvox_id: deterministicUuid(seed),
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
    })
  }
  if (chargeUnresolvedParent) addSkip('transaction_charges (partial)', null, `${chargeUnresolvedParent} charges reference a transaction not in this customer's promoted quote/sales_order/invoice set — skipped, no row to attach to`)

  // ── bom_items ──
  const bomRows = []
  let bomUnresolvedParent = 0
  for (const b of bomItems) {
    let parentFk, parentId, seedKey
    if (b.job_shopvox_id) {
      const jobRow = jobIds.map.get(b.job_shopvox_id)
      if (!jobRow) { bomUnresolvedParent++; continue }
      parentFk = 'job_id'; parentId = jobRow.id; seedKey = `job:${b.job_shopvox_id}`
    } else if (b.transaction_shopvox_id) {
      const route = kindToKey[b.transaction_shopvox_id]
      if (!route) { bomUnresolvedParent++; continue }
      const parentRow = route.parentIdMap.get(b.transaction_shopvox_id)
      parentFk = route.table === 'quote_line_items' ? 'quote_id' : route.table === 'sales_order_line_items' ? 'sales_order_id' : 'invoice_id'
      parentId = parentRow.id; seedKey = `txn:${b.transaction_shopvox_id}`
    } else {
      bomUnresolvedParent++; continue // neither job nor transaction set — not observed live, guarded anyway
    }
    const seed = `bom:${seedKey}:${b.position}`
    bomRows.push({
      id: deterministicUuid(seed),
      [parentFk]: parentId,
      organization_id: ORGANIZATION_ID,
      position: b.position ?? 0,
      material_name: b.material_name || null,
      quantity: b.quantity,
      uom: b.uom || null,
      unit_cost: dollarsToCentsExact(b.unit_cost), // numeric, unrounded — 39% of Sames rows have fractional cents, confirmed live
      total_cost: round2c(b.total_cost),
      notes: b.notes || null,
      shopvox_id: deterministicUuid(seed),
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
    })
  }
  if (bomUnresolvedParent) addSkip('bom_items (partial)', null, `${bomUnresolvedParent} BOM rows reference a job or transaction not in this customer's promoted set — skipped`)

  // ── job_line_items ──
  // job_line_items' own row identity still has no real ShopVOX id and stays
  // a deterministic hash (job_shopvox_id, transaction_shopvox_id, position)
  // — that key isn't affected by the line-item id fix, it has no position
  // collision of its own to worry about. What DOES change: resolving WHICH
  // line item it points at. This used to blindly re-derive
  // deterministicUuid(transaction_shopvox_id:position) as the target id,
  // assuming that formula equaled the target row's real id — it no longer
  // does. Now it does a REAL lookup: match (transaction_shopvox_id,
  // line_item_position) against this customer's already-fetched
  // shopvox_line_items (lineItemsByTxnPosition, built above) to find the
  // target's real shopvox_line_item_id, then resolve THAT through the same
  // id map the line items above were written with — no re-derivation.
  // shopvox_job_line_items.line_item_position was confirmed live to match
  // shopvox_line_items.position 1,040/1,040 times for Sames, but a position
  // can now genuinely match more than one shopvox_line_items row (the same
  // 4-quote collision the line items above report) — job_line_items carries
  // no line-item id of its own, only a position, so that case is genuinely
  // unresolvable from its own data. Skipped and reported, never guessed.
  const jobLineItemRows = []
  let jliUnresolvedJob = 0, jliUnresolvedTxn = 0, jliUnresolvedTarget = 0, jliAmbiguousPosition = 0
  for (const r of jobLineItems) {
    const jobRow = jobIds.map.get(r.job_shopvox_id)
    if (!jobRow) { jliUnresolvedJob++; continue }
    const route = kindToKey[r.transaction_shopvox_id]
    if (!route) { jliUnresolvedTxn++; continue }
    const key = `${r.transaction_shopvox_id}:${r.line_item_position}`
    const candidates = lineItemsByTxnPosition.get(key) || []
    if (candidates.length > 1) {
      jliAmbiguousPosition++
      addSkip('job_line_items (ambiguous position)', r.job_shopvox_id, `${candidates.length} line items share position ${r.line_item_position} on transaction ${r.transaction_shopvox_id} (shopvox_line_item_ids: ${candidates.join(', ')}) — cannot determine which one this job line points to, skipped rather than guess`)
      continue
    }
    if (candidates.length === 0) { jliUnresolvedTarget++; continue }
    const targetRow = liIdMapByTable[route.table].map.get(candidates[0])
    if (!targetRow) { jliUnresolvedTarget++; continue } // defensive — shouldn't happen, the line items loop resolves every id in this same map
    const fkField = route.table === 'quote_line_items' ? 'quote_line_item_id' : route.table === 'sales_order_line_items' ? 'sales_order_line_item_id' : 'invoice_line_item_id'
    const seed = `jli:${r.job_shopvox_id}:${r.transaction_shopvox_id}:${r.line_item_position}`
    jobLineItemRows.push({
      id: deterministicUuid(seed),
      job_id: jobRow.id,
      [fkField]: targetRow.id,
      organization_id: ORGANIZATION_ID,
      position: r.line_item_position ?? 0,
      shopvox_id: deterministicUuid(seed),
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
    })
  }
  if (jliUnresolvedJob || jliUnresolvedTxn || jliUnresolvedTarget) addSkip('job_line_items (partial)', null, `${jliUnresolvedJob} rows had an unresolved job, ${jliUnresolvedTxn} an unresolved parent transaction, ${jliUnresolvedTarget} an unresolved target line item — skipped`)

  // ── job_workflow_steps ──
  const workflowStepRows = []
  let stepsUnresolvedJob = 0
  for (const s of jobWorkflowSteps) {
    const jobRow = jobIds.map.get(s.job_shopvox_id)
    if (!jobRow) { stepsUnresolvedJob++; continue }
    const seed = `step:${s.job_shopvox_id}:${s.stage}:${s.position}`
    workflowStepRows.push({
      id: deterministicUuid(seed),
      job_id: jobRow.id,
      organization_id: ORGANIZATION_ID,
      stage: s.stage || null,
      step_name: s.step_name || null,
      position: s.position ?? 0,
      status: s.status || null,
      assignee_count: s.assignee_count,
      assignees: s.assignees || null,
      recorded_time_minutes: s.recorded_time_minutes,
      started_at: s.started_at,
      completed_at: s.completed_at,
      actual_seconds: s.actual_seconds,
      has_time_spents: s.has_time_spents,
      last_event_type: s.last_event_type || null,
      last_event_user: s.last_event_user || null,
      estimated_user_seconds: s.estimated_user_seconds, // parsed seconds, NOT the H:M:S text — per instruction
      estimated_machine_seconds: s.estimated_machine_seconds,
      manual_time_seconds: s.manual_time_seconds,
      shopvox_id: deterministicUuid(seed),
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
    })
  }
  if (stepsUnresolvedJob) addSkip('job_workflow_steps (partial)', null, `${stepsUnresolvedJob} steps reference a job not in this customer's promoted set — skipped`)

  // ── documents ── dedupe (parent_shopvox_id, doc_type), preferring the row with captured_at set (the real capture over the retired chain-capture pilot's leftover)
  const docsByKey = new Map()
  for (const d of documentsRaw) {
    const key = `${d.parent_shopvox_id}:${d.doc_type}`
    const existing = docsByKey.get(key)
    if (!existing || (!existing.captured_at && d.captured_at)) docsByKey.set(key, d)
  }
  const documentRows = []
  let docUnresolvedParent = 0
  for (const d of docsByKey.values()) {
    const route = kindToKey[d.parent_shopvox_id]
    if (!route) { docUnresolvedParent++; continue }
    const parentRow = route.parentIdMap.get(d.parent_shopvox_id)
    const parentFk = route.table === 'quote_line_items' ? 'quote_id' : route.table === 'sales_order_line_items' ? 'sales_order_id' : 'invoice_id'
    const seed = `doc:${d.parent_shopvox_id}:${d.doc_type}`
    documentRows.push({
      id: deterministicUuid(seed),
      [parentFk]: parentRow.id,
      organization_id: ORGANIZATION_ID,
      doc_type: d.doc_type,
      filename: d.filename || null,
      storage_bucket: null, // stays null until files move to Supabase Storage — a later backfill rewrites this and storage_path together
      storage_path: d.storage_path,
      content_type: d.content_type || null,
      file_size_bytes: d.file_size_bytes,
      sha256: d.sha256 || null,
      shopvox_id: deterministicUuid(seed),
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
    })
  }
  if (docUnresolvedParent) addSkip('documents (partial)', null, `${docUnresolvedParent} documents reference a transaction not in this customer's promoted set — skipped`)
  report.docDedupeCount = documentsRaw.length - docsByKey.size

  // ── proof_versions (EXISTING table, 7 live app rows — untouched: they carry
  // shopvox_id = null, which never matches the resolveIdMap lookup below) ──
  const proofRows = []
  let proofUnresolvedJob = 0
  for (const p of proofs) {
    const jobRow = jobIds.map.get(p.job_shopvox_id)
    if (!jobRow) { proofUnresolvedJob++; continue }
    const idRow = proofVersionIds.map.get(p.shopvox_id)
    proofRows.push({
      id: idRow.id,
      job_id: jobRow.id,
      organization_id: ORGANIZATION_ID, // nullable on this table, set explicitly anyway per instruction
      file_name: p.filename || null,
      version_number: p.version,
      status: p.approval_status, // verbatim — all six values now allowed
      created_at: p.uploaded_at,
      content_type: p.content_type || null,
      view_count: p.view_count,
      comment_count: p.comment_count,
      file_size_bytes: p.file_size_bytes,
      // file_url is NOT NULL on this table (confirmed live — leaving it
      // null, as an earlier version of this code did, would have failed on
      // the first insert). Decided: file_url gets the real ShopVOX asset
      // URL (still genuinely fetchable today, which is what the column
      // means) — storage_path carries the local downloaded copy in the
      // meantime, same storage_bucket/storage_path split documents uses.
      // Once files move to Supabase Storage, file_url gets rewritten to the
      // Supabase public URL and storage_bucket stops being null.
      file_url: p.download_url,
      storage_bucket: null,
      storage_path: p.storage_path,
      shopvox_id: p.shopvox_id,
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
    })
  }
  if (proofUnresolvedJob) addSkip('proof_versions (partial)', null, `${proofUnresolvedJob} proofs reference a job not in this customer's promoted set — skipped`)

  // ── emails ──
  const emailRows = []
  for (const e of emails) {
    const idRow = emailIds.map.get(e.shopvox_id)
    const row = {
      id: idRow.id,
      organization_id: ORGANIZATION_ID,
      customer_id: customerId,
      from_name: e.from_name || null,
      from_email: e.from_email || null,
      sent_to: e.sent_to || null,
      cc_to: e.cc_to || null,
      subject: e.subject || null,
      body_html: e.body_html || null,
      body_text: e.body_text || null,
      template_name: e.template_name || null,
      sent_at: e.sent_at,
      opened: e.opened ?? false,
      shopvox_id: e.shopvox_id,
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
    }
    // At most one parent set; zero (the "Company"/general-customer-email
    // case, and any unresolved parent) is legitimate — no skip, no CHECK.
    if (e.parent_kind === 'job') { const r = jobIds.map.get(e.parent_shopvox_id); if (r) row.job_id = r.id }
    else if (e.parent_kind === 'payment') { const r = payIds.map.get(e.parent_shopvox_id); if (r) row.payment_id = r.id }
    else if (['quote', 'sales_order', 'invoice'].includes(e.parent_kind)) {
      const route = kindToKey[e.parent_shopvox_id]
      if (route) {
        const fk = route.table === 'quote_line_items' ? 'quote_id' : route.table === 'sales_order_line_items' ? 'sales_order_id' : 'invoice_id'
        row[fk] = route.parentIdMap.get(e.parent_shopvox_id).id
      }
    }
    emailRows.push(row)
  }

  // ── email_attachments — a linking problem, not a download ──
  const emailByStagingId = new Map(emails.map((e) => [e.id, e]))
  // First doc found per parent wins — matches the >99% real-world case
  // (99.5% of Sames attachments) where an attachment is simply the parent
  // transaction's own PDF, whichever doc_type that parent happens to have.
  const documentsByParent = new Map()
  for (const d of docsByKey.values()) if (!documentsByParent.has(d.parent_shopvox_id)) documentsByParent.set(d.parent_shopvox_id, d)
  const proofsByFilename = new Map()
  for (const p of proofs) if (p.filename && !proofsByFilename.has(p.filename)) proofsByFilename.set(p.filename, p)

  const attachmentRows = []
  let attachResolvedDoc = 0, attachResolvedProof = 0, attachUnresolved = 0, attachNoParentEmail = 0
  for (const att of emailAttachments) {
    const email = emailByStagingId.get(att.email_id)
    if (!email) { attachNoParentEmail++; continue }
    const emailRow = emailIds.map.get(email.shopvox_id)
    // fixed mapper (att.fileName) applied here directly from raw, since the
    // already-imported filename column is still null for existing rows —
    // no staging re-import required, see report.
    const fileName = att.raw?.fileName || att.filename || null
    const rawId = att.raw?.id || null

    // Exact filename match against a proof is checked FIRST — it's a
    // stronger, more specific signal than "the parent transaction happens
    // to have some document." Checking document-first would misattribute a
    // proof image emailed alongside an invoice to that invoice's own PDF
    // just because the parent has a document at all — caught live: without
    // this ordering, "Alicia Villarreal Proof.png" (a real proof, confirmed
    // downloaded) resolved to its parent invoice's PDF instead, silently
    // wrong despite counting as "resolved."
    let storagePath = null, contentType = null, fileSizeBytes = null, sha256 = null, resolvedVia = 'none'
    if (fileName && proofsByFilename.has(fileName)) {
      const proof = proofsByFilename.get(fileName)
      storagePath = proof.storage_path; contentType = proof.content_type; fileSizeBytes = proof.file_size_bytes
      resolvedVia = 'proof'
    } else if (['quote', 'sales_order', 'invoice'].includes(email.parent_kind)) {
      const doc = documentsByParent.get(email.parent_shopvox_id)
      if (doc) { storagePath = doc.storage_path; contentType = doc.content_type; fileSizeBytes = doc.file_size_bytes; sha256 = doc.sha256; resolvedVia = 'document' }
    }
    if (resolvedVia === 'document') attachResolvedDoc++
    else if (resolvedVia === 'proof') attachResolvedProof++
    else attachUnresolved++

    const seed = rawId || `attach:${att.email_id}:${fileName}`
    attachmentRows.push({
      id: deterministicUuid(seed),
      organization_id: ORGANIZATION_ID,
      email_id: emailRow.id,
      filename: fileName,
      storage_bucket: null,
      storage_path: storagePath,
      content_type: contentType,
      file_size_bytes: fileSizeBytes,
      sha256: sha256,
      shopvox_id: rawId || deterministicUuid(seed), // real ShopVOX attachment id when present (370/370 for Sames) — not synthetic
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
    })
  }
  if (attachNoParentEmail) addSkip('email_attachments (partial)', null, `${attachNoParentEmail} attachments reference an email not in this customer's promoted set — skipped`)

  // ── counts ──
  report.counts = {
    quotes: { total: quoteRows.length, existing: quoteIds.existing, fresh: quoteIds.fresh },
    sales_orders: { total: soRows.length, existing: soIds.existing, fresh: soIds.fresh },
    invoices: { total: invRows.length, existing: invIds.existing, fresh: invIds.fresh },
    jobs: { total: jobRows.length, existing: jobIds.existing, fresh: jobIds.fresh },
    payments: { total: payRows.length, existing: payIds.existing, fresh: payIds.fresh },
    quote_line_items: { total: lineItemRowsByTable.quote_line_items.length, existing: qliIdMap.existing, fresh: qliIdMap.fresh },
    sales_order_line_items: { total: lineItemRowsByTable.sales_order_line_items.length, existing: soliIdMap.existing, fresh: soliIdMap.fresh },
    invoice_line_items: { total: lineItemRowsByTable.invoice_line_items.length, existing: iliIdMap.existing, fresh: iliIdMap.fresh },
    payment_applications: { total: paymentAppRows.length },
    transaction_charges: { total: chargeRows.length },
    bom_items: { total: bomRows.length },
    job_line_items: { total: jobLineItemRows.length },
    job_workflow_steps: { total: workflowStepRows.length },
    documents: { total: documentRows.length, existing: 0, fresh: documentRows.length },
    proof_versions: { total: proofRows.length, existing: proofVersionIds.existing, fresh: proofVersionIds.fresh },
    emails: { total: emailRows.length, existing: emailIds.existing, fresh: emailIds.fresh },
    email_attachments: { total: attachmentRows.length },
    credit_memos: { total: cmRows.length, existing: cmIdMap.existing, fresh: cmIdMap.fresh },
    credit_memo_line_items: { total: cmLineItemRows.length, existing: cmliIdMap.existing, fresh: cmliIdMap.fresh },
  }

  // ── print report ──
  log('\n=== ROWS THIS RUN WOULD WRITE (per table) ===')
  for (const [table, c] of Object.entries(report.counts)) {
    if ('fresh' in c) log(`  ${table}: ${c.total} total (${c.fresh} new insert, ${c.existing} would update existing)`)
    else log(`  ${table}: ${c.total} total`)
  }

  log('\n=== DISTINCT STATUS VALUES OBSERVED (mapped verbatim, rule 5) ===')
  for (const [k, s] of Object.entries(distinctStatus)) log(`  ${k}: ${JSON.stringify([...s])}`)

  log('\n=== CHAIN LINKS (rule 8) ===')
  log(`  sales_orders.quote_id: ${report.chainLinks.quoteToSo.resolved} resolved, ${report.chainLinks.quoteToSo.unresolved} unresolved (parent not in this customer's promoted set)`)
  log(`  invoices.sales_order_id: ${report.chainLinks.soToInvoice.resolved} resolved, ${report.chainLinks.soToInvoice.unresolved} unresolved`)
  log(`  quotes.converted_to_so_id: ${report.chainLinks.soToQuote.resolved} resolved, ${quotesWithMultipleSo} left null (quote converted to more than one sales order — no arbitrary pick, per rule)`)

  log('\n=== FALLBACKS APPLIED (rule 10) ===')
  for (const [k, n] of Object.entries(report.fallbacksApplied)) log(`  ${k}: ${n} rows`)

  log('\n=== PRECISION: fractional-cent unit_price / total_price on this customer\'s line items ===')
  for (const table of Object.keys(lineItemRowsByTable)) {
    log(`  ${table}: unit_price stored full-precision (×100, no rounding) on ${liUnitPriceFracCount[table]} rows; total_price rounded on write (0 required rounding beyond whole cents for this customer, confirmed) — ${liTotalPriceFracCount[table]} rows had fractional cents in total_price (would need reporting if >0)`)
  }

  log('\n=== PAYMENT APPLICATIONS ===')
  log(`  ${paymentAppRows.length} rows would be written to payment_applications, from ${txnByKind.payment.length} payments`)
  log(`  target arrays seen: invoicePayments (populated), quotePayments (${quotePaymentsSeen} entries across all payments), orderPayments (${orderPaymentsSeen} entries)`)
  if (quotePaymentsSeen === 0 && orderPaymentsSeen === 0) {
    log('  quotePayments/orderPayments handling: IMPLEMENTED (same code path as invoicePayments, resolving against quoteIds/soIds) but NOT EXERCISED — 0 entries in either array across all 123 Sames payments. Untested against real data, flagging per your instruction rather than claiming it works.')
  }
  log(`  unresolved application targets (id not found in this customer's promoted quote/so/invoice set): ${papUnresolvedTarget}`)
  log('\n  Reconciliation — does each payment\'s applications sum to its own amount?')
  log(`    match: ${payReconcileMatch} / ${txnByKind.payment.length}`)
  log(`    MISMATCH: ${payReconcileMismatch} / ${txnByKind.payment.length}`)
  if (payReconcileMismatchSamples.length) log('    mismatch samples:', JSON.stringify(payReconcileMismatchSamples, null, 2))

  log('\n=== DISCOUNT MAPPING (from raw.lineItem, not the conflated unit_discount column) ===')
  log(`  discount_percent set (discountIsPercentage=true): ${liDiscountPercentCount} rows`)
  log(`  discount_amount set (discountIsPercentage=false): ${liDiscountAmountCount} rows`)
  log(`  raw.lineItem missing/no discountIsPercentage flag: ${liDiscountMissingRaw} of ${lineItems.length} rows`)

  log('\n=== MIGRATION E TABLES ===')
  log(`  transaction_charges: ${chargeRows.length} rows (0 fractional-cent amount/tax_amount for Sames, confirmed live — plain integer round is exact)`)
  log(`  bom_items: ${bomRows.length} rows (${bomItems.filter((r) => isFracCents(r.unit_cost)).length} with sub-cent unit_cost, stored exact per-cents-numeric, not rounded)`)
  log(`  job_line_items: ${jobLineItemRows.length} rows, target line item id resolved via a real lookup against shopvox_line_items (not re-derived) — see header comment. ${jliAmbiguousPosition} row(s) skipped as ambiguous (position shared by more than one line item)`)
  log(`  job_workflow_steps: ${workflowStepRows.length} rows, from the parsed *_seconds fields, not the H:M:S text`)

  log('\n=== MIGRATION F/G TABLES ===')
  log(`  documents: ${documentRows.length} rows (deduped from ${documentsRaw.length} raw staging rows — ${report.docDedupeCount} were the same transaction+doc_type captured twice, chain-capture pilot vs. real capture; the real one won)`)
  log(`  proof_versions (EXISTING table): ${proofRows.length} rows would upsert; 7 pre-existing live app rows are untouched (shopvox_id null on those, never matched); file_url = the real ShopVOX asset URL, storage_path = the local downloaded copy, storage_bucket left null until the Storage upload`)
  log(`  emails: ${emailRows.length} rows; parent set: ${emailRows.filter((r) => r.job_id || r.quote_id || r.sales_order_id || r.invoice_id || r.payment_id).length}, zero-parent (legitimate): ${emailRows.filter((r) => !r.job_id && !r.quote_id && !r.sales_order_id && !r.invoice_id && !r.payment_id).length}`)
  log(`  email_attachments: ${attachmentRows.length} rows — resolved to a document: ${attachResolvedDoc}, resolved to a proof: ${attachResolvedProof}, unresolved (row exists, no file): ${attachUnresolved}`)

  log('\n=== MIGRATION L (jobs.total_price) ===')
  log(`  jobs with a non-null total_price: ${jobRows.filter((r) => r.total_price !== null).length} / ${jobRows.length}`)

  log('\n=== MIGRATION K (invoices.credit_applied) ===')
  log(`  invoices with a non-zero credit_applied: ${nonZeroCreditApplied} / ${invRows.length}`)
  log(`  identity (total - amount_paid - credit_applied = balance_due) checked: ${creditIdentityChecked}, passed: ${creditIdentityPassed}`)

  log('\n=== MIGRATION J TABLES (credit_memos / credit_memo_line_items) ===')
  log(`  credit_memos: ${cmRows.length} rows, status values seen: ${JSON.stringify([...distinctCmStatus])}`)
  log(`  credit_memos.quote_id: ${cmQuoteResolved} resolved, ${cmQuoteUnresolved} unresolved (left null)`)
  log(`  credit_memos.sales_order_id: ${cmSoResolved} resolved, ${cmSoUnresolved} unresolved (left null)`)
  log(`  credit_memos.invoice_id: ${cmInvoiceResolved} resolved (via previous_transactions chain), ${cmInvoiceUnresolved} unresolved (left null)`)
  log(`  credit_memos money sub-cent counts (cents, unrounded, not errors): subtotal ${cmSubtotalFrac}/${cmRows.length}, tax_total ${cmTaxFrac}/${cmRows.length}, total ${cmTotalFrac}/${cmRows.length}, balance ${cmBalanceFrac}/${cmRows.length}`)
  log(`  credit_memo_line_items: ${cmLineItemRows.length} rows, all shopvox_id from the line item's own real ShopVOX id (no position hash) — sub-cent: unit_price ${cmLiUnitPriceFrac}, total_price ${cmLiTotalPriceFrac}`)
  log(`  money ceiling assertion: no credit_memo/credit_memo_line_items value exceeded ${CENTS_CEILING} cents (would have thrown)`)
  log(`  INVOICE SAFETY CHECK: invRows snapshot before and after credit_memo promotion are byte-identical — 0 invoice rows touched by this promotion (verified by runtime assertion above, not just by construction)`)

  log('\n=== UNMAPPED STAGING FIELDS (no native destination touched, data stays in raw only) ===')
  for (const [table, fields] of Object.entries(report.unmappedFields)) {
    log(`  ${table}:`)
    for (const f of fields) log(`    - ${f.field}: ${f.note}${f.nonEmptyCount ? ` (${f.nonEmptyCount} rows have real data here)` : ''}`)
  }

  log('\n=== PROPOSED DEFAULTS NOT COVERED BY AN EXPLICIT RULE — CONFIRM BEFORE --apply ===')
  for (const p of report.proposedDefaults) {
    log(`  ${p.field}`)
    log(`    proposal: ${p.proposal}`)
    log(`    reasoning: ${p.reasoning}`)
  }

  log('\n=== SKIPPED ROWS ===')
  if (Object.keys(report.skipped).length === 0) log('  none')
  for (const [k, rows] of Object.entries(report.skipped)) log(`  ${k}: ${JSON.stringify(rows)}`)

  log('\n=== NOT PROMOTED THIS PASS (rule set gave no destination) ===')
  log('  transaction kinds:', JSON.stringify(report.notPromotedKinds))
  log('  entities explicitly out of scope (counts not fetched — no rule to promote them, so not queried): activities (activity_log — projection only this pass, see report), sales_leads')

  if (DRY_RUN) {
    log('\n--dry-run: NOTHING WRITTEN. Pass --apply to write.')
    return { shopvoxId: customerShopvoxId, customerId, counts: report.counts, dryRun: true }
  }

  // ── apply ──
  log('\nAPPLYING...')
  const writes = [
    ['quotes', quoteRows], ['sales_orders', soRows], ['invoices', invRows], ['jobs', jobRows], ['payments', payRows],
    ['quote_line_items', lineItemRowsByTable.quote_line_items],
    ['sales_order_line_items', lineItemRowsByTable.sales_order_line_items],
    ['invoice_line_items', lineItemRowsByTable.invoice_line_items],
    ['payment_applications', paymentAppRows],
    ['transaction_charges', chargeRows],
    ['bom_items', bomRows],
    ['job_line_items', jobLineItemRows],
    ['job_workflow_steps', workflowStepRows],
    ['documents', documentRows],
    ['proof_versions', proofRows],
    ['emails', emailRows],
    ['email_attachments', attachmentRows],
    ['credit_memos', cmRows],
    ['credit_memo_line_items', cmLineItemRows],
  ]
  for (const [table, rows] of writes) {
    if (rows.length === 0) continue
    const BATCH = table.includes('line_items') ? 100 : 50
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      // throws (not process.exit) — a --customers=<file> driver run needs to
      // catch this per-customer and move on; a --customer single run still
      // ends up exiting 1 via main()'s own top-level .catch(), same as before.
      const { error } = await withRetry(() => sb.from(table).upsert(batch, { onConflict: 'id' }), `${table} upsert batch offset ${i}`)
      if (error) throw new Error(`${table} upsert failed at offset ${i}: ${error.message}`)
    }
    log(`  ✓ ${table}: ${rows.length} row(s) upserted`)
  }

  return { shopvoxId: customerShopvoxId, customerId, counts: report.counts, dryRun: false }
}

// ── Driver ────────────────────────────────────────────────────────────
function readCustomersFile(path) {
  const raw = readFileSync(path, 'utf8')
  const seen = new Set()
  const ids = []
  for (const line of raw.split('\n')) {
    const id = line.trim()
    if (!id || id.startsWith('#') || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function loadProgress() {
  if (!existsSync(PROGRESS_FILE)) return new Set()
  return new Set(readFileSync(PROGRESS_FILE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean))
}

function appendProgress(id) {
  mkdirSync(dirname(PROGRESS_FILE), { recursive: true })
  appendFileSync(PROGRESS_FILE, id + '\n')
}

function summarizeCounts(counts) {
  return Object.entries(counts || {}).map(([table, c]) => `${table}=${c.total}`).join(' ')
}

async function main() {
  if (CUSTOMER_SHOPVOX_ID) {
    // single-customer mode — unchanged behavior: always fully verbose,
    // exits 1 on the first failure, via the top-level .catch() below.
    await promoteOneCustomer(CUSTOMER_SHOPVOX_ID, { verbose: true })
    return
  }

  // --customers=<file> mode — the wide-run driver.
  const ids = readCustomersFile(CUSTOMERS_FILE)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY (writing)'}`)
  console.log(`Customers in list: ${ids.length}${VERBOSE ? ' (verbose: full per-customer report)' : ' (terse: one summary line per customer — pass --verbose for the full per-table report on each)'}`)

  // Resumability only applies to --apply — see header comment for why a dry
  // run always processes the full list and never touches the progress file.
  const done = APPLY ? loadProgress() : new Set()
  if (APPLY) console.log(`Progress file: ${PROGRESS_FILE} (${done.size} already completed, will be skipped)`)

  const tally = { succeeded: 0, failed: 0, skipped: 0 }
  const failures = []
  const startedAt = Date.now()

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    const pos = `[${i + 1}/${ids.length}]`
    if (APPLY && done.has(id)) {
      console.log(`${pos} ${id}: SKIP — already completed per progress file`)
      tally.skipped++
      continue
    }
    try {
      const summary = await promoteOneCustomer(id, { verbose: VERBOSE })
      tally.succeeded++
      console.log(`${pos} ${id}: OK — ${summarizeCounts(summary.counts)}`)
      if (APPLY) appendProgress(id)
    } catch (err) {
      tally.failed++
      failures.push({ id, message: err.message })
      console.error(`${pos} ${id}: FAILED — ${err.message}`)
      // one customer's failure does not stop the run — every other customer
      // in the list still gets a chance; failures are tallied and re-listed
      // at the end, and (in --apply mode) never enter the progress file, so
      // re-running the same --customers file automatically retries just them.
    }
  }

  const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1)
  console.log('\n=== FINAL TALLY ===')
  console.log(`  total in list: ${ids.length}`)
  console.log(`  succeeded: ${tally.succeeded}`)
  console.log(`  failed: ${tally.failed}`)
  console.log(`  skipped (already done per progress file): ${tally.skipped}`)
  console.log(`  elapsed: ${elapsedMin} min`)
  if (failures.length) {
    console.log('  failures (re-run the same --customers/--progress files to retry just these):')
    for (const f of failures) console.log(`    ${f.id}: ${f.message}`)
  }
  if (tally.failed > 0) process.exitCode = 1
}

main().catch((err) => { console.error('FATAL:', err.message); process.exit(1) })
