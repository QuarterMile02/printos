/**
 * import-customers.mjs
 *
 * Imports ShopVOX customer export into PrintOS customers table.
 * Also upserts each row's primary contact into customer_contacts.
 *
 * Usage:
 *   node scripts/import-customers.mjs
 *
 * Source file: Docs/Customer export_04302026_143415_4-30-26.xls
 * Dedup key:   (organization_id, company_name)
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import XLSX from 'xlsx'

// ── Env ──────────────────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const env = readFileSync(join(root, '.env.local'), 'utf8')
const vars = Object.fromEntries(
  env.split('\n').filter(l => l.includes('=')).map(l => {
    const idx = l.indexOf('=')
    return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()]
  })
)
const sb = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY)

const ORG_SLUG = 'quarter-mile-inc'
const XLS_FILE = join(root, 'Docs', 'Customer export_04302026_143415_4-30-26.xls')
const BATCH_SIZE = 100

// ── Helpers ───────────────────────────────────────────────────────────────────
function stripHtml(val) {
  if (!val || typeof val !== 'string') return null
  const stripped = val.replace(/<[^>]+>/g, '').trim()
  return stripped || null
}

function t(val) {
  if (val == null) return null
  const s = String(val).trim()
  return s || null
}

function parseBool(val, defaultVal = null) {
  if (val == null) return defaultVal
  const s = String(val).trim().toLowerCase()
  if (s === 'yes' || s === 'true' || s === '1') return true
  if (s === 'no' || s === 'false' || s === '0') return false
  return defaultVal
}

function parseNumber(val) {
  if (val == null) return null
  if (typeof val === 'number') return val
  const s = String(val).replace(/[$,%]/g, '').trim()
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function serialToDate(serial) {
  if (!serial || typeof serial !== 'number') return null
  try {
    const d = XLSX.SSF.parse_date_code(serial)
    if (!d || !d.y) return null
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  } catch {
    return null
  }
}

function normaliseStatus(val) {
  if (!val) return 'lead'
  const s = String(val).trim().toLowerCase()
  const map = { lead: 'lead', sold: 'sold', closable: 'closable', prospect: 'prospect' }
  return map[s] ?? 'lead'
}

// ── Main ──────────────────────────────────────────────────────────────────────
if (!existsSync(XLS_FILE)) {
  console.error(`\n❌  Source file not found: ${XLS_FILE}`)
  console.error('    Drop the ShopVOX customer export into the Docs/ folder and retry.\n')
  process.exit(1)
}

// 1. Resolve org
const { data: org, error: orgErr } = await sb
  .from('organizations').select('id').eq('slug', ORG_SLUG).maybeSingle()
if (orgErr || !org) { console.error('Org not found:', orgErr?.message); process.exit(1) }
const orgId = org.id
console.log(`\n✅  Org resolved: ${orgId}`)

// 2. Read XLS
const wb = XLSX.read(readFileSync(XLS_FILE), { type: 'buffer' })
const ws = wb.Sheets[wb.SheetNames[0]]
const rawRows = XLSX.utils.sheet_to_json(ws, { defval: null })
console.log(`📄  Rows in file: ${rawRows.length}`)

// 3. Bulk-fetch existing customers for this org (name → id map)
let existingMap = new Map() // lower(company_name) → { id, first_name, last_name }
let offset = 0
while (true) {
  const { data, error } = await sb
    .from('customers')
    .select('id, company_name, first_name, last_name')
    .eq('organization_id', orgId)
    .range(offset, offset + 999)
  if (error) { console.error('Failed to fetch existing customers:', error.message); process.exit(1) }
  for (const c of data ?? []) {
    if (c.company_name) existingMap.set(c.company_name.toLowerCase(), c)
  }
  if (!data || data.length < 1000) break
  offset += 1000
}
console.log(`🗄   Existing customers in DB: ${existingMap.size}`)

// 4. Build customer rows and contact rows
const toInsert = []
const toUpdate = []   // { id, payload }

for (const raw of rawRows) {
  const companyName = t(raw['Company Name'])
  if (!companyName) continue

  const firstName = t(raw['Contact First Name']) || companyName.split(' ')[0] || 'Unknown'
  const lastName = t(raw['Contact Last Name']) ||
    (companyName.split(' ').length > 1 ? companyName.split(' ').slice(1).join(' ') : companyName)

  const payload = {
    organization_id: orgId,
    company_name: companyName,
    first_name: firstName,
    last_name: lastName,
    legal_name: t(raw['Legal Name']),
    notes: t(raw['Primary Contact']),   // store primary contact full name temporarily
    email: t(raw['Primary Contact Email']),
    phone: t(raw['Primary Contact Phone']),
    street: t(raw['Street']),
    street2: t(raw['Street 1']),
    city: t(raw['City']),
    state: t(raw['State']),
    zip: t(raw['ZIP']) ? String(raw['ZIP']).trim() : null,
    secondary_street: t(raw['Secondary Street']),
    secondary_city: t(raw['Secondary City']),
    secondary_state: t(raw['Secondary State']),
    secondary_zip: t(raw['Secondary ZIP']) ? String(raw['Secondary ZIP']).trim() : null,
    status: normaliseStatus(raw['Status']),
    is_active: parseBool(raw['Enabled'], true),
    taxable: parseBool(raw['Taxable'], true),
    tax_exempt_code: t(raw['Tax Exempt Code']),
    tax_exempt_expires: serialToDate(raw['Tax Exempt Expiration Date']),
    terms: t(raw['Terms']),
    credit_limit: parseNumber(raw['Credit Limit']),
    industry: t(raw['Industry']),
    lead_source: t(raw['Lead Source']),
    sales_rep: t(raw['Sales Reps']),
    discount_percent: parseNumber(raw['Discount']),
    pricing_level: t(raw['Pricing Level']),
    website: t(raw['Website']),
    background_info: stripHtml(raw['Background Info']),
    special_notes: stripHtml(raw['Special Notes']),
    shopvox_imported_at: new Date().toISOString(),
  }

  const existing = existingMap.get(companyName.toLowerCase())
  if (existing) {
    toUpdate.push({ id: existing.id, payload })
  } else {
    toInsert.push(payload)
  }
}

console.log(`\n📊  Plan: ${toInsert.length} inserts, ${toUpdate.length} updates`)

// 5. Batch insert new customers
let inserted = 0, updated = 0, errors = 0
const insertedIdMap = new Map() // lower(company_name) → id (for contact linking)

for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
  const batch = toInsert.slice(i, i + BATCH_SIZE)
  const { data, error } = await sb.from('customers').insert(batch).select('id, company_name')
  if (error) {
    console.error(`  Insert batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message)
    errors += batch.length
  } else {
    inserted += batch.length
    for (const c of data ?? []) {
      if (c.company_name) insertedIdMap.set(c.company_name.toLowerCase(), c.id)
    }
    process.stdout.write(`\r  Inserting... ${inserted}/${toInsert.length}`)
  }
}
if (toInsert.length > 0) console.log()

// 6. Sequential updates (can't batch UPDATE with different payloads)
for (const { id, payload } of toUpdate) {
  const { organization_id: _org, ...updateFields } = payload
  const { error } = await sb.from('customers').update(updateFields).eq('id', id).eq('organization_id', orgId)
  if (error) {
    console.error(`  Update ${id} error:`, error.message)
    errors++
  } else {
    updated++
    if (updated % 200 === 0) process.stdout.write(`\r  Updating... ${updated}/${toUpdate.length}`)
  }
}
if (toUpdate.length > 0) console.log()

// 7. Merge inserted + updated id maps for contact linking
const allCustomerIdMap = new Map(existingMap)
for (const [name, id] of insertedIdMap) allCustomerIdMap.set(name, { id })
// Rebuild with updated ids too
for (const { id, payload } of toUpdate) {
  allCustomerIdMap.set(payload.company_name.toLowerCase(), { id })
}

// 8. Upsert primary contacts
let contactsInserted = 0, contactsSkipped = 0, contactErrors = 0
const now = new Date().toISOString()

for (const raw of rawRows) {
  const companyName = t(raw['Company Name'])
  if (!companyName) continue
  const email = t(raw['Primary Contact Email'])
  const phone = t(raw['Primary Contact Phone'])
  const firstName = t(raw['Contact First Name'])
  const lastName = t(raw['Contact Last Name'])
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || t(raw['Primary Contact']) || null

  // Skip if no meaningful contact data
  if (!fullName && !email && !phone) continue

  const customerEntry = allCustomerIdMap.get(companyName.toLowerCase())
  if (!customerEntry) continue
  const customerId = customerEntry.id || customerEntry

  if (email) {
    // Upsert by email — check if exists first (partial expression index)
    const { data: existing } = await sb
      .from('customer_contacts')
      .select('id')
      .eq('customer_id', customerId)
      .ilike('email', email)
      .maybeSingle()

    if (existing) {
      await sb.from('customer_contacts').update({
        full_name: fullName || email,
        first_name: firstName,
        last_name: lastName,
        phone,
        is_primary: true,
        updated_at: now,
      }).eq('id', existing.id)
      contactsSkipped++
    } else {
      const { error } = await sb.from('customer_contacts').insert({
        customer_id: customerId,
        organization_id: orgId,
        full_name: fullName || email,
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        is_primary: true,
        is_active: true,
      })
      if (error) { contactErrors++; } else { contactsInserted++ }
    }
  } else {
    // No email — only insert if no existing primary contact
    const { data: existingPrimary } = await sb
      .from('customer_contacts')
      .select('id')
      .eq('customer_id', customerId)
      .eq('is_primary', true)
      .maybeSingle()
    if (existingPrimary) { contactsSkipped++; continue }

    const { error } = await sb.from('customer_contacts').insert({
      customer_id: customerId,
      organization_id: orgId,
      full_name: fullName || 'Unknown',
      first_name: firstName,
      last_name: lastName,
      phone,
      is_primary: true,
      is_active: true,
    })
    if (error) { contactErrors++; } else { contactsInserted++ }
  }
}

// 9. Summary
console.log('\n══════════════════════════════════════')
console.log('  CUSTOMER IMPORT COMPLETE')
console.log('══════════════════════════════════════')
console.log(`  Customers inserted : ${inserted}`)
console.log(`  Customers updated  : ${updated}`)
console.log(`  Errors             : ${errors}`)
console.log(`  Contacts inserted  : ${contactsInserted}`)
console.log(`  Contacts updated   : ${contactsSkipped}`)
console.log(`  Contact errors     : ${contactErrors}`)
console.log('══════════════════════════════════════\n')
