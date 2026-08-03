// One-time migration: encrypt existing plaintext carrier_connections.credentials and
// payment_gateway_settings.api_login_id/transaction_key values in place.
//
// Idempotent / safe to re-run: uses isEncryptedCredential() to skip any value already in
// encrypted form, so a partial run, or running this twice, never double-encrypts or
// corrupts an already-migrated row. No "have I run this before" flag needed.
//
// Deploy ordering: the app's read path (src/lib/easypost.ts resolveApiKey) tolerates
// BOTH plaintext and encrypted values already (decryptCredentialTolerant), so this is
// safe to run at any point relative to the code deploy -- before, after, whatever order.
// This script assumes the decrypt-aware code is already live, and the goal is just to
// leave no plaintext secrets sitting in the database.
//
// Usage:
//   npx tsx scripts/migrate-encrypt-credentials.ts --dry-run   (report only, no writes)
//   npx tsx scripts/migrate-encrypt-credentials.ts             (writes encrypted values)

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { encryptCredential, isEncryptedCredential } from '../src/lib/credential-crypto'

const envFile = readFileSync('.env.local', 'utf8')
const vars = Object.fromEntries(
  envFile.split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => {
    const i = l.indexOf('=')
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
  }),
)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || vars.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || vars.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (checked process.env and .env.local)')

if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
  if (!vars.CREDENTIAL_ENCRYPTION_KEY) throw new Error('CREDENTIAL_ENCRYPTION_KEY not set (checked process.env and .env.local)')
  process.env.CREDENTIAL_ENCRYPTION_KEY = vars.CREDENTIAL_ENCRYPTION_KEY
}

const DRY_RUN = process.argv.includes('--dry-run')
const sb = createClient(SUPABASE_URL, SERVICE_KEY)

function encryptUnencryptedFields(creds: Record<string, string>): { changed: boolean; result: Record<string, string> } {
  let changed = false
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(creds)) {
    if (typeof value === 'string' && value.length > 0 && !isEncryptedCredential(value)) {
      result[key] = encryptCredential(value)
      changed = true
    } else {
      result[key] = value
    }
  }
  return { changed, result }
}

async function migrateCarrierConnections() {
  const { data: rows, error } = await sb.from('carrier_connections').select('id, organization_id, carrier, credentials')
  if (error) throw error
  console.log(`\ncarrier_connections: ${rows.length} row(s) found`)
  for (const row of rows) {
    const creds = (row.credentials ?? {}) as Record<string, string>
    if (Object.keys(creds).length === 0) {
      console.log(`  [skip] ${row.carrier} (org ${row.organization_id}) -- no credentials set`)
      continue
    }
    const { changed, result } = encryptUnencryptedFields(creds)
    if (!changed) {
      console.log(`  [skip] ${row.carrier} (org ${row.organization_id}) -- already encrypted`)
      continue
    }
    const changedKeys = Object.keys(creds).filter((k) => creds[k] !== result[k])
    console.log(`  [${DRY_RUN ? 'DRY-RUN' : 'UPDATE'}] ${row.carrier} (org ${row.organization_id}) -- encrypting field(s): ${changedKeys.join(', ')}`)
    if (!DRY_RUN) {
      const { error: updErr } = await sb.from('carrier_connections').update({ credentials: result }).eq('id', row.id)
      if (updErr) throw updErr
    }
  }
}

async function migratePaymentGatewaySettings() {
  const { data: rows, error } = await sb.from('payment_gateway_settings').select('id, organization_id, api_login_id, transaction_key')
  if (error) throw error
  console.log(`\npayment_gateway_settings: ${rows.length} row(s) found`)
  for (const row of rows) {
    const patch: Record<string, string> = {}
    if (row.api_login_id && !isEncryptedCredential(row.api_login_id)) patch.api_login_id = encryptCredential(row.api_login_id)
    if (row.transaction_key && !isEncryptedCredential(row.transaction_key)) patch.transaction_key = encryptCredential(row.transaction_key)
    if (Object.keys(patch).length === 0) {
      console.log(`  [skip] org ${row.organization_id} -- nothing to encrypt`)
      continue
    }
    console.log(`  [${DRY_RUN ? 'DRY-RUN' : 'UPDATE'}] org ${row.organization_id} -- encrypting: ${Object.keys(patch).join(', ')}`)
    if (!DRY_RUN) {
      const { error: updErr } = await sb.from('payment_gateway_settings').update(patch).eq('id', row.id)
      if (updErr) throw updErr
    }
  }
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN — no writes will be made ===' : '=== LIVE RUN — writing encrypted values ===')
  await migrateCarrierConnections()
  await migratePaymentGatewaySettings()
  console.log(DRY_RUN ? '\nDry run complete.' : '\nMigration complete.')
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
