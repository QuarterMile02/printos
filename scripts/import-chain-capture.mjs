/**
 * import-chain-capture.mjs
 *
 * Loads scripts/chain-capture/chainA/*.json and chainB/*.json (the deep-dive
 * capture — see scripts/chain-capture/_findings.md) into the shopvox_*
 * staging tables (migrations 183-185, read live from information_schema/
 * PostgREST's OpenAPI description — NOT from supabase/migrations/, which is
 * stale past 123). Writes ONLY to shopvox_* tables and historical_import_runs.
 * Never touches public.quotes/sales_orders/invoices/jobs or any other native
 * PrintOS table. Never scrapes. Never writes/runs a migration.
 *
 * Usage:
 *   node scripts/import-chain-capture.mjs --dry-run   # map everything, print per-table counts + samples, touch nothing
 *   node scripts/import-chain-capture.mjs             # actually upsert
 *
 * Idempotent: every table is upserted on a natural key (documented per
 * table below) so re-running replaces rather than duplicates.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostname } from 'node:os'
import * as P from './lib/shopvox-import-parse.mjs'
import * as B from './lib/shopvox-import-blocks.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const DRY_RUN = process.argv.includes('--dry-run')

const ORGANIZATION_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'
const CAPTURE_DIR = join(root, 'scripts', 'chain-capture')

// ── Env / Supabase client ───────────────────────────────────────────────
function loadEnv() {
  const envPath = join(root, '.env.local')
  if (!existsSync(envPath)) { console.error('FATAL: .env.local not found at', envPath); process.exit(1) }
  const env = readFileSync(envPath, 'utf8')
  return Object.fromEntries(
    env.split('\n').filter((l) => l.includes('=')).map((l) => {
      const idx = l.indexOf('=')
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()]
    })
  )
}
const vars = loadEnv()
if (!vars.NEXT_PUBLIC_SUPABASE_URL) { console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL missing from .env.local'); process.exit(1) }
if (!vars.SUPABASE_SERVICE_ROLE_KEY) { console.error('FATAL: SUPABASE_SERVICE_ROLE_KEY missing from .env.local — refusing to fall back to the anon key (RLS would silently write nothing).'); process.exit(1) }
if (!/^sb_secret_/.test(vars.SUPABASE_SERVICE_ROLE_KEY) && !vars.SUPABASE_SERVICE_ROLE_KEY.startsWith('eyJ')) {
  console.error('FATAL: SUPABASE_SERVICE_ROLE_KEY does not look like a service-role key (expected sb_secret_... or a service_role JWT). Refusing to proceed.')
  process.exit(1)
}
console.log(`Using service-role key: ${vars.SUPABASE_SERVICE_ROLE_KEY.slice(0, 14)}... against ${vars.NEXT_PUBLIC_SUPABASE_URL}`)
const sb = DRY_RUN ? null : createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ── Load source files ────────────────────────────────────────────────────
function loadChain(dirName) {
  const dir = join(CAPTURE_DIR, dirName)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({
    file: `${dirName}/${f}`,
    data: JSON.parse(readFileSync(join(dir, f), 'utf8')),
  }))
}
const records = [...loadChain('chainA'), ...loadChain('chainB')]
console.log(`Loaded ${records.length} source files: ${records.map((r) => r.file).join(', ')}`)

// ── Row accumulators — one array per staging table ──────────────────────
const rows = {
  shopvox_transactions: [], shopvox_line_items: [], shopvox_transaction_charges: [],
  shopvox_jobs: [], shopvox_job_line_items: [], shopvox_proofs: [], shopvox_activities: [],
  shopvox_documents: [], shopvox_job_workflow_steps: [], shopvox_bom_items: [],
  shopvox_notes: [], shopvox_tasks: [], shopvox_record_assets: [], shopvox_shipments: [],
  shopvox_emails: [], shopvox_email_attachments: [],
}
const parseFailures = [] // { file, field, rawValue, note }

function nz(s) { const v = P.nullIfDash(s); return v === '' ? null : v } // "" -> null, "-" -> null, else trimmed
function personName(pairVal) { return pairVal ? P.stripAvatarInitials(pairVal) : null }
function findPair(pairs, label) { const p = (pairs || []).find((p) => p.label === label); return p ? p.value : null }
function findUuidLink(links, re) { const l = (links || []).find((l) => re.test(l.href || '')); return l ? P.extractUuid(l.href) : null }

// ── Transaction mapper (quote / sales_order / invoice) ───────────────────
function mapTransaction(file, d) {
  const pairs = d.expandedHeader?.labelValuePairs || []
  // d.title is "KIND #NNNN: Business Title ‒ shopVOX" — the ONLY reliable
  // source for the record's OWN number. collapsedHeader.buttonTexts was
  // tried first and was WRONG: it lists breadcrumb (parent) pills first
  // (e.g. "QT #13556" on the invoice page), so a naive first-match regex
  // silently grabbed the parent's number instead of the record's own.
  const own = P.parsePrefixedNumber(d.title || '')
  const titleLabel = { quote: 'Quote Title', sales_order: 'Sales Order Title', invoice: 'Invoice Title' }[d.kind]
  const dateLabel = { quote: 'Quote Date', sales_order: 'Sales Order Date', invoice: 'Invoice Date' }[d.kind]

  const customerShopvoxId = findUuidLink(d.collapsedHeader?.links, /^\/customers\/[0-9a-f-]{36}$/i)
  const qtBreadcrumb = (d.breadcrumb || []).find((b) => /^QT #/.test(b.text))
  const soBreadcrumb = (d.breadcrumb || []).find((b) => /^SO #/.test(b.text))

  rows.shopvox_transactions.push({
    shopvox_id: d.recordId,
    kind: d.kind,
    number: own ? own.number : null,
    number_int: own ? P.parseIntSafe(own.number) : null,
    title: findPair(pairs, titleLabel),
    customer_shopvox_id: customerShopvoxId,
    primary_contact_name: personName(findPair(pairs, 'Primary Contact')),
    status: findPair(pairs, 'Status'),
    accounting_status: null, // never observed in a captured labelValuePairs set — see unmapped report
    parent_quote_shopvox_id: qtBreadcrumb ? P.extractUuid(qtBreadcrumb.href) : null,
    parent_sales_order_shopvox_id: soBreadcrumb ? P.extractUuid(soBreadcrumb.href) : null,
    transaction_date: P.parseDateMDY(findPair(pairs, dateLabel)),
    due_date: P.parseDateMDY(findPair(pairs, 'Due Date')),
    sales_rep: personName(findPair(pairs, 'Sales Rep')),
    production_manager: null, // not exposed at transaction level — only on jobs
    project_manager: null,
    subtotal: null, tax_total: null, total: null, payments_total: null, credit_total: null, balance: null, // filled from totals[] below
    is_voided: /void/i.test(findPair(pairs, 'Status') || '') ? true : false,
    source_url: d.url,
    raw: d,
    captured_at: null, // capture script never recorded a per-page timestamp — see unmapped report
    imported_at: new Date().toISOString(),
    organization_id: ORGANIZATION_ID,
  })
  const txRow = rows.shopvox_transactions[rows.shopvox_transactions.length - 1]

  // Totals block: named-fee rows -> shopvox_transaction_charges; summary
  // rows -> back-fill the shopvox_transactions columns just pushed.
  const SUMMARY_LABELS = { 'Subtotal:': 'subtotal', 'Tax:': 'tax_total', 'Total:': 'total', 'Payments:': 'payments_total', 'Credit:': 'credit_total', 'Balance:': 'balance' }
  ;(d.totals || []).forEach((t, idx) => {
    if (SUMMARY_LABELS[t.label]) {
      txRow[SUMMARY_LABELS[t.label]] = P.parseMoney(t.value)
      return
    }
    if (['PO Total:', 'SO - PO Total:', 'Invoiced:'].includes(t.label)) return // no column for these — see unmapped report
    const { amount, taxable, taxAmount } = P.parseChargeValue(t.value)
    rows.shopvox_transaction_charges.push({
      transaction_shopvox_id: d.recordId,
      label: t.label.replace(/:$/, ''),
      amount, taxable, tax_amount: taxAmount, sort_order: idx,
      raw: t,
      imported_at: new Date().toISOString(),
      organization_id: ORGANIZATION_ID,
    })
  })

  // Line items
  ;(d.lineItems || []).forEach((li) => {
    const pd = li.productDetails?.pairs || []
    const pdGet = (label) => nz(findPair(pd, label))
    const { amount: totalArea, uom: areaUom } = P.parseAmountUom(li.totalArea)
    const machines = [...new Set((li.machineNames || []).filter(Boolean))]
    rows.shopvox_line_items.push({
      transaction_shopvox_id: d.recordId,
      position: P.parseIntSafe(li.position),
      product_name: nz(li.productName),
      category: nz(li.category),
      secondary_category: pdGet('Secondary Category'),
      description: nz(li.description),
      quantity: P.parseNumber(li.quantity),
      unit: nz(li.unit),
      unit_discount: P.parseNumber(li.unitDiscount),
      unit_price: P.parseMoney(li.unitPrice),
      total_price: P.parseMoney(li.totalPrice),
      taxable: li.taxableMarker === 'T',
      modifiers: (li.modifiers || []).length ? li.modifiers.join(', ') : null,
      total_area: totalArea,
      area_uom: areaUom,
      price_per_uom: P.parseMoney(li.pricePerSqft),
      machine: machines.length ? machines.join(', ') : null,
      copy_text: nz(li.copyValue),
      internal_notes: nz(li.additionalInfo?.internalNotes),
      design_details: nz(li.additionalInfo?.designDetails),
      production_details: nz(li.additionalInfo?.productionDetails),
      install_details: nz(li.additionalInfo?.installDetails),
      shipping_details: nz(li.additionalInfo?.shippingDetails),
      shipping_tracking: nz(li.additionalInfo?.shippingTracking),
      buying_cost: P.parseMoney(pdGet('Buying Cost ($)')),
      markup: P.parseNumber(pdGet('Markup (X)')),
      list_price: P.parseMoney(pdGet('Price ($)')),
      income_account: pdGet('Income Account'),
      cog_account: pdGet('COG Account'),
      part_number: pdGet('Part Number'),
      default_sale_type: pdGet('Default Sale Type'),
      product_other_info: pdGet('Other Info'),
      po_description: pdGet('PO Description'),
      product_description: pdGet('Product Description'),
      product_image_url: nz(li.productDetails?.imageHref),
      raw: li,
      captured_at: null, // see unmapped report
      imported_at: new Date().toISOString(),
      organization_id: ORGANIZATION_ID,
    })

    if (li.jobHref) {
      const jobUuid = P.extractUuid(li.jobHref)
      if (jobUuid) {
        rows.shopvox_job_line_items.push({
          job_shopvox_id: jobUuid,
          transaction_shopvox_id: d.recordId,
          line_item_position: P.parseIntSafe(li.position),
          transaction_kind: d.kind,
          imported_at: new Date().toISOString(),
          organization_id: ORGANIZATION_ID,
        })
      } else {
        parseFailures.push({ file, field: `lineItems[pos ${li.position}].jobHref`, rawValue: li.jobHref, note: 'no UUID found in jobHref' })
      }
    }
  })

  // PDF -> shopvox_documents
  if (d.pdf && d.pdf.destPath && !d.pdf.error) {
    const docType = { quote: 'quote_pdf', sales_order: 'sales_order_wo_pdf', invoice: 'invoice_pdf' }[d.kind]
    rows.shopvox_documents.push({
      parent_kind: d.kind,
      parent_shopvox_id: d.recordId,
      doc_type: docType,
      filename: basename(d.pdf.destPath),
      source_url: d.pdf.url,
      storage_bucket: null, // explicitly not uploaded to Supabase Storage yet — no bucket chosen
      storage_path: d.pdf.destPath, // LOCAL path, per instructions
      content_type: d.pdf.contentType || null,
      file_size_bytes: d.pdf.sizeBytes ?? null,
      sha256: null, // not computed by the capture script — see unmapped report
      raw: d.pdf,
      captured_at: null,
      imported_at: new Date().toISOString(),
      organization_id: ORGANIZATION_ID,
    })
  }

  // History -> shopvox_activities
  const historyText = d.tabs?.history?.historyFullText || null
  const activities = B.parseActivities(historyText)
  activities.forEach((a) => {
    if (!a.occurredAt) { parseFailures.push({ file, field: 'tabs.history activity', rawValue: JSON.stringify(a), note: 'occurredAt failed to parse' }); return }
    rows.shopvox_activities.push({
      parent_kind: d.kind,
      parent_shopvox_id: d.recordId,
      actor: a.actor,
      action_text: a.actionText,
      field_name: a.fieldName || '', // '' not null — see natural-key note in the report (NULL breaks ON CONFLICT idempotency)
      old_value: a.oldValue,
      new_value: a.newValue,
      occurred_at: a.occurredAt,
      sequence: a.sequence,
      raw: a,
      captured_at: null,
      imported_at: new Date().toISOString(),
      organization_id: ORGANIZATION_ID,
    })
  })

  // tabs.tasks / tabs.assets / tabs.notes / tabs.shipments / tabs.related /
  // tabs.emails: all captured as generic-extractor shells with no
  // structured per-record rows (see _findings.md's grid-parsing gap and
  // this run's unmapped-fields report) — deliberately 0 rows, not silently
  // skipped: flagged explicitly in the report.
}

// ── Job mapper ────────────────────────────────────────────────────────
function mapJob(file, d) {
  const own = P.parsePrefixedNumber(d.headerBadges?.title || '')
  const titleAfterColon = (d.headerBadges?.title || '').replace(/^JB #\d+:\s*/, '') || null
  const customerShopvoxId = findUuidLink(d.genericFallback?.links, /^\/customers\/[0-9a-f-]{36}$/i)

  const YEAR_ASSUMED = 2026 // see parseDateMD_assumeYear doc comment — flagged in the report
  const rr = (label) => findPair(d.rightRail?.pairs, label)
  const details = (label) => { const p = (d.details || []).find((p) => p.label === label); return p ? p.value : null }

  // Description block: strip the "Description" header line and the trailing
  // "Edit Description" button label, keep everything between.
  let description = null
  if (d.description) {
    const lines = d.description.split('\n').map((l) => l.trim()).filter(Boolean)
    const start = lines[0] === 'Description' ? 1 : 0
    const end = lines[lines.length - 1] === 'Edit Description' ? lines.length - 1 : lines.length
    description = lines.slice(start, end).join(' ') || null
  }

  // created/updated-by audit line: the two trailing lines of rightRail's
  // full text, after the last known pair label ("Shipping Method").
  let createdBy = null, createdAt = null, updatedBy = null, updatedAt = null
  if (d.rightRail?.fullText) {
    const tailMatch = d.rightRail.fullText.match(/Shipping Method\n\n([\s\S]*)$/)
    const tail = tailMatch ? tailMatch[1] : ''
    const createdM = tail.match(/([A-Z0-9]{1,5})\n([^\n]+)\ncreated on (\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2} (?:AM|PM))/)
    const updatedM = tail.match(/([A-Z0-9]{1,5})\n([^\n]+)\nupdated on (\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2} (?:AM|PM))/)
    if (createdM) { createdBy = createdM[2]; createdAt = P.parseDateTimeMDY(createdM[3]) }
    if (updatedM) { updatedBy = updatedM[2]; updatedAt = P.parseDateTimeMDY(updatedM[3]) }
  }

  rows.shopvox_jobs.push({
    shopvox_id: d.recordId,
    number: own ? own.number : null,
    number_int: own ? P.parseIntSafe(own.number) : null,
    title: titleAfterColon,
    customer_shopvox_id: customerShopvoxId,
    job_status: details('Job Status'),
    job_color: d.headerBadges?.jobColor?.backgroundColor || null, // only the swatch color was captured, not a color NAME — see unmapped report
    priority: d.headerBadges?.priority ? P.parseIntSafe(d.headerBadges.priority.replace(/^Priority:\s*/, '')) : null,
    qty: d.headerBadges?.qty ? P.parseNumber(d.headerBadges.qty.replace(/^Qty:\s*/, '')) : null,
    qty_completed: d.headerBadges?.qtyCompleted ? P.parseNumber(d.headerBadges.qtyCompleted.replace(/^Qty Completed:\s*/, '')) : null,
    description,
    customer_po: nz(details('Customer PO#')),
    design_details: nz(details('Design Details')),
    production_details: nz(details('Production Details')),
    shipping_details: nz(details('Shipping Details')),
    installation_details: nz(details('Installation Details')),
    special_info: nz(details('Special Info')),
    local_file_path: nz(details('Local File')),
    line_items_price: P.parseMoney(details('Line Items Price')),
    workflow_name: d.workflow?.headingText ? d.workflow.headingText.replace(/^Workflow - /, '') : null,
    due_date: P.parseDateMD_assumeYear(rr('Due Date'), YEAR_ASSUMED),
    due_time: nz(rr('Due Time')),
    production_due_date: P.parseDateMD_assumeYear(rr('Production Due Date'), YEAR_ASSUMED),
    hard_due_date: P.parseDateMD_assumeYear(rr('Hard Due Date'), YEAR_ASSUMED),
    customer_due_date: P.parseDateMD_assumeYear(rr('Customer Due Date'), YEAR_ASSUMED),
    art_due_date: P.parseDateMD_assumeYear(rr('Art Due Date'), YEAR_ASSUMED),
    install_due_date: P.parseDateMD_assumeYear(rr('Install Due Date'), YEAR_ASSUMED),
    shipping_due_date: P.parseDateMD_assumeYear(rr('Shipping Due Date'), YEAR_ASSUMED),
    production_manager: personName(rr('Production Manager')),
    project_manager: personName(rr('Project Manager')),
    sales_rep: personName(rr('Sales Rep')),
    designer: personName(rr('Designer')),
    estimator: personName(rr('Estimator')),
    installer: personName(rr('Installer')),
    billing_address: nz(rr('Billing Address')),
    shipping_address: nz(rr('Shipping Address')),
    install_address: nz(rr('Install Address')),
    shipping_method: nz(rr('Shipping Method')),
    created_by_source: createdBy,
    created_at_source: createdAt,
    updated_by_source: updatedBy,
    updated_at_source: updatedAt,
    source_url: d.url,
    raw: d,
    captured_at: null,
    imported_at: new Date().toISOString(),
    import_run_id: null, // filled in by caller after the run row exists
    organization_id: ORGANIZATION_ID,
  })

  // Proofs
  B.parseProofs(d.proofsBlock).forEach((p) => {
    if (!p.filename) { parseFailures.push({ file, field: 'proofsBlock', rawValue: d.proofsBlock?.text?.slice(0, 200), note: 'could not extract a filename from proofsBlock.html' }); return }
    rows.shopvox_proofs.push({
      shopvox_id: null, // never exposed — proofs have no route/uuid of their own in this UI
      job_shopvox_id: d.recordId,
      filename: p.filename,
      version: p.version,
      uploaded_at: p.uploadedAt,
      approval_status: p.approvalStatus,
      approved_by: null, // see unmapped report — derivable from the proof's own activity log text but not parsed here
      approved_at: null,
      view_count: p.viewCount,
      comment_count: p.commentCount,
      thumbnail_url: p.thumbnailUrl,
      download_url: p.downloadUrl,
      content_type: p.contentType,
      file_size_bytes: null, // not captured systematically — see unmapped report
      storage_path: null, // hosted on ShopVOX's CDN, not downloaded by us
      raw: { proofsBlock: d.proofsBlock, proofMenuOptions: d.proofMenuOptions, parsed: p },
      captured_at: null,
      imported_at: new Date().toISOString(),
      organization_id: ORGANIZATION_ID,
    })
  })

  // Workflow steps
  B.parseWorkflowSteps(d.workflow).forEach((s) => {
    rows.shopvox_job_workflow_steps.push({
      job_id: null,
      job_shopvox_id: d.recordId,
      stage: s.stage || '', // '' not null — same ON CONFLICT idempotency reasoning as shopvox_activities.field_name
      step_name: s.stepName,
      position: s.position,
      status: null, // no state/color info was captured per-step (only assignee/badge counts) — see unmapped report
      assignee_count: s.assigneeCount,
      assignees: null, // names not captured, only the count
      recorded_time_minutes: null, // "Record Time Spent" is a manual action never exercised — see _findings.md §1
      started_at: null, // NOT exposed on the step itself — see _findings.md §1; reconstructable from shopvox_activities State transitions instead
      completed_at: null,
      raw: { ...s, stageAttributionConfident: s.stageAttributionConfident },
      captured_at: null,
      imported_at: new Date().toISOString(),
      organization_id: ORGANIZATION_ID,
    })
  })

  // BOM
  B.parseBomGridRows(d.bom).forEach((r) => {
    rows.shopvox_bom_items.push({
      job_id: null,
      job_shopvox_id: d.recordId,
      position: r.position,
      material_name: r.materialName,
      quantity: r.quantity,
      uom: r.uom,
      unit_cost: r.estCost,
      total_cost: r.actCost, // "Act Cost" mapped to total_cost (Act Qty x Act rate) — Est Cost mapped to unit_cost; see unmapped report re: Difference/Attr1/Attr2/TXN:LI/Type not having columns
      notes: null,
      raw: r,
      imported_at: new Date().toISOString(),
      organization_id: ORGANIZATION_ID,
    })
  })

  // History -> shopvox_activities (same shape as transactions)
  const activities = B.parseActivities(d.history?.text || null)
  activities.forEach((a) => {
    if (!a.occurredAt) { parseFailures.push({ file, field: 'history activity', rawValue: JSON.stringify(a), note: 'occurredAt failed to parse' }); return }
    rows.shopvox_activities.push({
      parent_kind: 'job',
      parent_shopvox_id: d.recordId,
      actor: a.actor,
      action_text: a.actionText,
      field_name: a.fieldName || '',
      old_value: a.oldValue,
      new_value: a.newValue,
      occurred_at: a.occurredAt,
      sequence: a.sequence,
      raw: a,
      captured_at: null,
      imported_at: new Date().toISOString(),
      organization_id: ORGANIZATION_ID,
    })
  })

  // Assets / Notes: both captured as a bare "(0)" empty-shell count on every
  // job in this pilot — 0 rows, not a capture gap (genuinely empty).
}

// ── Run mappers ───────────────────────────────────────────────────────
for (const { file, data } of records) {
  if (data.kind) mapTransaction(file, data)
  else if (data.headerBadges) mapJob(file, data)
  else console.warn(`WARNING: ${file} matches neither transaction nor job shape — skipped`)
}

// ── Report / dry-run output ──────────────────────────────────────────
function printSummary() {
  console.log('\n=== Row counts per table ===')
  for (const [table, arr] of Object.entries(rows)) {
    console.log(`  ${table}: ${arr.length}`)
  }
  console.log('\n=== Sample row per non-empty table ===')
  for (const [table, arr] of Object.entries(rows)) {
    if (!arr.length) continue
    const sample = { ...arr[0] }
    if (sample.raw) sample.raw = '<raw jsonb omitted from preview — ' + JSON.stringify(sample.raw).length + ' chars>'
    console.log(`\n--- ${table} ---`)
    console.log(JSON.stringify(sample, null, 2))
  }
  if (parseFailures.length) {
    console.log('\n=== Parse failures ===')
    parseFailures.forEach((f) => console.log(` [${f.file}] ${f.field}: ${f.note} — raw: ${JSON.stringify(f.rawValue).slice(0, 200)}`))
  } else {
    console.log('\nNo parse failures.')
  }
}

if (process.env.DEBUG_FULL_TABLE && rows[process.env.DEBUG_FULL_TABLE]) {
  console.log(JSON.stringify(rows[process.env.DEBUG_FULL_TABLE], null, 2))
}

if (DRY_RUN) {
  console.log('\n--dry-run: mapping complete, NOT touching the database.')
  printSummary()
  process.exit(0)
}

// ── Live run: historical_import_runs + upserts ───────────────────────
const NATURAL_KEYS = {
  shopvox_transactions: 'shopvox_id',
  shopvox_line_items: 'transaction_shopvox_id,position',
  shopvox_jobs: 'shopvox_id',
  shopvox_job_line_items: 'job_shopvox_id,transaction_shopvox_id,line_item_position',
  shopvox_proofs: 'job_shopvox_id,filename,version',
  shopvox_activities: 'parent_shopvox_id,occurred_at,sequence,field_name',
  shopvox_documents: 'parent_shopvox_id,doc_type,filename',
  shopvox_job_workflow_steps: 'job_shopvox_id,stage,step_name',
  shopvox_notes: null, shopvox_tasks: null, shopvox_record_assets: null, shopvox_shipments: null, // no rows produced this run
  shopvox_emails: 'parent_shopvox_id,subject,sent_at', // inferred — unused this run (0 rows; see report)
  shopvox_email_attachments: null,
}
// shopvox_transaction_charges and shopvox_bom_items were given NO natural
// key by the task brief, and — CONFIRMED LIVE against the real database on
// this run's first attempt — there is genuinely no unique constraint on
// either table to upsert against ("no unique or exclusion constraint
// matching the ON CONFLICT specification"). Idempotent re-running is
// achieved instead by deleting every existing row for the parent(s) being
// re-imported, then inserting fresh — same net effect as an upsert, no
// migration required. See the unmapped-fields report.
const DELETE_THEN_INSERT = {
  shopvox_transaction_charges: { parentCol: 'transaction_shopvox_id' },
  shopvox_bom_items: { parentCol: 'job_shopvox_id' },
}

async function upsertTable(table, arr) {
  if (!arr.length) return { table, inserted: 0, error: null }
  const BATCH = 100
  if (DELETE_THEN_INSERT[table]) {
    const { parentCol } = DELETE_THEN_INSERT[table]
    const parentIds = [...new Set(arr.map((r) => r[parentCol]).filter(Boolean))]
    const { error: delErr } = await sb.from(table).delete().in(parentCol, parentIds)
    if (delErr) return { table, inserted: 0, error: `delete-phase: ${delErr.message}` }
    let total = 0
    for (let i = 0; i < arr.length; i += BATCH) {
      const batch = arr.slice(i, i + BATCH)
      const { error } = await sb.from(table).insert(batch)
      if (error) return { table, inserted: total, error: error.message }
      total += batch.length
    }
    return { table, inserted: total, error: null }
  }
  const onConflict = NATURAL_KEYS[table]
  if (!onConflict) return { table, inserted: 0, error: 'no natural key defined and rows were produced — refusing to insert non-idempotently' }
  let total = 0
  for (let i = 0; i < arr.length; i += BATCH) {
    const batch = arr.slice(i, i + BATCH)
    const { error } = await sb.from(table).upsert(batch, { onConflict })
    if (error) return { table, inserted: total, error: error.message }
    total += batch.length
  }
  return { table, inserted: total, error: null }
}

async function main() {
  const startedAt = new Date().toISOString()
  const { data: runRow, error: runErr } = await sb.from('historical_import_runs').insert({
    entity: 'chain_capture_pilot',
    scope: 'chainA+chainB',
    machine: hostname(),
    status: 'running',
    started_at: startedAt,
    records_seen: records.length,
    records_captured: 0,
    records_failed: 0,
  }).select().single()
  if (runErr) { console.error('FATAL: could not open historical_import_runs row:', runErr.message); process.exit(1) }
  console.log(`Opened historical_import_runs id=${runRow.id}`)

  // Back-fill import_run_id on transactions/jobs now that we have the run id.
  rows.shopvox_transactions.forEach((r) => { r.import_run_id = runRow.id })
  rows.shopvox_jobs.forEach((r) => { r.import_run_id = runRow.id })

  const results = []
  let recordsCaptured = 0, recordsFailed = 0
  async function run(table) {
    const res = await upsertTable(table, rows[table])
    results.push(res)
    if (res.error) { recordsFailed += rows[table].length; console.error(`  ✗ ${table}: ${res.error}`) }
    else { recordsCaptured += res.inserted; console.log(`  ✓ ${table}: ${res.inserted} row(s) upserted`) }
    return res
  }

  // Parents first (shopvox_line_items.transaction_id and
  // shopvox_transaction_charges.transaction_id are NOT NULL FKs to
  // shopvox_transactions.id — CONFIRMED LIVE the hard way on this run's
  // first attempt — so the transactions row must exist and its internal id
  // must be known before any child row can be written).
  await run('shopvox_transactions')
  const { data: txIdRows, error: txIdErr } = await sb.from('shopvox_transactions').select('id, shopvox_id').eq('organization_id', ORGANIZATION_ID)
  if (txIdErr) { console.error('FATAL: could not look up shopvox_transactions internal ids for FK backfill:', txIdErr.message); process.exit(1) }
  const txIdByShopvoxId = new Map(txIdRows.map((r) => [r.shopvox_id, r.id]))
  rows.shopvox_line_items.forEach((r) => { r.transaction_id = txIdByShopvoxId.get(r.transaction_shopvox_id) ?? null })
  rows.shopvox_transaction_charges.forEach((r) => { r.transaction_id = txIdByShopvoxId.get(r.transaction_shopvox_id) ?? null })

  await run('shopvox_jobs')
  const { data: jobIdRows, error: jobIdErr } = await sb.from('shopvox_jobs').select('id, shopvox_id').eq('organization_id', ORGANIZATION_ID)
  if (jobIdErr) { console.error('FATAL: could not look up shopvox_jobs internal ids for FK backfill:', jobIdErr.message); process.exit(1) }
  const jobIdByShopvoxId = new Map(jobIdRows.map((r) => [r.shopvox_id, r.id]))
  rows.shopvox_proofs.forEach((r) => { r.job_id = jobIdByShopvoxId.get(r.job_shopvox_id) ?? null })
  rows.shopvox_job_workflow_steps.forEach((r) => { r.job_id = jobIdByShopvoxId.get(r.job_shopvox_id) ?? null })
  rows.shopvox_bom_items.forEach((r) => { r.job_id = jobIdByShopvoxId.get(r.job_shopvox_id) ?? null })

  for (const table of ['shopvox_line_items', 'shopvox_transaction_charges', 'shopvox_job_line_items', 'shopvox_proofs', 'shopvox_activities', 'shopvox_documents', 'shopvox_job_workflow_steps', 'shopvox_bom_items', 'shopvox_notes', 'shopvox_tasks', 'shopvox_record_assets', 'shopvox_shipments', 'shopvox_emails', 'shopvox_email_attachments']) {
    await run(table)
  }

  const finishedAt = new Date().toISOString()
  const anyError = results.some((r) => r.error)
  await sb.from('historical_import_runs').update({
    status: anyError ? 'failed' : 'succeeded',
    finished_at: finishedAt,
    records_seen: records.length,
    records_captured: recordsCaptured,
    records_failed: recordsFailed,
    notes: JSON.stringify(results.map((r) => ({ table: r.table, inserted: r.inserted, error: r.error }))),
    error: anyError ? results.filter((r) => r.error).map((r) => `${r.table}: ${r.error}`).join('; ') : null,
  }).eq('id', runRow.id)

  console.log(`\nClosed historical_import_runs id=${runRow.id} (status: ${anyError ? 'failed' : 'succeeded'})`)
  printSummary()
  console.log(`\nhistorical_import_runs id: ${runRow.id}`)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
