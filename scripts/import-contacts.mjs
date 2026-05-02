/**
 * import-contacts.mjs
 *
 * Imports ShopVOX browser-extracted contacts into PrintOS customer_contacts.
 * Matches contacts to PrintOS customers via company_name (case-insensitive).
 *
 * Usage:
 *   node scripts/import-contacts.mjs
 *
 * Source file: Docs/shopvox_contacts.json
 *
 * Dedup rules:
 *   - WITH email  → skip if lower(email) already exists for that customer_id
 *   - WITHOUT email → skip if full_name already exists for that customer_id
 *
 * Filter rules (applied before any DB work):
 *   - Remove staff/system names (case-insensitive exact match)
 *   - Remove phone-number-shaped names  /^\+?[\d\s().;\-]{7,}$/
 *   - Remove names under 3 characters
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

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
const JSON_FILE = join(root, 'Docs', 'shopvox_contacts.json')
const BATCH_SIZE = 100

// ── Junk filter ───────────────────────────────────────────────────────────────
const JUNK_NAMES = new Set([
  'ruben reyes', 'mary de sylva', 'sandra ruiz', 'ricardo cruz',
  'claudia carreon', 'andrea castillo', 'ofelia ordaz',
  'shopvox system', '(owner)', 'rep',
])
const PHONE_RE = /^\+?[\d\s().;\-]{7,}$/

function isJunk(fullName) {
  if (!fullName) return true
  const name = fullName.trim()
  if (name.length < 3) return true
  if (JUNK_NAMES.has(name.toLowerCase())) return true
  if (PHONE_RE.test(name)) return true
  return false
}

function t(val) {
  if (val == null || val === '') return null
  const s = String(val).trim()
  return s || null
}

// ── Main ──────────────────────────────────────────────────────────────────────
if (!existsSync(JSON_FILE)) {
  console.error(`\n❌  Source file not found: ${JSON_FILE}`)
  console.error('    Drop shopvox_contacts.json into the Docs/ folder and retry.\n')
  process.exit(1)
}

// 1. Resolve org
const { data: org, error: orgErr } = await sb
  .from('organizations').select('id').eq('slug', ORG_SLUG).maybeSingle()
if (orgErr || !org) { console.error('Org not found:', orgErr?.message); process.exit(1) }
const orgId = org.id
console.log(`\n✅  Org resolved: ${orgId}`)

// 2. Load + parse JSON
const rawData = JSON.parse(readFileSync(JSON_FILE, 'utf8'))
// The export wraps the array in a 'contacts' key
const rawContacts = rawData.contacts ?? (Array.isArray(rawData) ? rawData : Object.values(rawData)[0])
console.log(`📄  Total contacts in file: ${rawContacts.length}`)

// 3. Filter junk
let filtered = 0
const clean = []
for (const c of rawContacts) {
  if (isJunk(c.full_name)) { filtered++; continue }
  clean.push(c)
}
console.log(`🧹  Filtered (junk/phone/staff): ${filtered}`)
console.log(`✅  Clean contacts to process: ${clean.length}`)

// 4. Bulk-fetch all PrintOS customers for this org → company_name map
const customerMap = new Map() // lower(company_name) → customer_id
let customerOffset = 0
while (true) {
  const { data, error } = await sb
    .from('customers')
    .select('id, company_name')
    .eq('organization_id', orgId)
    .range(customerOffset, customerOffset + 999)
  if (error) { console.error('Failed to fetch customers:', error.message); process.exit(1) }
  for (const c of data ?? []) {
    if (c.company_name) customerMap.set(c.company_name.toLowerCase(), c.id)
  }
  if (!data || data.length < 1000) break
  customerOffset += 1000
}
console.log(`🗄   Customers in DB: ${customerMap.size}`)

// 5. Bulk-fetch all existing contacts for this org
//    Build lookup sets for O(1) dedup checks
const existingByEmail = new Map()   // "customer_id:lower(email)" → contact_id
const existingByName  = new Map()   // "customer_id:lower(full_name)" → contact_id
let contactOffset = 0
while (true) {
  const { data, error } = await sb
    .from('customer_contacts')
    .select('id, customer_id, email, full_name')
    .eq('organization_id', orgId)
    .range(contactOffset, contactOffset + 999)
  if (error) { console.error('Failed to fetch existing contacts:', error.message); process.exit(1) }
  for (const c of data ?? []) {
    if (c.email) existingByEmail.set(`${c.customer_id}:${c.email.toLowerCase()}`, c.id)
    existingByName.set(`${c.customer_id}:${(c.full_name || '').toLowerCase()}`, c.id)
  }
  if (!data || data.length < 1000) break
  contactOffset += 1000
}
console.log(`🗄   Existing contacts in DB: ${existingByEmail.size + existingByName.size} (unique keys)`)

// 6. Classify each clean contact
const toInsert = []
let skippedDup = 0, skippedNoCustomer = 0

for (const c of clean) {
  const companyName = t(c.company_name)
  const customerId = companyName ? customerMap.get(companyName.toLowerCase()) : null
  if (!customerId) { skippedNoCustomer++; continue }

  const email = t(c.email)?.toLowerCase() || null
  const fullName = t(c.full_name) || 'Unknown'

  // Dedup check
  if (email) {
    const key = `${customerId}:${email}`
    if (existingByEmail.has(key)) { skippedDup++; continue }
    // Mark as seen so later contacts in the same batch don't collide
    existingByEmail.set(key, 'pending')
  } else {
    const key = `${customerId}:${fullName.toLowerCase()}`
    if (existingByName.has(key)) { skippedDup++; continue }
    existingByName.set(key, 'pending')
  }

  toInsert.push({
    customer_id: customerId,
    organization_id: orgId,
    full_name: fullName,
    first_name: t(c.first_name),
    last_name: t(c.last_name),
    email,
    email2: t(c.email2)?.toLowerCase() || null,
    phone: t(c.phone),
    phone2: t(c.phone2),
    phone_ext: t(c.phone_ext),
    is_primary: c.is_primary ?? false,
    is_ap_contact: c.is_ap_contact ?? false,
    is_active: true,
  })
}

console.log(`\n📊  Plan: ${toInsert.length} inserts, ${skippedDup} dup skips, ${skippedNoCustomer} no-customer skips`)

// 7. Batch insert
let inserted = 0, errors = 0

for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
  const batch = toInsert.slice(i, i + BATCH_SIZE)
  const { error } = await sb.from('customer_contacts').insert(batch)
  if (error) {
    console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message)
    // Try row-by-row to identify the bad record
    for (const row of batch) {
      const { error: rowErr } = await sb.from('customer_contacts').insert(row)
      if (rowErr) {
        errors++
        if (errors <= 10) console.error(`    ↳ ${row.full_name} (${row.email ?? 'no email'}): ${rowErr.message}`)
      } else {
        inserted++
      }
    }
  } else {
    inserted += batch.length
    process.stdout.write(`\r  Inserting... ${inserted}/${toInsert.length}`)
  }
}
console.log()

// 8. Summary
console.log('\n══════════════════════════════════════')
console.log('  CONTACT IMPORT COMPLETE')
console.log('══════════════════════════════════════')
console.log(`  Inserted                   : ${inserted}`)
console.log(`  Skipped (duplicate)        : ${skippedDup}`)
console.log(`  Skipped (no customer match): ${skippedNoCustomer}`)
console.log(`  Filtered (junk/phone/staff): ${filtered}`)
console.log(`  Errors                     : ${errors}`)
console.log('══════════════════════════════════════\n')
