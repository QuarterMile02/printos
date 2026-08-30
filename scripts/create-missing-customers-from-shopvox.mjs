/**
 * create-missing-customers-from-shopvox.mjs
 *
 * Creates a native PrintOS `customers` row (+ `customer_contacts`) from a
 * captured ShopVOX customer record (scripts/capture/customer/<uuid>.json).
 * Reusable — this is the general tool for the ~93 ShopVOX customers with no
 * native PrintOS record at all, not a one-off for Indiana Transport LLC.
 *
 * Usage:
 *   node scripts/create-missing-customers-from-shopvox.mjs --customer=<shopvox_uuid>[,<uuid>,...] [--dry-run] [--apply]
 *
 * --dry-run is the default. --apply required to actually write.
 *
 * GENERATED/IDENTITY COLUMNS: NOT independently checked here — this script
 * has no more SQL access than the promoter does (PostgREST's OpenAPI doc,
 * which does not distinguish a generated column from an ordinary one — the
 * exact gap that caused the payments.balance failure). Ruben asked for an
 * information_schema.columns check on `customers` before this writes to it;
 * that has NOT been done as of this script's first version. Do not --apply
 * until that check comes back clean. --dry-run is unaffected (no writes).
 *
 * shopvox_id is the customer's own real ShopVOX company id — no synthetic
 * key needed, this table already has a proven natural key (4,558 existing
 * customers already linked this way).
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const ORGANIZATION_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'
const CAPTURE_DIR = join(root, 'scripts', 'capture', 'customer')

const argv = process.argv.slice(2)
function getFlag(name) { const a = argv.find((a) => a.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null }
const APPLY = argv.includes('--apply')
const DRY_RUN = !APPLY
const CUSTOMER_ARG = getFlag('customer')
if (!CUSTOMER_ARG) { console.error('FATAL: --customer=<shopvox_uuid>[,<uuid>,...] is required'); process.exit(1) }
const SHOPVOX_IDS = CUSTOMER_ARG.split(',').map((s) => s.trim()).filter(Boolean)

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

async function processOne(shopvoxId) {
  const result = { shopvoxId, status: null, unmapped: [], fallbacks: [], row: null, contacts: [] }

  const { data: existing, error: existErr } = await sb.from('customers').select('id,company_name').eq('organization_id', ORGANIZATION_ID).eq('shopvox_id', shopvoxId)
  if (existErr) { result.status = `ERROR checking existing: ${existErr.message}`; return result }
  if (existing && existing.length > 0) {
    result.status = `REFUSED — shopvox_id already exists as customer "${existing[0].company_name}" (id ${existing[0].id}). Not duplicating.`
    return result
  }

  const filePath = join(CAPTURE_DIR, `${shopvoxId}.json`)
  if (!existsSync(filePath)) { result.status = `REFUSED — no captured customer JSON at ${filePath}`; return result }
  const file = JSON.parse(readFileSync(filePath, 'utf8'))
  const company = file.endpoints?.detail?.body?.company
  if (!company) { result.status = 'REFUSED — capture file has no endpoints.detail.body.company'; return result }
  const contactsBody = file.endpoints?.contacts?.body?.contacts || []

  const addr = company.address || {}
  const primaryContact = company.primaryContact || {}

  // first_name/last_name are NOT NULL with no default — company customers
  // get the primary contact's name split across them (matches the existing
  // pattern on all 4,558 already-linked customers, e.g. Sames' own record
  // carries its contact "Anissa"/"Trevino"). Fallback when there's no
  // contact name at all, or the name has no surname to split off:
  let firstName, lastName
  const nameParts = splitName(primaryContact.name)
  if (nameParts && nameParts.last) {
    firstName = nameParts.first
    lastName = nameParts.last
  } else if (nameParts) {
    // single-word contact name (e.g. "Arturo") — no real surname to use.
    // Documented fallback: last_name becomes the company name, not a blank
    // string, so it's traceable rather than silently empty.
    firstName = nameParts.first
    lastName = company.name || '(no name captured)'
    result.fallbacks.push(`last_name: no surname in ShopVOX contact name "${primaryContact.name}" — used company name "${lastName}" instead of leaving it blank`)
  } else {
    // no contact name at all
    firstName = company.name || '(no name captured)'
    lastName = '(no contact captured)'
    result.fallbacks.push(`first_name/last_name: no primary contact name at all — used company name / placeholder`)
  }

  const email = company.primaryEmail || primaryContact.email || null
  const phone = company.primaryPhone || primaryContact.phone || null

  const row = {
    organization_id: ORGANIZATION_ID,
    first_name: firstName,
    last_name: lastName,
    company_name: company.name || null,
    email,
    phone,
    notes: company.specialNotes || null,
    street: addr.street || null,
    street2: addr.street1 || null, // unconfirmed direction — street1 was null on every sample seen so far, flagged below
    city: addr.city || null,
    state: addr.state || null,
    zip: addr.zip || null,
    country: addr.countryCode || 'US',
    suburb: addr.suburb || null,
    attention_to: addr.attentionTo || null,
    status: company.status || 'lead', // verbatim, matches the column's own default
    industry: company.category?.name || null,
    lead_source: company.leadSource?.name || null,
    sales_rep: company.salesReps?.[0]?.name || null,
    legal_name: company.legalName || null,
    website: company.website || null,
    is_active: company.active ?? true, // Ruben's rule: closed customers disabled, not deleted
    taxable: company.taxable ?? true,
    tax_exempt_code: company.taxExemptCode || null,
    tax_exempt_expires: company.taxExemptExpirationDate || null,
    terms: company.termCode?.name || null,
    credit_limit: company.creditLimitInDollars ?? 0, // NOT scaled — column is numeric (not integer-cents) and the source field is already named "InDollars"; flagged below as worth a live cross-check against a customer with a nonzero limit
    discount_percent: company.discount ?? 0,
    background_info: company.backgroundInfo || null,
    special_notes: company.specialNotes || null,
    other_info: company.otherInfo || null,
    vat_number: company.vatNumber || null,
    tax_rate: company.tax?.name || null,
    ap_contact: company.apContact?.name || null,
    shopvox_id: shopvoxId,
    shopvox_imported_at: new Date().toISOString(),
  }

  if (addr.street1) result.fallbacks.push(`street2 mapped from address.street1, which was populated (usually null) — direction not independently confirmed against a real value yet`)
  result.unmapped.push('vatNumber, licenceNumber, salesTaxCode, twitter, facebook, accountNumber, legacyCustomerId, legacyType, csrId, divisionIds, shippingMethodId, tollFreeNumber, enableCustomerPortal, enableWebStore, cportalWhiteLabelUrl, shopSlug, locale, currency, showCustomerFacingProductCategories, ccPaymentsEnabled, achPaymentsEnabled — no destination column or not attempted this pass')
  result.unmapped.push('secondary_* address fields (secondary_street/city/state/zip/etc.) — ShopVOX company record has only one address; no source for a second one')

  result.row = row
  result.contacts = contactsBody.map((c) => ({
    full_name: c.name || '(no name)',
    first_name: splitName(c.name)?.first || null,
    last_name: splitName(c.name)?.last || null,
    email: c.email || null,
    phone: c.phone || null,
    phone_ext: c.ext || null,
    title: c.title || null,
    is_primary: c.isPrimaryContact ?? false,
    is_ap_contact: c.isAccountPayable ?? false,
    is_active: c.active ?? true,
    is_customer_self: false,
    is_staff_contact: false,
    organization_id: ORGANIZATION_ID,
  }))
  result.status = 'OK'
  return result
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY (writing)'}`)
  console.log(`Customers requested: ${SHOPVOX_IDS.length}`)

  for (const shopvoxId of SHOPVOX_IDS) {
    console.log(`\n=== ${shopvoxId} ===`)
    const result = await processOne(shopvoxId)
    console.log(`  status: ${result.status}`)
    if (result.status !== 'OK') continue

    console.log(`  company_name: ${result.row.company_name}`)
    console.log(`  first_name/last_name: ${result.row.first_name} / ${result.row.last_name}`)
    console.log(`  is_active: ${result.row.is_active}  status: ${result.row.status}`)
    console.log(`  email: ${result.row.email}  phone: ${result.row.phone}`)
    console.log(`  address: ${result.row.street}, ${result.row.city}, ${result.row.state} ${result.row.zip}`)
    console.log(`  terms: ${result.row.terms}  industry: ${result.row.industry}  lead_source: ${result.row.lead_source}`)
    console.log(`  contacts (${result.contacts.length}):`, JSON.stringify(result.contacts.map((c) => c.full_name)))
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

  if (DRY_RUN) console.log('\n--dry-run: nothing written. Pass --apply to write.')
}

main().catch((err) => { console.error('FATAL:', err.message); process.exit(1) })
