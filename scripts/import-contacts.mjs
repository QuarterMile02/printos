/**
 * import-contacts.mjs
 *
 * Imports ShopVOX browser-extracted contacts into PrintOS customer_contacts.
 * Matches contacts to PrintOS customers via company_name (case-insensitive).
 *
 * Usage:
 *   node scripts/import-contacts.mjs           -- dry-run (shows plan, no writes)
 *   node scripts/import-contacts.mjs --yes     -- execute inserts + updates
 *
 * Source file: Docs/shopvox_contacts.json
 *
 * Dedup rules:
 *   - WITH email  → match on lower(email) + customer_id → UPDATE if found, INSERT if new
 *   - WITHOUT email → match on lower(full_name) + customer_id → UPDATE if found, INSERT if new
 *
 * Filter rules (applied before any DB work):
 *   - Remove staff/system names (case-insensitive exact match)
 *   - Remove phone-number-shaped names  /^\+?[\d\s().;\-]{7,}$/
 *   - Remove names under 3 characters
 *   - Strip trailing parentheticals from names: "Felipe (Mechanic)" → "Felipe"
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

const DRY_RUN   = !process.argv.includes('--yes')
const ORG_SLUG  = 'quarter-mile-inc'
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

// Strip trailing parentheticals: "Felipe Valadez (Mechanic)" → "Felipe Valadez"
function stripSuffix(name) {
  return (name ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim()
}

// ── Main ──────────────────────────────────────────────────────────────────────
if (!existsSync(JSON_FILE)) {
  console.error(`\n❌  Source file not found: ${JSON_FILE}`)
  console.error('    Drop shopvox_contacts.json into the Docs/ folder and retry.\n')
  process.exit(1)
}

if (DRY_RUN) {
  console.log('\n⚠️   DRY RUN — no database writes. Pass --yes to execute.\n')
}

// 1. Resolve org
const { data: org, error: orgErr } = await sb
  .from('organizations').select('id').eq('slug', ORG_SLUG).maybeSingle()
if (orgErr || !org) { console.error('Org not found:', orgErr?.message); process.exit(1) }
const orgId = org.id
console.log(`✅  Org resolved: ${orgId}`)

// 2. Load + parse JSON
const rawData = JSON.parse(readFileSync(JSON_FILE, 'utf8'))
const rawContacts = rawData.contacts ?? (Array.isArray(rawData) ? rawData : Object.values(rawData)[0])
console.log(`📄  Total contacts in file: ${rawContacts.length}`)

// 3. Filter junk (uses raw full_name before suffix stripping — suffix alone isn't junk)
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

// 6. Classify each clean contact → toInsert or toUpdate
const toInsert = []
const toUpdate = []   // { id, fields }
let skippedNoCustomer = 0

for (const c of clean) {
  const companyName = t(c.company_name)
  const customerId  = companyName ? customerMap.get(companyName.toLowerCase()) : null
  if (!customerId) { skippedNoCustomer++; continue }

  const email = t(c.email)?.toLowerCase() || null

  // FIX 2: strip parenthetical suffix BEFORE splitting first/last
  const fullNameRaw = t(c.full_name) || 'Unknown'
  const fullName    = stripSuffix(fullNameRaw) || fullNameRaw
  const nameParts   = fullName.split(/\s+/)
  const firstName   = nameParts[0] || ''
  const lastName    = nameParts.slice(1).join(' ') || ''

  // FIX 1: accept both 'is_ap' (new extractor) and 'is_ap_contact' (old shape)
  const isAp        = c.is_ap ?? c.is_ap_contact ?? false
  const isPrimary   = c.is_primary ?? false

  const fields = {
    email,
    email2:        t(c.email2)?.toLowerCase() || null,
    phone:         t(c.phone),
    phone2:        t(c.phone2),
    phone_ext:     t(c.phone_ext),
    is_primary:    isPrimary,
    is_ap_contact: isAp,
    first_name:    firstName || null,
    last_name:     lastName || null,
  }

  // FIX 3: dedup → UPDATE existing instead of skip
  // 'pending' means already queued in this run — skip entirely (prevents intra-JSON dupes)
  let existingId = null
  if (email) {
    const key = `${customerId}:${email}`
    const val = existingByEmail.get(key)
    if (val === 'pending') continue          // duplicate within JSON file — skip
    if (val) { existingId = val }            // real DB id → update
    else { existingByEmail.set(key, 'pending') }
  }
  if (!existingId) {
    const key = `${customerId}:${fullName.toLowerCase()}`
    const val = existingByName.get(key)
    if (val === 'pending') continue          // duplicate within JSON file — skip
    if (val) { existingId = val }            // real DB id → update
    else { existingByName.set(key, 'pending') }
  }

  if (existingId) {
    toUpdate.push({ id: existingId, fields })
  } else {
    toInsert.push({
      customer_id:    customerId,
      organization_id: orgId,
      full_name:      fullName,
      ...fields,
      is_active:      true,
    })
  }
}

// ── Pre-flight ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════')
console.log('  PRE-FLIGHT PLAN')
console.log('══════════════════════════════════════')
console.log(`  New inserts              : ${toInsert.length}`)
console.log(`  Updates (refresh data)   : ${toUpdate.length}`)
console.log(`  Skipped (no customer)    : ${skippedNoCustomer}`)
console.log(`  Filtered (junk)          : ${filtered}`)
console.log('══════════════════════════════════════')

if (DRY_RUN) {
  console.log('\n  Pass --yes to execute the above.\n')
  process.exit(0)
}

console.log('\n  Executing…\n')

// 7. Batch insert new contacts
let inserted = 0, updated = 0, errors = 0

for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
  const batch = toInsert.slice(i, i + BATCH_SIZE)
  const { error } = await sb.from('customer_contacts').insert(batch)
  if (error) {
    console.error(`  Insert batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message)
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
if (toInsert.length) console.log()

// 8. Batch update existing contacts
for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
  const batch = toUpdate.slice(i, i + BATCH_SIZE)
  for (const { id, fields } of batch) {
    const { error } = await sb
      .from('customer_contacts')
      .update(fields)
      .eq('id', id)
    if (error) {
      errors++
      if (errors <= 10) console.error(`  Update error (id=${id}):`, error.message)
    } else {
      updated++
    }
  }
  process.stdout.write(`\r  Updating...  ${updated}/${toUpdate.length}`)
}
if (toUpdate.length) console.log()

// 9. Summary
console.log('\n══════════════════════════════════════')
console.log('  CONTACT IMPORT COMPLETE')
console.log('══════════════════════════════════════')
console.log(`  Inserted                   : ${inserted}`)
console.log(`  Updated                    : ${updated}`)
console.log(`  Skipped (no customer match): ${skippedNoCustomer}`)
console.log(`  Filtered (junk/phone/staff): ${filtered}`)
console.log(`  Errors                     : ${errors}`)
console.log('══════════════════════════════════════\n')
