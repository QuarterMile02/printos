// Resolves what the BROWSER needs to run Accept.js for a given org.
//
// Deliberately never returns transaction_key -- that's the one credential
// in payment_gateway_settings that must never leave the server (used only
// by src/lib/payments/authorize-net.ts to actually create/capture a
// transaction). api_login_id and client_key are both meant to be embedded
// client-side by Authorize.net's own design (Accept.js tokenizes with
// them; neither can authorize a charge on its own), so decrypting and
// returning those two here is intentional, not a leak.

import { createServiceClient } from '@/lib/supabase/server'
import { decryptCredentialTolerant } from '@/lib/credential-crypto'

export type PublicGatewayConfig = {
  configured: boolean
  apiLoginId: string | null
  clientKey: string | null
  testMode: boolean
}

const NOT_CONFIGURED: PublicGatewayConfig = { configured: false, apiLoginId: null, clientKey: null, testMode: false }

export async function getPublicGatewayConfig(orgId: string): Promise<PublicGatewayConfig> {
  const service = createServiceClient()
  const { data } = await service
    .from('payment_gateway_settings')
    .select('gateway_type, api_login_id, client_key, use_test_mode, is_connected')
    .eq('organization_id', orgId)
    .maybeSingle()

  const row = data as {
    gateway_type: string | null
    api_login_id: string | null
    client_key: string | null
    use_test_mode: boolean | null
    is_connected: boolean | null
  } | null

  if (!row || !row.is_connected || row.gateway_type !== 'authorize_net') return NOT_CONFIGURED
  if (!row.api_login_id || !row.client_key) return NOT_CONFIGURED

  return {
    configured: true,
    apiLoginId: decryptCredentialTolerant(row.api_login_id),
    clientKey: decryptCredentialTolerant(row.client_key),
    testMode: row.use_test_mode ?? false,
  }
}
