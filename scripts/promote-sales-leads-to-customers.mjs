/**
 * promote-sales-leads-to-customers.mjs
 *
 * TASK AJ (2026-08-26). Ruben's decision: ShopVOX sales leads are promoted
 * as native `customers` rows with `is_active = false` — NOT into a native
 * sales_leads CRM table (PrintOS has none, and this project's own
 * SHOPVOX_MIGRATION_NOTES.md structural finding confirms ShopVOX itself
 * treats a sales lead as a genuinely separate resource from Quote, with its
 * own id/workflowState — so it needs its own representation here too, not a
 * folded-in status). A lead that never became a real transaction still
 * represents a real prospect ShopVOX tracked; recording it as an inactive
 * customer preserves that history without it ever showing up as a live,
 * biddable/orderable account.
 *
 * Built on `create-missing-customers-from-shopvox.mjs`'s conventions (same
 * --dry-run/--apply gate, same REFUSED-on-existing-shopvox_id collision
 * check, same splitName()/first_name+last_name NOT NULL handling, same
 * report format) — but the SOURCE data is different in an important way:
 * `create-missing-customers-from-shopvox.mjs` reads a full ShopVOX COMPANY
 * capture (scripts/capture/customer/<uuid>.json — address, tax settings,
 * multiple contacts, etc.). A sales lead capture carries none of that —
 * only the lead's own title/dealValue/workflowState/leadSource plus a THIN
 * company stub ({id, name}) and a single primaryContact. Field-by-field
 * mapping differences from the base script are called out inline below.
 *
 * DEDUP UNIT IS THE COMPANY, NOT THE LEAD: multiple sales leads can (and
 * do — confirmed live, TAMIU has 7) belong to the same company. One
 * `customers` row is created per distinct `customer_shopvox_id`, with every
 * one of that company's leads folded into its `notes` for provenance, and
 * every DISTINCT primaryContact across those leads created as a
 * `customer_contacts` row (leads for the same company frequently share the
 * identical contact — confirmed live, Sames' 4 leads all list the same
 * "Anissa Trevino" — deduped by ShopVOX's own contact id, not re-created
 * per lead).
 *
 * shopvox_id on the created customer row is the COMPANY's real ShopVOX id
 * (`customer_shopvox_id` on the lead row) — NOT the lead's own shopvox_id.
 * This is what the collision check keys on: if that company already has a
 * customers row (from a real transaction, or an earlier customer import),
 * this script REFUSES to create a duplicate, exactly like the base script
 * refuses on an existing shopvox_id.
 *
 * DELIBERATE, ACCEPTED LOSS: salesRepId. Several leads' raw records carry a
 * bare `salesRepId` uuid, but — same gap already documented for
 * shopvox_transactions.production_manager/project_manager in
 * import-api-capture.mjs — no name-resolution path exists anywhere in what's
 * captured, and `customers` has no raw-jsonb column for this script to stash
 * the bare id in either. Ruben's ruling (2026-08-26): accepted as lost, same
 * reasoning as production_manager/project_manager — a bare id with no
 * resolution path is not worth a column. This comment exists so nobody
 * mistakes the gap for an oversight later.
 *
 * Usage:
 *   node scripts/promote-sales-leads-to-customers.mjs [--lead=<shopvox_lead_uuid>[,<uuid>,...]] [--dry-run] [--apply]
 *
 * --dry-run is the default. --apply required to actually write. Unlike the
 * base script, --lead is OPTIONAL — omitting it processes every row
 * currently in shopvox_sales_leads, since that's a small, fully-enumerable
 * staged population, not an open-ended reachable set the way native customer
 * uuids are.
 *
 * APPLY IS ON HOLD (2026-08-26, Ruben): the 23 rows currently staged are
 * only the CAPTURED subset — queue.jsonl lists 1,185 sales_lead entries
 * account-wide. The scrape itself is NOT paused (it runs over the internet
 * against ShopVOX directly and is unaffected by anything else being on
 * hold — was 68% complete, 37,194 done / 17,431 pending / 0 failed, and
 * actively writing as of the last check, continuing overnight regardless).
 * Separately and NOT the same thing: the archive copy of captured files to
 * the company's Q: drive is on hold pending VPN/server access — that has no
 * bearing on capture progress. The 23 already-captured leads fold into just
 * 6 companies, all of which already have a customers row (0 new customers
 * from this subset) — 1,185 is a materially different proposition and the
 * real count of NEW customers this would create is not yet known. Do not
 * --apply until capture completes and that real count is reported.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const ORGANIZATION_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'

const argv = process.argv.slice(2)
function getFlag(name) { const a = argv.find((a) => a.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null }
const APPLY = argv.includes('--apply')
const DRY_RUN = !APPLY
const LEAD_ARG = getFlag('lead')
const LEAD_FILTER = LEAD_ARG ? LEAD_ARG.split(',').map((s) => s.trim()).filter(Boolean) : null

function loadEnv() {
  const env = readFileSync(join(root, '.env.local'), 'utf8')
  return Object.fromEntries(env.split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
}
const vars = loadEnv()
const sb = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY)

function splitName(fullName) {
  if (!fullName || !fullName.trim()) return null
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: null }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

async function fetchAllShopvoxLeads() {
  let all = [], from = 0
  const PAGE = 1000
  while (true) {
    let q = sb.from('shopvox_sales_leads').select('*').eq('organization_id', ORGANIZATION_ID).range(from, from + PAGE - 1)
    if (LEAD_FILTER) q = q.in('shopvox_id', LEAD_FILTER)
    const { data, error } = await q
    if (error) throw new Error('shopvox_sales_leads fetch failed: ' + error.message)
    all = all.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

async function processCompany(customerShopvoxId, leads) {
  const result = { customerShopvoxId, status: null, unmapped: [], fallbacks: [], row: null, contacts: [], leadTitles: leads.map((l) => l.title) }

  const { data: existing, error: existErr } = await sb.from('customers').select('id,company_name').eq('organization_id', ORGANIZATION_ID).eq('shopvox_id', customerShopvoxId)
  if (existErr) { result.status = `ERROR checking existing: ${existErr.message}`; return result }
  if (existing && existing.length > 0) {
    result.status = `REFUSED — shopvox_id already exists as customer "${existing[0].company_name}" (id ${existing[0].id}). Not duplicating.`
    return result
  }

  // Real company name comes from the lead's embedded company stub, NOT the
  // lead's own `title` (title is the PROJECT/opportunity name, e.g.
  // "Magazine" — confirmed live, would silently mislabel the customer row
  // as a project name if used instead of company.name).
  const bodies = leads.map((l) => l.raw?.endpoints?.detail?.body?.salesLead).filter(Boolean)
  const companyName = bodies.find((b) => b.company?.name)?.company?.name || null

  // Pick a primary contact deterministically: the most-recently-updated
  // lead's primaryContact (leads for the same company can have DIFFERENT
  // contacts — confirmed live, TAMIU's 7 leads span 4 distinct people).
  const sortedByUpdated = [...leads].sort((a, b) => new Date(b.updated_at_source || 0) - new Date(a.updated_at_source || 0))
  const primaryBody = sortedByUpdated.map((l) => l.raw?.endpoints?.detail?.body?.salesLead).find((b) => b?.primaryContact?.name)
  const primaryContact = primaryBody?.primaryContact || {}

  let firstName, lastName
  const nameParts = splitName(primaryContact.name)
  if (nameParts && nameParts.last) {
    firstName = nameParts.first
    lastName = nameParts.last
  } else if (nameParts) {
    firstName = nameParts.first
    lastName = companyName || '(no name captured)'
    result.fallbacks.push(`last_name: no surname in ShopVOX contact name "${primaryContact.name}" — used company name "${lastName}" instead of leaving it blank`)
  } else {
    firstName = companyName || '(no name captured)'
    lastName = '(no contact captured)'
    result.fallbacks.push(`first_name/last_name: no primary contact name at all on any of this company's leads — used company name / placeholder`)
  }

  // Provenance note — a stub customer created purely from never-converted
  // leads carries no history anywhere else; without this, is_active=false
  // with no explanation is indistinguishable from any other disabled
  // customer. One line per lead: title, workflow state, deal value, lead
  // source, and the ShopVOX sales-leads URL for a human to open directly.
  const noteLines = leads.map((l) => {
    const dealValueUsd = (l.deal_value / 100).toFixed(2) // deal_value staged as cents, same money() convention as everything else
    return `- "${l.title}" (${l.workflow_state ?? 'unknown state'}, deal value $${dealValueUsd}, source: ${l.lead_source ?? 'unknown'}) — ${l.source_url}`
  })
  const notes = `Created from ${leads.length} ShopVOX sales lead(s) that never became a real transaction (this account has no other customer/quote/job record tying this company in independently of these leads):\n${noteLines.join('\n')}`

  const row = {
    organization_id: ORGANIZATION_ID,
    first_name: firstName,
    last_name: lastName,
    company_name: companyName,
    email: primaryContact.email || null,
    phone: primaryContact.phone || null,
    // notes only, not background_info too (Ruben's ruling, 2026-08-26 —
    // the same text in both columns was clutter; background_info stays free
    // for real background, not synthesized provenance).
    notes,
    // No address, no legal_name, no website, no tax settings, no terms —
    // none of these exist anywhere on a sales lead record (see "unmapped"
    // below). Left null/default, same convention as any other genuinely
    // absent field in this project — never guessed.
    status: 'lead', // literally still a lead, never converted — matches the column's own default and the base script's fallback
    lead_source: bodies.find((b) => b.leadSource?.name)?.leadSource?.name || null,
    // sales_rep: DELIBERATE, ACCEPTED LOSS (Ruben's ruling, 2026-08-26) —
    // see the header comment. salesRepId IS present on several of these
    // leads' raw records, but no name-resolution path exists anywhere in
    // what's captured (same gap as shopvox_transactions.production_manager/
    // project_manager), and customers has no raw-jsonb column to stash the
    // bare id in either. Left null on purpose, not an oversight.
    sales_rep: null,
    is_active: false, // Ruben's explicit rule for this promotion — always false, regardless of the lead's own `active`/workflowState (a lead being "active" in ShopVOX's own pipeline sense is not the same claim as "this is a live, biddable customer")
    taxable: true, // column default — no source on a lead to say otherwise
    shopvox_id: customerShopvoxId, // the COMPANY's real id, not any lead's own id — this is the collision-check key
    shopvox_imported_at: new Date().toISOString(),
  }

  result.unmapped.push('street/street2/city/state/zip/country/suburb/attention_to — no address anywhere on a sales lead record (only present on the full company capture create-missing-customers-from-shopvox.mjs reads)')
  result.unmapped.push('legal_name, website, industry, terms, credit_limit, discount_percent, vat_number, tax_rate, tax_exempt_code, tax_exempt_expires_at, ap_contact, other_info — same reason, none of these exist on a sales lead record')
  result.unmapped.push('sales_rep — salesRepId is present on the raw record but never resolved to a name anywhere in this capture (same gap as shopvox_transactions.production_manager/project_manager); the id itself has no column to land in on `customers` (no raw jsonb here), so it is NOT preserved anywhere by this promotion — DELIBERATE, ACCEPTED LOSS per Ruben\'s ruling (2026-08-26), not an oversight')

  result.row = row
  if (primaryContact.name) {
    result.contacts.push({
      full_name: primaryContact.name,
      first_name: nameParts?.first || null,
      last_name: nameParts?.last || null,
      email: primaryContact.email || null,
      phone: primaryContact.phone || null,
      phone_ext: primaryContact.ext || null,
      title: null, // not present on a lead's primaryContact (unlike a full company capture's contacts array, which sometimes has one)
      is_primary: true,
      is_ap_contact: false,
      is_active: true,
      is_customer_self: false,
      is_staff_contact: false,
      organization_id: ORGANIZATION_ID,
    })
  }
  // Every OTHER distinct contact across this company's other leads, deduped
  // by ShopVOX's own contact id (not by name — two different people could
  // coincidentally share a first name).
  const seenContactIds = new Set(primaryContact.id ? [primaryContact.id] : [])
  for (const b of bodies) {
    const c = b?.primaryContact
    if (!c?.id || seenContactIds.has(c.id)) continue
    seenContactIds.add(c.id)
    const np = splitName(c.name)
    result.contacts.push({
      full_name: c.name || '(no name)',
      first_name: np?.first || null,
      last_name: np?.last || null,
      email: c.email || null,
      phone: c.phone || null,
      phone_ext: c.ext || null,
      title: null,
      is_primary: false,
      is_ap_contact: false,
      is_active: true,
      is_customer_self: false,
      is_staff_contact: false,
      organization_id: ORGANIZATION_ID,
    })
  }

  result.status = 'OK'
  return result
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY (writing)'}`)
  const leads = await fetchAllShopvoxLeads()
  console.log(`Sales leads considered: ${leads.length}${LEAD_FILTER ? ` (filtered to ${LEAD_FILTER.length} requested)` : ' (all currently staged)'}`)

  const byCompany = new Map()
  for (const l of leads) {
    if (!l.customer_shopvox_id) { console.warn(`  WARNING: lead ${l.shopvox_id} ("${l.title}") has no customer_shopvox_id — skipped, cannot attribute to any company`); continue }
    if (!byCompany.has(l.customer_shopvox_id)) byCompany.set(l.customer_shopvox_id, [])
    byCompany.get(l.customer_shopvox_id).push(l)
  }
  console.log(`Distinct companies: ${byCompany.size}`)

  let refused = 0, wouldCreate = 0
  for (const [customerShopvoxId, companyLeads] of byCompany) {
    console.log(`\n=== company ${customerShopvoxId} (${companyLeads.length} lead(s): ${companyLeads.map((l) => `"${l.title}"`).join(', ')}) ===`)
    const result = await processCompany(customerShopvoxId, companyLeads)
    console.log(`  status: ${result.status}`)
    if (result.status !== 'OK') { refused++; continue }
    wouldCreate++

    console.log(`  company_name: ${result.row.company_name}`)
    console.log(`  first_name/last_name: ${result.row.first_name} / ${result.row.last_name}`)
    console.log(`  is_active: ${result.row.is_active}  status: ${result.row.status}`)
    console.log(`  email: ${result.row.email}  phone: ${result.row.phone}`)
    console.log(`  lead_source: ${result.row.lead_source}  sales_rep: ${result.row.sales_rep}`)
    console.log(`  shopvox_id (company): ${result.row.shopvox_id}`)
    console.log(`  contacts (${result.contacts.length}):`, JSON.stringify(result.contacts.map((c) => c.full_name)))
    console.log(`  notes:\n${result.row.notes.split('\n').map((l) => '    ' + l).join('\n')}`)
    if (result.fallbacks.length) { console.log('  fallbacks applied:'); result.fallbacks.forEach((f) => console.log(`    - ${f}`)) }
    if (result.unmapped.length) { console.log('  unmapped fields:'); result.unmapped.forEach((f) => console.log(`    - ${f}`)) }

    if (!DRY_RUN) {
      const { data: inserted, error: insErr } = await sb.from('customers').insert(result.row).select('id').single()
      if (insErr) { console.error(`  FATAL: customer insert failed: ${insErr.message}`); process.exitCode = 1; continue }
      console.log(`  ✓ customer created: ${inserted.id}`)
      if (result.contacts.length) {
        const contactRows = result.contacts.map((c) => ({ ...c, customer_id: inserted.id }))
        const { error: contactErr } = await sb.from('customer_contacts').insert(contactRows)
        if (contactErr) { console.error(`  FATAL: contacts insert failed: ${contactErr.message}`); process.exitCode = 1; continue }
        console.log(`  ✓ ${contactRows.length} contact(s) created`)
      }
    }
  }

  console.log(`\n=== Summary ===`)
  console.log(`  companies considered: ${byCompany.size}`)
  console.log(`  REFUSED (already has a customer): ${refused}`)
  console.log(`  would create (or created, if --apply): ${wouldCreate}`)
  if (DRY_RUN) console.log('\n--dry-run: nothing written. Pass --apply to write.')
}

main().catch((err) => { console.error('FATAL:', err.message); process.exit(1) })
