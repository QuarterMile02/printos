'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { respondToProofCore, type RespondResult } from '@/lib/proofs/respond-to-proof-core'

// Thin wrapper so the public page's client component has a server action
// to call. All actual validation/security logic lives in
// respondToProofCore — see that file for the full token-ownership
// walkthrough. Nothing here trusts anything about the caller beyond what
// respondToProofCore itself re-derives from the token.
export async function respondToProof(
  token: string,
  proofVersionId: string,
  decision: 'approved' | 'rejected',
  feedback: string | null,
  acknowledgedChecks: boolean,
): Promise<RespondResult> {
  const service = createServiceClient()
  return respondToProofCore(service, token, proofVersionId, decision, feedback, acknowledgedChecks)
}
