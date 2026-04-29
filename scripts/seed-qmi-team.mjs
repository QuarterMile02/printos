// Seed the 17 remaining QMI team members. Idempotent — re-runs safely.
//
// Usage:  node scripts/seed-qmi-team.mjs
//         node scripts/seed-qmi-team.mjs --dry-run    (no writes, no invites)
//         node scripts/seed-qmi-team.mjs --no-invite  (writes profiles + memberships, skips email)
//
// For each user the script:
//   1. Looks up the existing auth.users row by email. If absent, calls
//      auth.admin.inviteUserByEmail() which creates the user AND sends
//      the invite email (Supabase handles the email via its own SMTP).
//   2. Upserts public.profiles using the auth user id as the primary key.
//   3. Upserts public.organization_members linking the user to QMI.
//
// Ruben (UUID f86f2712-ebcd-4faa-bccb-0f0580bcfeae) is intentionally not in
// the USERS list — he was seeded by migration 011 and gets skipped.
//
// At the end the script counts profiles for the org and prints a summary.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

// ── Load .env.local manually (matches existing seed scripts) ────────────
const envText = readFileSync(resolve(repoRoot, '.env.local'), 'utf8')
const env = {}
for (const rawLine of envText.split(/\r?\n/)) {
  const line = rawLine.trim()
  if (!line || line.startsWith('#')) continue
  const eq = line.indexOf('=')
  if (eq === -1) continue
  const key = line.slice(0, eq).trim()
  let val = line.slice(eq + 1).trim()
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1)
  }
  env[key] = val
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const DRY_RUN = process.argv.includes('--dry-run')
const NO_INVITE = process.argv.includes('--no-invite')
const ORG_SLUG = 'quarter-mile-inc'

const ALL_DEPARTMENTS = [
  'large_format', 'commercial_print', 'vehicle_wrap', 'channel_letters',
  'fabrication', 'installation', 'service_repair', 'digital_marketing', 'digital_screens',
]

// Each entry: full_name, email, profile role, tier, dept codes.
// "all" expands to ALL_DEPARTMENTS at insert time.
const USERS = [
  { name: 'Ricardo Cruz',             email: 'ric@quartermileinc.com',           role: 'sales',      tier: 'manager', departments: 'all' },
  { name: 'Mary De Sylva',            email: 'mary@quartermileinc.com',          role: 'sales',      tier: 'manager', departments: 'all' },
  { name: 'Ashley Mata',              email: 'digital2@quartermileinc.com',      role: 'digital',    tier: 'lead',    departments: ['digital_marketing', 'digital_screens'] },
  { name: 'Claudia Carreon',          email: 'claudia@quartermileinc.com',       role: 'designer',   tier: 'lead',    departments: ['large_format', 'vehicle_wrap'] },
  { name: 'Jonathan Reyes',           email: 'sales2@quartermileinc.com',        role: 'sales',      tier: 'staff',   departments: ['large_format', 'vehicle_wrap'] },
  { name: 'Sandra Ruiz',              email: 'sandra@quartermileinc.com',        role: 'accounting', tier: 'staff',   departments: [] },
  { name: 'David Curiel',             email: 'design5@quartermileinc.com',       role: 'designer',   tier: 'staff',   departments: ['large_format', 'vehicle_wrap'] },
  { name: 'Julio Saldana',            email: 'design3@quartermileinc.com',       role: 'designer',   tier: 'staff',   departments: ['large_format'] },
  { name: 'Karla Hernandez Gonzalez', email: 'design@quartermileinc.com',        role: 'designer',   tier: 'staff',   departments: ['large_format', 'vehicle_wrap'] },
  { name: 'Albert Chavez Jr.',        email: 'install1@quartermileinc.com',      role: 'installer',  tier: 'staff',   departments: ['installation'] },
  { name: 'Matthew J. Lopez',         email: 'matthew@quartermileinc.com',       role: 'installer',  tier: 'staff',   departments: ['installation', 'fabrication'] },
  { name: 'Mariana Delarbre',         email: 'mariana@quartermileinc.com',       role: 'production', tier: 'staff',   departments: ['large_format'] },
  { name: 'Raul Lopez',               email: 'raul@quartermileinc.com',          role: 'production', tier: 'staff',   departments: ['large_format'] },
  { name: 'George Hernandez',         email: 'productioncomm@quartermileinc.com',role: 'production', tier: 'staff',   departments: ['commercial_print'] },
  { name: 'Large Format 1',           email: 'productionlf@quartermileinc.com',  role: 'production', tier: 'staff',   departments: ['large_format'] },
  { name: 'Beto Hernandez',           email: 'productionlf2@quartermileinc.com', role: 'production', tier: 'staff',   departments: ['large_format'] },
  { name: 'Kimberly De La Rosa',      email: 'rep@quartermileinc.com',           role: 'sales',      tier: 'staff',   departments: ['large_format', 'vehicle_wrap', 'commercial_print'] },
]

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function expandDepartments(d) {
  if (d === 'all') return [...ALL_DEPARTMENTS]
  return Array.isArray(d) ? [...d] : []
}

// Page through auth.users to build email → id map. Default page size is
// 50; QMI's user count is small so one or two pages cover everyone.
async function buildEmailToAuthIdMap() {
  const map = new Map()
  let page = 1
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    for (const u of data.users) {
      if (u.email) map.set(u.email.toLowerCase(), u.id)
    }
    if (data.users.length < 1000) break
    page++
  }
  return map
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : NO_INVITE ? 'NO-INVITE (writes only)' : 'FULL (writes + invite emails)'}`)

  // Resolve org id by slug.
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', ORG_SLUG)
    .maybeSingle()
  if (orgErr || !org) {
    console.error(`Could not find organization with slug='${ORG_SLUG}':`, orgErr?.message ?? '(no match)')
    process.exit(1)
  }
  const orgId = org.id
  console.log(`Org: ${org.name} (${orgId})`)

  // Pre-build email → existing auth id map so we know who needs an invite.
  const existingByEmail = await buildEmailToAuthIdMap()
  console.log(`auth.users currently has ${existingByEmail.size} entries`)

  const summary = { invited: 0, alreadyHadAuth: 0, profilesUpserted: 0, membershipsUpserted: 0, errors: [] }

  for (const u of USERS) {
    const email = u.email.toLowerCase()
    const departments = expandDepartments(u.departments)
    let userId = existingByEmail.get(email) ?? null

    try {
      // Step 1: ensure auth user exists (invite if not).
      if (!userId) {
        if (DRY_RUN) {
          console.log(`[dry] would invite ${email} (${u.name})`)
        } else if (NO_INVITE) {
          console.log(`[no-invite] skipping ${email} — auth user missing and --no-invite was passed`)
          continue
        } else {
          const { data: invite, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email, {
            data: { full_name: u.name },
            // Optional redirect after the user clicks the email — leave to
            // Supabase project default (Site URL) so this works in any env.
          })
          if (inviteErr) throw new Error(`invite failed: ${inviteErr.message}`)
          userId = invite.user.id
          summary.invited++
          console.log(`✓ invited ${email} → ${userId}`)
        }
      } else {
        summary.alreadyHadAuth++
        console.log(`· ${email} already in auth.users (${userId})`)
      }

      if (DRY_RUN || !userId) continue

      // Step 2: upsert profile. Conflict target is `id` (= auth.users.id).
      // Note that on insert the `auth.users` trigger from migration 001
      // already creates a baseline profile row with full_name from
      // raw_user_meta_data, so this upsert is mostly setting role/tier/depts.
      const { error: profErr } = await supabase
        .from('profiles')
        .upsert({
          id: userId,
          full_name: u.name,
          role: u.role,
          tier: u.tier,
          departments,
          organization_id: orgId,
          is_active: true,
        }, { onConflict: 'id' })
      if (profErr) throw new Error(`profile upsert failed: ${profErr.message}`)
      summary.profilesUpserted++

      // Step 3: upsert organization_members. Unique key is
      // (organization_id, user_id). org_members.role is the legacy
      // org-level access enum (owner/admin/member/viewer). Everyone is
      // 'member'; the actual permission role lives on profiles.role.
      const { error: memErr } = await supabase
        .from('organization_members')
        .upsert({
          organization_id: orgId,
          user_id: userId,
          role: 'member',
        }, { onConflict: 'organization_id,user_id' })
      if (memErr) throw new Error(`org_members upsert failed: ${memErr.message}`)
      summary.membershipsUpserted++

      console.log(`  → profile + membership written for ${u.name}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`✗ ${email}: ${msg}`)
      summary.errors.push({ email, message: msg })
    }
  }

  // Final org-wide profile count (should be 18 — Ruben + 17).
  const { count, error: countErr } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
  if (countErr) {
    console.error('Could not count profiles:', countErr.message)
  }

  console.log('\n──────── Summary ────────')
  console.log(`Invited (new auth users):   ${summary.invited}`)
  console.log(`Already in auth.users:      ${summary.alreadyHadAuth}`)
  console.log(`Profiles upserted:          ${summary.profilesUpserted}`)
  console.log(`Memberships upserted:       ${summary.membershipsUpserted}`)
  console.log(`Errors:                     ${summary.errors.length}`)
  if (summary.errors.length > 0) {
    for (const e of summary.errors) console.log(`  - ${e.email}: ${e.message}`)
  }
  console.log(`\nTotal profiles for org:     ${count ?? '?'} (expected 18)`)
  if (count != null && count !== 18) {
    console.warn('⚠ Final count is not 18 — investigate above errors.')
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
