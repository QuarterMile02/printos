/**
 * link-vendors-from-shopvox.mjs
 *
 * Links the 66 distinct ShopVOX vendors referenced across all 1,159 captured
 * purchase_order JSON files to native `vendors` rows: sets shopvox_id on an
 * exact-name match, creates a new vendors row for a name with no match.
 *
 * Usage:
 *   node scripts/link-vendors-from-shopvox.mjs [--dry-run] [--apply]
 *
 * --dry-run is the default. --apply is required to actually write anything.
 *
 * GENERATED/IDENTITY COLUMNS on `vendors`: NOT checked by this script — same
 * gap as customers/payments.balance, PostgREST's OpenAPI doc does not
 * distinguish a generated/identity column from an ordinary one. Do not
 * --apply until Ruben has run this in the SQL Editor and confirmed clean:
 *
 *   select column_name, is_generated, generation_expression, is_identity, identity_generation
 *   from information_schema.columns
 *   where table_schema = 'public' and table_name = 'vendors';
 *
 * COLLISION HANDLING: any ShopVOX vendor whose normalized name (lowercased,
 * punctuation stripped, {inc,llc,ltd,co,corp} suffix tokens removed) matches
 * MORE THAN ONE native vendor's normalized name is excluded from both the
 * link set and the create set, in --dry-run AND --apply alike, UNLESS it has
 * an explicit entry in MANUAL_COLLISION_OVERRIDES below (a person already
 * picked) — never auto-resolved otherwise.
 *
 * Ruben's ruling (2026-08-25) on the one collision found in this data:
 * ShopVOX "Curtis Steel Company LTD" (37e662eb-ed13-411a-b993-a0c4317fb8ac)
 * links to native 21d3ee95-6310-4984-9b85-dbe09b5c603e ("Curtis Steel
 * Company LTD") — the active row, with a phone number and Net 30 terms. The
 * other candidate (a160f2f9-549b-4fa3-884a-5a03420cf083, "Curtis Steel
 * Company") is already is_active=false, a pre-existing duplicate from the
 * May vendor import unrelated to this migration — explicitly NOT touched.
 *
 * REFUSAL RULE: a target vendor whose shopvox_id is already set to a
 * DIFFERENT id than the one being linked is refused, never overwritten.
 * Already-linked-to-the-same-id is a no-op (idempotent).
 *
 * vendors has UNIQUE (organization_id, name) — a name collision on the
 * 8 new-vendor inserts is allowed to fail loudly (not pre-checked/worked
 * around); none of the 8 currently match an existing name, so this should
 * not fire, but if the vendor set changes later and it does, that's a real
 * problem worth seeing, not silently avoiding.
 *
 * Address/contact/terms fields: ShopVOX's PO capture only ever exposes
 * {id, name, specialNotes} for a vendor (confirmed live — every one of the
 * 1,159 captured POs' `vendor` sub-object has exactly these three keys,
 * nothing else, ever). There is no separate vendor-detail capture. The 8
 * new rows get name + shopvox_id + shopvox_imported_at + specialNotes (if
 * ever non-null, which it isn't for any of these 8 today) — nothing else
 * to carry across exists in the data, not a mapping gap on this script's
 * part.
 */
import { createClient } from '@supabase/supabase-js'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withRetry } from './lib/retry.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const ORGANIZATION_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'
const PO_CAPTURE_DIR = join(root, 'scripts', 'capture', 'purchase_order')

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const DRY_RUN = !APPLY

function loadEnv() {
  const env = readFileSync(join(root, '.env.local'), 'utf8')
  return Object.fromEntries(env.split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
}
const vars = loadEnv()
const sb = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY)

// Ruben's ruling (2026-08-25) on the one normalized-name collision found —
// see header comment for the reasoning. shopvox vendor id -> native vendor id.
const MANUAL_COLLISION_OVERRIDES = {
  '37e662eb-ed13-411a-b993-a0c4317fb8ac': '21d3ee95-6310-4984-9b85-dbe09b5c603e', // "Curtis Steel Company LTD" -> the active, Net-30, phone-carrying row — NOT a160f2f9 (inactive duplicate)
}

const SUFFIXES = new Set(['inc', 'llc', 'ltd', 'co', 'corp'])
function normalize(name) {
  const toks = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).filter((t) => !SUFFIXES.has(t))
  return toks.join(' ')
}

function collectShopvoxVendors() {
  const files = readdirSync(PO_CAPTURE_DIR).filter((f) => f.endsWith('.json'))
  const byId = new Map()
  for (const f of files) {
    let j
    try { j = JSON.parse(readFileSync(join(PO_CAPTURE_DIR, f), 'utf8')) } catch { continue }
    const v = j.endpoints?.detail?.body?.purchaseOrder?.vendor
    if (!v?.id) continue
    if (!byId.has(v.id)) byId.set(v.id, { id: v.id, name: v.name, specialNotes: v.specialNotes ?? null, poCount: 0 })
    byId.get(v.id).poCount++
  }
  return [...byId.values()]
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY (writing)'}`)

  const shopvoxVendors = collectShopvoxVendors()
  console.log(`ShopVOX vendors found in captured POs: ${shopvoxVendors.length}`)

  const { data: nativeVendors, error } = await withRetry(
    () => sb.from('vendors').select('id,name,shopvox_id').eq('organization_id', ORGANIZATION_ID),
    'vendors select'
  )
  if (error) throw new Error(`vendors select failed: ${error.message}`)
  console.log(`Native vendors (org-wide): ${nativeVendors.length}`)

  const nativeByExactLower = new Map()
  for (const v of nativeVendors) {
    const k = v.name.trim().toLowerCase()
    if (!nativeByExactLower.has(k)) nativeByExactLower.set(k, [])
    nativeByExactLower.get(k).push(v)
  }

  // global normalized-name collision groups among native vendors
  const normGroups = new Map()
  for (const v of nativeVendors) {
    const n = normalize(v.name)
    if (!normGroups.has(n)) normGroups.set(n, [])
    normGroups.get(n).push(v)
  }
  const collisionNormKeys = new Set([...normGroups.entries()].filter(([, vs]) => vs.length > 1).map(([k]) => k))

  const toLink = []      // {shopvoxVendor, nativeVendor}
  const toCreate = []    // {shopvoxVendor}
  const refused = []     // {shopvoxVendor, reason}
  const alreadyLinked = [] // {shopvoxVendor, nativeVendor}
  const blockedByCollision = [] // {shopvoxVendor, candidates: [nativeVendor,...]}

  const nativeById = new Map(nativeVendors.map((v) => [v.id, v]))
  const manualOverrideResolutions = [] // {shopvoxVendor, nativeVendor} — reported separately from plain exact matches

  for (const sv of shopvoxVendors) {
    const svNorm = normalize(sv.name)
    if (collisionNormKeys.has(svNorm)) {
      const overrideNativeId = MANUAL_COLLISION_OVERRIDES[sv.id]
      if (overrideNativeId) {
        const nv = nativeById.get(overrideNativeId)
        if (!nv) throw new Error(`MANUAL_COLLISION_OVERRIDES points ${sv.id} at native vendor ${overrideNativeId}, which does not exist — check the override table`)
        if (nv.shopvox_id === sv.id) alreadyLinked.push({ shopvoxVendor: sv, nativeVendor: nv })
        else if (nv.shopvox_id) refused.push({ shopvoxVendor: sv, reason: `manual-override target native vendor "${nv.name}" (${nv.id}) already has a DIFFERENT shopvox_id (${nv.shopvox_id}) — refusing to overwrite` })
        else { toLink.push({ shopvoxVendor: sv, nativeVendor: nv }); manualOverrideResolutions.push({ shopvoxVendor: sv, nativeVendor: nv }) }
        continue
      }
      blockedByCollision.push({ shopvoxVendor: sv, candidates: normGroups.get(svNorm) })
      continue
    }
    const exactKey = sv.name.trim().toLowerCase()
    const matches = nativeByExactLower.get(exactKey) || []
    if (matches.length === 0) {
      toCreate.push({ shopvoxVendor: sv })
    } else {
      const nv = matches[0]
      if (nv.shopvox_id === sv.id) {
        alreadyLinked.push({ shopvoxVendor: sv, nativeVendor: nv })
      } else if (nv.shopvox_id) {
        refused.push({ shopvoxVendor: sv, reason: `native vendor "${nv.name}" (${nv.id}) already has a DIFFERENT shopvox_id (${nv.shopvox_id}) — refusing to overwrite` })
      } else {
        toLink.push({ shopvoxVendor: sv, nativeVendor: nv })
      }
    }
  }

  console.log('\n=== RESOLVED BY MANUAL OVERRIDE (Ruben\'s ruling, not auto-matched) ===')
  if (manualOverrideResolutions.length === 0) console.log('  none')
  for (const m of manualOverrideResolutions) console.log(`  "${m.shopvoxVendor.name}" (${m.shopvoxVendor.id}) -> native ${m.nativeVendor.id} ("${m.nativeVendor.name}")`)

  console.log('\n=== BLOCKED — normalized-name collision, needs a human pick ===')
  if (blockedByCollision.length === 0) console.log('  none')
  for (const b of blockedByCollision) {
    console.log(`  ShopVOX vendor "${b.shopvoxVendor.name}" (${b.shopvoxVendor.id}, ${b.shopvoxVendor.poCount} POs) — candidates:`)
    for (const c of b.candidates) console.log(`    - ${c.name}  id=${c.id}  shopvox_id=${c.shopvox_id ?? 'null'}`)
  }

  console.log('\n=== REFUSED — target already linked to a different shopvox_id ===')
  if (refused.length === 0) console.log('  none')
  for (const r of refused) console.log(`  ${r.shopvoxVendor.name} (${r.shopvoxVendor.id}): ${r.reason}`)

  console.log('\n=== ALREADY LINKED (no-op, idempotent) ===')
  console.log(`  ${alreadyLinked.length} vendor(s)`)

  console.log(`\n=== WOULD LINK (set shopvox_id on existing native vendor) — ${toLink.length} ===`)
  for (const l of toLink) console.log(`  "${l.shopvoxVendor.name}" (${l.shopvoxVendor.id}, ${l.shopvoxVendor.poCount} POs) -> native ${l.nativeVendor.id}`)

  console.log(`\n=== WOULD CREATE (no existing vendor by that name) — ${toCreate.length} ===`)
  for (const c of toCreate) console.log(`  "${c.shopvoxVendor.name}" (${c.shopvoxVendor.id}, ${c.shopvoxVendor.poCount} POs) — specialNotes: ${c.shopvoxVendor.specialNotes ?? 'null'} — no other fields available in captured JSON`)

  const totalAccountedFor = toLink.length + toCreate.length + refused.length + alreadyLinked.length + blockedByCollision.length
  console.log(`\nTotal ShopVOX vendors: ${shopvoxVendors.length}, accounted for: ${totalAccountedFor}${totalAccountedFor !== shopvoxVendors.length ? '  *** MISMATCH ***' : ''}`)

  if (DRY_RUN) {
    console.log('\n--dry-run: nothing written. Pass --apply to write.')
    return
  }

  console.log('\nAPPLYING...')
  for (const l of toLink) {
    const { error } = await withRetry(
      () => sb.from('vendors').update({ shopvox_id: l.shopvoxVendor.id, shopvox_imported_at: new Date().toISOString() }).eq('id', l.nativeVendor.id),
      `link vendor ${l.nativeVendor.id}`
    )
    if (error) throw new Error(`failed to link vendor ${l.nativeVendor.id}: ${error.message}`)
    console.log(`  ✓ linked "${l.shopvoxVendor.name}" -> ${l.nativeVendor.id}`)
  }
  for (const c of toCreate) {
    const row = {
      organization_id: ORGANIZATION_ID,
      name: c.shopvoxVendor.name,
      background_info: c.shopvoxVendor.specialNotes || null,
      is_active: true,
      shopvox_id: c.shopvoxVendor.id,
      shopvox_imported_at: new Date().toISOString(),
    }
    const { data, error } = await withRetry(() => sb.from('vendors').insert(row).select('id').single(), `create vendor "${c.shopvoxVendor.name}"`)
    if (error) throw new Error(`failed to create vendor "${c.shopvoxVendor.name}": ${error.message}`)
    console.log(`  ✓ created "${c.shopvoxVendor.name}" -> ${data.id}`)
  }
  console.log(`\nDone. ${toLink.length} linked, ${toCreate.length} created, ${blockedByCollision.length} blocked (untouched), ${refused.length} refused (untouched), ${alreadyLinked.length} already linked.`)
}

main().catch((err) => { console.error('FATAL:', err.message); process.exit(1) })
