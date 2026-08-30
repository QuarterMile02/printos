/**
 * promote-purchase-orders.mjs
 *
 * Promotes ShopVOX purchase_order staging data into native `purchase_orders`
 * / `purchase_order_items`. Deliberately separate from
 * promote-shopvox-to-native.mjs: POs are ORG-scoped in ShopVOX (no customer
 * link at all — confirmed live, customer_shopvox_id is null on every staged
 * PO row), not customer-scoped, so they don't fit that script's --customer
 * model. This script processes every staged PO in the org in one run.
 *
 * Usage:
 *   node scripts/promote-purchase-orders.mjs [--dry-run] [--apply]
 *
 * --dry-run is the default. --apply is required to actually write anything.
 *
 * READS STAGING, NOT RAW JSON. `shopvox_transactions` (kind='purchase_order')
 * and the shared `shopvox_line_items` table (PO line items land there too,
 * scoped by transaction_shopvox_id = the PO's shopvox_id — confirmed live,
 * same table quote/sales_order/invoice line items use). IMPORT BACKLOG: as
 * of this writing only 457/1,159 captured POs are in staging (import lags
 * capture — see scripts/SHOPVOX_MIGRATION_NOTES.md) — this run will only
 * see those 457 until scripts/import-api-capture.mjs catches up. Re-running
 * this script after the importer catches up picks up the rest for free
 * (idempotent, upsert-on-id).
 *
 * VENDOR RESOLUTION depends on scripts/link-vendors-from-shopvox.mjs having
 * been --apply'd first. Until then every row's vendor_id resolves to null —
 * reported prominently below, not a bug in this script.
 *
 * MONEY IS DOLLARS on purchase_orders/purchase_order_items — the OPPOSITE
 * convention from every other historical table this project has built
 * (quotes/sales_orders/invoices/bom_items are integer cents). subtotal,
 * tax_total, total, unit_cost, total_cost are all written EXACTLY as
 * captured (ShopVOX's own *InDollars fields), unscaled and unrounded — no
 * ×100, no round(). assertSaneDollarAmount() below throws if anything
 * exceeds a hardcoded ceiling well above the highest real value seen in the
 * captured data ($47,693) — a defense against a copy-pasted ×100 from
 * promote-shopvox-to-native.mjs silently producing a hundredfold-wrong
 * value across 1,159 POs / 3,264 line items.
 *
 * purchase_order_items.shopvox_id is the line item's OWN real ShopVOX id
 * (shopvox_line_items.raw.lineItem.id — NOT shopvox_line_items.id itself,
 * which is a staging-side gen_random_uuid(), same distinction the main
 * promoter's header comment already makes for quote/SO/invoice line items).
 * Confirmed live: all 3,264 captured PO line items have one, 0 missing, 0
 * duplicates — the deterministic-sha256-from-(po_shopvox_id,position)
 * fallback below is defensive only, never expected to fire on this data.
 *
 * material_id stays NULL on every row — historical line items don't FK into
 * the live materials catalog, same rule as product_id on the other
 * historical line-item tables.
 *
 * sales_order_id stays NULL — confirmed live, nothing in any captured PO's
 * JSON populates a link to a sales order (no salesOrderId/workOrderId field
 * anywhere in the purchaseOrder body, checked across all 1,159).
 *
 * is_historical is written FALSE on every row (rule 1) — sealing is a
 * separate later step, and per the seal-order finding recorded in the notes
 * file, must not happen out of order relative to refunds on the payments
 * side (unrelated to this script directly, noted for whoever builds seal).
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAllRows } from './lib/supabase-paginate.mjs'
import { withRetry } from './lib/retry.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const ORGANIZATION_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'
const MONEY_CEILING = 500000 // well above the highest captured value ($47,693) — catches a stray x100

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const DRY_RUN = !APPLY

function loadEnv() {
  const env = readFileSync(join(root, '.env.local'), 'utf8')
  return Object.fromEntries(env.split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
}
const vars = loadEnv()
const sb = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY)

function deterministicUuid(seed) {
  const hash = createHash('sha256').update(seed).digest('hex')
  return [hash.slice(0, 8), hash.slice(8, 12), '5' + hash.slice(13, 16), ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20), hash.slice(20, 32)].join('-')
}

function isFracCents(dollars) { // true if dollars has real sub-cent precision — tolerance avoids float noise (e.g. 2227.2*100 !== 222720 exactly in IEEE754, a false positive a naive check would flag)
  if (dollars === null || dollars === undefined) return false
  const c = dollars * 100
  return Math.abs(Math.round(c) - c) > 1e-6
}

function assertSaneDollarAmount(value, label) {
  if (value === null || value === undefined) return
  if (Math.abs(value) > MONEY_CEILING) {
    throw new Error(`REFUSING TO WRITE: ${label} = ${value} exceeds the sane-dollar ceiling of ${MONEY_CEILING} — this looks like a scaling bug (e.g. an accidental x100), not a real value. Highest real value seen in captured data was $47,693.`)
  }
}

async function resolveIdMap(table, shopvoxIds, { scopeByOrg = true } = {}) {
  // purchase_order_items has no organization_id column at all (confirmed
  // live — it's scoped only via po_id -> purchase_orders.organization_id),
  // so its resolution query must skip the org filter entirely rather than
  // fail with "column does not exist".
  const map = new Map()
  let existing = 0
  const CHUNK = 150
  for (let i = 0; i < shopvoxIds.length; i += CHUNK) {
    const chunk = shopvoxIds.slice(i, i + CHUNK)
    const { data, error } = await withRetry(
      () => {
        let q = sb.from(table).select('id,shopvox_id')
        if (scopeByOrg) q = q.eq('organization_id', ORGANIZATION_ID)
        return q.in('shopvox_id', chunk)
      },
      `${table} id resolution (offset ${i})`
    )
    if (error) throw new Error(`${table} id resolution failed: ${error.message}`)
    for (const row of data) map.set(row.shopvox_id, row)
  }
  for (const id of shopvoxIds) {
    if (map.has(id)) existing++
    else map.set(id, { id: randomUUID(), shopvox_id: id, _new: true })
  }
  return { map, existing, fresh: shopvoxIds.length - existing }
}

async function fetchByIn(table, col, ids, select) {
  const out = []
  const CHUNK = 150
  for (let i = 0; i < ids.length; i += CHUNK) {
    out.push(...(await fetchAllRows(sb, table, (q) => q.select(select).in(col, ids.slice(i, i + CHUNK)).eq('organization_id', ORGANIZATION_ID))))
  }
  return out
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY (writing)'}`)

  const pos = await fetchAllRows(sb, 'shopvox_transactions', (q) =>
    q.select('shopvox_id,number,number_int,title,status,transaction_date,due_date,customer_shopvox_id,raw,captured_at')
      .eq('organization_id', ORGANIZATION_ID).eq('kind', 'purchase_order'))
  console.log(`Staged purchase_orders: ${pos.length} (of 1,159 captured — see import-backlog note in the header if this is less than 1,159)`)

  const withCustomer = pos.filter((p) => p.customer_shopvox_id)
  if (withCustomer.length) console.log(`  *** UNEXPECTED: ${withCustomer.length} staged POs have a non-null customer_shopvox_id — was assumed always null, re-check before proceeding ***`)

  const poIds = pos.map((p) => p.shopvox_id)
  const lineItems = await fetchByIn('shopvox_line_items', 'transaction_shopvox_id', poIds,
    'id,transaction_shopvox_id,position,product_name,description,quantity,unit,unit_price,total_price,raw')
  console.log(`Staged PO line items (shopvox_line_items): ${lineItems.length}`)

  const { data: vendors, error: vendorErr } = await withRetry(
    () => sb.from('vendors').select('id,shopvox_id').eq('organization_id', ORGANIZATION_ID).not('shopvox_id', 'is', null),
    'vendors (linked only) select'
  )
  if (vendorErr) throw new Error(`vendors select failed: ${vendorErr.message}`)
  const vendorByShopvoxId = new Map(vendors.map((v) => [v.shopvox_id, v.id]))
  console.log(`Vendors linked to a shopvox_id: ${vendors.length}${vendors.length === 0 ? '  <-- link-vendors-from-shopvox.mjs has not been --apply\'d yet; every vendor_id below will resolve to null' : ''}`)

  const poIdMap = await resolveIdMap('purchase_orders', poIds)
  const lineItemShopvoxIds = lineItems.map((li) => li.raw?.lineItem?.id).filter(Boolean)
  const liIdMap = await resolveIdMap('purchase_order_items', lineItemShopvoxIds, { scopeByOrg: false })

  const distinctStatus = new Set()
  let subtotalFrac = 0, taxFrac = 0, totalFrac = 0
  let vendorResolved = 0, vendorUnresolved = 0
  const unresolvedVendorNames = new Map() // name -> count
  const poRows = []
  for (const t of pos) {
    const idRow = poIdMap.map.get(t.shopvox_id)
    distinctStatus.add(t.status)
    const raw = t.raw?.endpoints?.detail?.body?.purchaseOrder || {}
    const prices = t.raw?.endpoints?.prices?.body?.prices || {}
    const vendor = raw.vendor || {}
    const vendorId = vendor.id ? vendorByShopvoxId.get(vendor.id) || null : null
    if (vendorId) vendorResolved++
    else { vendorUnresolved++; if (vendor.name) unresolvedVendorNames.set(vendor.name, (unresolvedVendorNames.get(vendor.name) || 0) + 1) }

    const subtotal = prices.totalPriceInDollars ?? null
    const taxTotal = prices.totalTaxInDollars ?? null
    const total = prices.totalPriceWithTaxInDollars ?? null
    assertSaneDollarAmount(subtotal, `purchase_orders.subtotal (${t.shopvox_id})`)
    assertSaneDollarAmount(taxTotal, `purchase_orders.tax_total (${t.shopvox_id})`)
    assertSaneDollarAmount(total, `purchase_orders.total (${t.shopvox_id})`)
    if (isFracCents(subtotal)) subtotalFrac++
    if (isFracCents(taxTotal)) taxFrac++
    if (isFracCents(total)) totalFrac++

    poRows.push({
      id: idRow.id,
      organization_id: ORGANIZATION_ID,
      po_number: t.number_int ?? (t.number ? parseInt(t.number, 10) : null),
      vendor_id: vendorId,
      vendor_name: vendor.name || null,
      sales_order_id: null,
      status: t.status,
      title: raw.title && raw.title.trim() ? raw.title.trim() : null,
      notes: raw.specialNotes || null,
      subtotal, tax_total: taxTotal, total,
      expected_delivery_date: raw.expectedDeliveryDate || null,
      received_date: raw.actualDeliveryDate || null,
      created_by: null,
      created_at: raw.createdAt || t.transaction_date || null,
      updated_at: raw.updatedAt || raw.createdAt || null,
      shopvox_id: t.shopvox_id,
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
    })
  }

  let unitCostFrac = 0, totalCostFrac = 0, syntheticFallbackCount = 0
  const itemRows = []
  let liUnresolvedParent = 0
  for (const li of lineItems) {
    const parentRow = poIdMap.map.get(li.transaction_shopvox_id)
    if (!parentRow) { liUnresolvedParent++; continue }
    const rawLi = li.raw?.lineItem || {}
    const realShopvoxId = rawLi.id
    let shopvoxId, usedSynthetic = false
    if (realShopvoxId) {
      shopvoxId = realShopvoxId
    } else {
      shopvoxId = deterministicUuid(`po_item:${li.transaction_shopvox_id}:${li.position}`)
      usedSynthetic = true
      syntheticFallbackCount++
    }
    const idRow = liIdMap.map.get(shopvoxId) || { id: randomUUID() }

    const unitCost = li.unit_price ?? null
    const totalCost = li.total_price ?? null
    assertSaneDollarAmount(unitCost, `purchase_order_items.unit_cost (${shopvoxId})`)
    assertSaneDollarAmount(totalCost, `purchase_order_items.total_cost (${shopvoxId})`)
    if (isFracCents(unitCost)) unitCostFrac++
    if (isFracCents(totalCost)) totalCostFrac++

    itemRows.push({
      id: idRow.id,
      po_id: parentRow.id,
      description: (li.description && li.description.trim()) || (li.product_name && li.product_name.trim()) || null,
      quantity: li.quantity,
      unit_cost: unitCost,
      total_cost: totalCost,
      received_qty: rawLi.quantityReceived ?? 0,
      sort_order: li.position ?? 0,
      material_id: null,
      unit: li.unit || null,
      shopvox_id: shopvoxId,
      shopvox_imported_at: new Date().toISOString(),
      is_historical: false,
      _usedSynthetic: usedSynthetic,
    })
  }

  console.log('\n=== ROWS THIS RUN WOULD WRITE ===')
  console.log(`  purchase_orders: ${poRows.length} total (${poIdMap.fresh} new insert, ${poIdMap.existing} would update existing)`)
  console.log(`  purchase_order_items: ${itemRows.length} total (${liIdMap.fresh} new insert, ${liIdMap.existing} would update existing)`)
  if (liUnresolvedParent) console.log(`  SKIPPED: ${liUnresolvedParent} line items whose parent PO wasn't in this run's staged set`)

  console.log('\n=== DISTINCT STATUS VALUES (mapped verbatim) ===')
  console.log(' ', JSON.stringify([...distinctStatus]))

  console.log('\n=== VENDOR RESOLUTION ===')
  console.log(`  resolved: ${vendorResolved} / ${poRows.length}`)
  console.log(`  unresolved: ${vendorUnresolved} / ${poRows.length}`)
  if (unresolvedVendorNames.size) {
    console.log('  unresolved vendor names (name: PO count):')
    for (const [name, count] of [...unresolvedVendorNames.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${name}: ${count}`)
  }
  console.log('  vendor_name is written on every row regardless of vendor_id resolution.')

  console.log('\n=== MONEY (dollars, unscaled/unrounded — sub-cent counts, not errors) ===')
  console.log(`  purchase_orders.subtotal sub-cent: ${subtotalFrac}/${poRows.length}`)
  console.log(`  purchase_orders.tax_total sub-cent: ${taxFrac}/${poRows.length}`)
  console.log(`  purchase_orders.total sub-cent: ${totalFrac}/${poRows.length}`)
  console.log(`  purchase_order_items.unit_cost sub-cent: ${unitCostFrac}/${itemRows.length}`)
  console.log(`  purchase_order_items.total_cost sub-cent: ${totalCostFrac}/${itemRows.length}`)
  console.log(`  money ceiling assertion: no value exceeded $${MONEY_CEILING} (would have thrown)`)

  console.log('\n=== LINE ITEM shopvox_id SOURCE ===')
  console.log(`  from the line item's own real ShopVOX id (raw.lineItem.id): ${itemRows.filter((r) => !r._usedSynthetic).length}`)
  console.log(`  synthetic sha256 fallback (no real id present): ${syntheticFallbackCount}`)

  console.log('\n=== UNMAPPED / NOT ATTEMPTED ===')
  console.log('  purchase_orders.created_by: ShopVOX createdBy is a staff name/id with no profile-matching rule — left null')
  console.log('  purchase_orders.sales_order_id: confirmed no source field in captured JSON — left null on every row')
  console.log('  purchase_order_items.material_id: left null on every row by design (no FK into live materials catalog for historical rows)')

  if (DRY_RUN) {
    console.log('\n--dry-run: NOTHING WRITTEN. Pass --apply to write.')
    return
  }

  console.log('\nAPPLYING...')
  const writes = [['purchase_orders', poRows], ['purchase_order_items', itemRows.map(({ _usedSynthetic, ...r }) => r)]]
  for (const [table, rows] of writes) {
    if (rows.length === 0) continue
    const BATCH = 100
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const { error } = await withRetry(() => sb.from(table).upsert(batch, { onConflict: 'id' }), `${table} upsert batch offset ${i}`)
      if (error) throw new Error(`${table} upsert failed at offset ${i}: ${error.message}`)
    }
    console.log(`  ✓ ${table}: ${rows.length} row(s) upserted`)
  }
}

main().catch((err) => { console.error('FATAL:', err.message); process.exit(1) })
