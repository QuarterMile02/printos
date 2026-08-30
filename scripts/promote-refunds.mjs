/**
 * promote-refunds.mjs
 *
 * Promotes ShopVOX refund-kind staging data (shopvox_transactions,
 * kind='refund') into the native `refunds` table. Deliberately separate
 * from promote-shopvox-to-native.mjs, which explicitly excludes refunds
 * ("Explicitly NOT this pass: sales_leads, refunds — no settled promotion
 * rule yet") — this script is that settled rule.
 *
 * Usage:
 *   node scripts/promote-refunds.mjs [--dry-run] [--apply]
 *
 * --dry-run is the default. --apply is required to actually write anything.
 *
 * SCOPE: org-scoped, not customer-scoped, same reasoning as
 * promote-purchase-orders.mjs — a refund's own staging row carries a
 * customer_shopvox_id, but the thing that actually matters here (its parent
 * payment) is looked up directly by shopvox id, so there is no reason to
 * shard this by customer. One run covers every staged refund in the org.
 *
 * SOURCE: shopvox_transactions where kind='refund'. Refund money and its
 * parent-payment link live only inside raw.endpoints.detail.body.refund —
 * there is no prices/line_items endpoint for this kind (confirmed in
 * scripts/SHOPVOX_MIGRATION_NOTES.md) and no dedicated staging column for
 * the parent payment id.
 *
 * SEAL-ORDER CONSTRAINT — non-negotiable, per SHOPVOX_MIGRATION_NOTES.md's
 * Migration H notes on recalc_payment_refunded(): refunds must be promoted
 * BEFORE payments are sealed (is_historical = true). recalc_payment_refunded()
 * derives payments.refunded_amount as SUM(refunds.amount) and UPDATEs the
 * payment row on every refund write; that UPDATE fires
 * enforce_historical_immutability, which raises the moment a sealed payment
 * is the target. This script never sets is_historical=true on anything and
 * never touches the payments table at all — it exists purely so refunds
 * land before whatever future seal step runs.
 *
 * NEVER WRITE payments.refunded_amount OR payments.balance — both are
 * derived, not promoted: refunded_amount by recalc_payment_refunded(),
 * balance by payments' own GENERATED ALWAYS AS ((amount_paid - applied) -
 * refunded_amount) STORED expression. This script only ever writes to the
 * `refunds` table; the payments-table numbers printed in the dry-run report
 * below are read-only context (today's pre-trigger values), never written.
 *
 * IDEMPOTENCY / the partial-unique-index gotcha: same as every other target
 * table in promote-shopvox-to-native.mjs — refunds.shopvox_id is a PARTIAL
 * unique index (WHERE shopvox_id IS NOT NULL), so it cannot be an ON
 * CONFLICT target. This script resolves each staging row's existing native
 * `id` by a plain SELECT on shopvox_id first (or mints a fresh randomUUID()
 * if none exists yet), then upserts on `id`.
 *
 * MONEY: refunds.amount is INTEGER CENTS (confirmed live via the OpenAPI
 * schema: "amount": {"format": "integer"}) — same convention as
 * payments.amount_paid, not the dollars-native convention purchase_orders
 * uses. Converted from staging `total` (dollars) with the same round2c()
 * helper promote-shopvox-to-native.mjs uses for payments.amount_paid (line
 * ~815) — refund.total is sourced identically to payment.amountInDollars
 * (straight off the detail body, no line-item math underneath it), so it
 * gets the same treatment. Unlike the main promoter, which only *counts*
 * sub-cent values and rounds through them, this script ASSERTS none exist
 * and aborts rather than silently rounding — a fractional cent on a refund
 * would mean a wrong assumption about how this kind's money works, not a
 * normal precision fact to log and move past.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAllRows } from './lib/supabase-paginate.mjs'
import { withRetry } from './lib/retry.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const ORGANIZATION_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'
const CENTS_CEILING = 50000000 // $500,000 in cents — same defensive ceiling promote-shopvox-to-native.mjs uses; catches a stray scale/round bug, not a real value

// Ruben's stated verification targets — computed values are checked against
// these, not the other way around. A mismatch means something changed
// (more refunds captured, a payment link broke, etc.) and this script stops
// rather than silently promoting on top of a changed assumption.
const EXPECTED = {
  count: 39,
  totalCents: 1208445, // $12,084.45
  dateMin: '2021-09-17',
  dateMax: '2026-07-27',
  distinctPayments: 37,
}

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const DRY_RUN = !APPLY // --dry-run is the default; only --apply turns writes on

function loadEnv() {
  const envPath = join(root, '.env.local')
  const env = readFileSync(envPath, 'utf8')
  return Object.fromEntries(env.split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
}
const vars = loadEnv()
if (!vars.SUPABASE_SERVICE_ROLE_KEY) { console.error('FATAL: SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(1) }
const sb = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY)

function round2c(dollars) { // dollars -> integer cents, rounded — same helper promote-shopvox-to-native.mjs uses for payments.amount_paid
  if (dollars === null || dollars === undefined) return null
  return Math.round(dollars * 100)
}
function isFracCents(dollars) { // true if dollars*100 is not a whole number
  if (dollars === null || dollars === undefined) return false
  const c = dollars * 100
  return Math.abs(Math.round(c) - c) > 1e-6
}
function assertSaneCentsAmount(value, label) {
  if (value === null || value === undefined) return
  if (Math.abs(value) > CENTS_CEILING) throw new Error(`REFUSING TO WRITE: ${label} = ${value} exceeds the sane-cents ceiling of ${CENTS_CEILING} — looks like a scaling bug, not a real value.`)
}

// Same resolve-then-upsert idempotency pattern as promote-shopvox-to-native.mjs
// / promote-purchase-orders.mjs: look up existing native ids by shopvox_id
// first, mint a fresh uuid client-side only for genuinely new rows.
async function resolveIdMap(table, shopvoxIds) {
  const map = new Map()
  const CHUNK = 150
  for (let i = 0; i < shopvoxIds.length; i += CHUNK) {
    const chunk = shopvoxIds.slice(i, i + CHUNK)
    const { data, error } = await withRetry(
      () => sb.from(table).select('id,shopvox_id').eq('organization_id', ORGANIZATION_ID).in('shopvox_id', chunk),
      `${table} id resolution (offset ${i})`
    )
    if (error) throw new Error(`${table} id resolution failed: ${error.message}`)
    for (const row of data) map.set(row.shopvox_id, row)
  }
  let existing = 0
  for (const id of shopvoxIds) {
    if (map.has(id)) existing++
    else map.set(id, { id: randomUUID(), shopvox_id: id, _new: true })
  }
  return { map, existing, fresh: shopvoxIds.length - existing }
}

async function fetchPaymentsByShopvoxId(shopvoxIds) {
  const map = new Map()
  const CHUNK = 150
  for (let i = 0; i < shopvoxIds.length; i += CHUNK) {
    const chunk = shopvoxIds.slice(i, i + CHUNK)
    const { data, error } = await withRetry(
      () => sb.from('payments').select('id,shopvox_id,payment_number,amount_paid,applied,refunded_amount,balance,is_historical')
        .eq('organization_id', ORGANIZATION_ID).in('shopvox_id', chunk),
      `payments id resolution (offset ${i})`
    )
    if (error) throw new Error(`payments lookup failed: ${error.message}`)
    for (const row of data) map.set(row.shopvox_id, row)
  }
  return map
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY (writing)'}`)

  const refunds = await fetchAllRows(sb, 'shopvox_transactions', (q) =>
    q.select('shopvox_id,number,number_int,transaction_date,total,customer_shopvox_id,raw')
      .eq('organization_id', ORGANIZATION_ID).eq('kind', 'refund'))
  console.log(`Staged refunds: ${refunds.length}`)

  const paymentShopvoxIds = [...new Set(refunds.map((r) => r.raw?.endpoints?.detail?.body?.refund?.payment?.id).filter(Boolean))]
  const paymentByShopvoxId = await fetchPaymentsByShopvoxId(paymentShopvoxIds)
  console.log(`Distinct parent payments referenced: ${paymentShopvoxIds.length} (resolved natively: ${paymentByShopvoxId.size})`)

  const refundIdMap = await resolveIdMap('refunds', refunds.map((r) => r.shopvox_id))

  // ── build rows, collecting hard-failure conditions as we go — neither of
  // these is reported-and-skipped, both abort the whole run per the hard
  // requirements ──
  const unresolvedPayments = []
  const fracCentsViolations = []
  let methodMissing = 0
  const paymentRefundCounts = new Map() // payment shopvox_id -> refund count, for the "2 payments have 2 refunds" fact
  const rows = []

  for (const t of refunds) {
    const raw = t.raw?.endpoints?.detail?.body?.refund || {}
    const paymentShopvoxId = raw.payment?.id || null

    if (!paymentShopvoxId || !paymentByShopvoxId.has(paymentShopvoxId)) {
      unresolvedPayments.push({ refund_shopvox_id: t.shopvox_id, refund_number: t.number, referenced_payment_shopvox_id: paymentShopvoxId })
      continue
    }
    paymentRefundCounts.set(paymentShopvoxId, (paymentRefundCounts.get(paymentShopvoxId) || 0) + 1)

    if (isFracCents(t.total)) {
      fracCentsViolations.push({ refund_shopvox_id: t.shopvox_id, refund_number: t.number, total: t.total })
      continue
    }
    const amountCents = round2c(t.total)
    assertSaneCentsAmount(amountCents, `refunds.amount (${t.shopvox_id})`)

    const methodName = raw.paymentMethod?.name || raw.paymentMethod?.paymentMethodType || null
    let paymentMethod = methodName
    if (!paymentMethod) { paymentMethod = 'Unknown'; methodMissing++ }

    const idRow = refundIdMap.map.get(t.shopvox_id)
    const nativePayment = paymentByShopvoxId.get(paymentShopvoxId)

    rows.push({
      id: idRow.id,
      organization_id: ORGANIZATION_ID,
      refund_number: t.number_int ?? (t.number ? parseInt(t.number, 10) : null),
      payment_id: nativePayment.id,
      amount: amountCents,
      payment_method: paymentMethod,
      refunded_on: t.transaction_date || null,
      note: raw.note || null,
      shopvox_id: t.shopvox_id,
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
      _report: { // stripped before write — dry-run/apply context only
        refund_number: t.number,
        total_dollars: t.total,
        payment: nativePayment,
      },
    })
  }

  // ── hard-failure gates — abort loudly, do not skip silently ──
  if (unresolvedPayments.length > 0) {
    console.error(`\nFATAL: ${unresolvedPayments.length} refund(s) could not resolve their parent payment to a native payments.id.`)
    console.error('All 39 are known to resolve — this means something changed. Not skipping, not proceeding:')
    for (const u of unresolvedPayments) console.error(`  refund ${u.refund_number} (${u.refund_shopvox_id}) -> payment shopvox_id ${u.referenced_payment_shopvox_id ?? '(missing entirely)'}`)
    process.exit(1)
  }
  if (fracCentsViolations.length > 0) {
    console.error(`\nFATAL: ${fracCentsViolations.length} refund(s) have a fractional-cent total — refunds.amount is an integer column, this cannot be silently rounded through.`)
    for (const v of fracCentsViolations) console.error(`  refund ${v.refund_number} (${v.refund_shopvox_id}) -> total ${v.total}`)
    process.exit(1)
  }

  // ── verification targets — check computed values against Ruben's stated
  // expectations BEFORE reporting/writing anything further; a mismatch
  // stops the run rather than adjusting the expectation ──
  const totalCents = rows.reduce((sum, r) => sum + r.amount, 0)
  const dates = refunds.map((r) => r.transaction_date).filter(Boolean).sort()
  const dateMin = dates[0]
  const dateMax = dates[dates.length - 1]
  const distinctPayments = paymentShopvoxIds.length

  const checks = [
    ['row count', refunds.length, EXPECTED.count],
    ['total cents', totalCents, EXPECTED.totalCents],
    ['date min', dateMin, EXPECTED.dateMin],
    ['date max', dateMax, EXPECTED.dateMax],
    ['distinct payments referenced', distinctPayments, EXPECTED.distinctPayments],
  ]
  console.log('\n=== VERIFICATION TARGETS ===')
  let anyMismatch = false
  for (const [label, actual, expected] of checks) {
    const ok = actual === expected
    if (!ok) anyMismatch = true
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${expected}, got ${actual}`)
  }
  if (anyMismatch) {
    console.error('\nFATAL: one or more verification targets did not match. STOPPING — not adjusting the expectation, not proceeding.')
    process.exit(1)
  }

  // ── report ──
  console.log('\n=== ROWS THIS RUN WOULD WRITE ===')
  console.log(`  refunds: ${rows.length} total (${refundIdMap.fresh} new insert, ${refundIdMap.existing} would update existing)`)

  console.log('\n=== TOTAL AMOUNT ===')
  console.log(`  ${totalCents} cents = $${(totalCents / 100).toFixed(2)}`)

  console.log('\n=== DATE RANGE ===')
  console.log(`  ${dateMin} to ${dateMax}`)

  console.log('\n=== PAYMENTS WITH MORE THAN ONE REFUND (expected, not a duplicate) ===')
  const multi = [...paymentRefundCounts.entries()].filter(([, c]) => c > 1)
  if (multi.length === 0) console.log('  none')
  else for (const [pid, c] of multi) console.log(`  payment shopvox_id ${pid}: ${c} refunds`)

  console.log('\n=== PAYMENT METHOD ===')
  console.log(`  missing on refund, defaulted to 'Unknown': ${methodMissing}/${rows.length}`)

  console.log('\n=== PER-REFUND DETAIL — current (pre-trigger) parent-payment state ===')
  for (const r of rows) {
    const p = r._report.payment
    console.log(`  refund ${r._report.refund_number} (${r.shopvox_id.slice(0, 8)}…): amount $${r._report.total_dollars.toFixed(2)} (${r.amount}c) -> payment #${p.payment_number} [amount_paid=${p.amount_paid}c applied=${p.applied}c refunded_amount=${p.refunded_amount}c balance=${p.balance}c is_historical=${p.is_historical}]`)
  }

  console.log('\n=== NOT WRITTEN (by design) ===')
  console.log('  payments.refunded_amount / payments.balance — both derived (recalc_payment_refunded() / GENERATED ALWAYS). This script never touches the payments table.')
  console.log('  refunds.created_by / refunds.created_at — no resolution rule (created_by needs a profile match); created_at left to its own DEFAULT now().')

  if (DRY_RUN) {
    console.log('\n--dry-run: NOTHING WRITTEN. Pass --apply to write.')
    return
  }

  console.log('\nAPPLYING...')
  const writeRows = rows.map(({ _report, ...r }) => r)
  const BATCH = 100
  for (let i = 0; i < writeRows.length; i += BATCH) {
    const batch = writeRows.slice(i, i + BATCH)
    const { error } = await withRetry(() => sb.from('refunds').upsert(batch, { onConflict: 'id' }), `refunds upsert batch offset ${i}`)
    if (error) throw new Error(`refunds upsert failed at offset ${i}: ${error.message}`)
  }
  console.log(`  ✓ refunds: ${writeRows.length} row(s) upserted`)
}

main().catch((err) => { console.error('FATAL:', err.message); process.exit(1) })
