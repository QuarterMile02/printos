'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { respondToProofCore, type RespondResult } from '@/lib/proofs/respond-to-proof-core'
import { UUID_RE, verifyProofSendMembership } from '@/lib/proofs/verify-proof-send-membership'

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
  markupFileUrl: string | null = null,
): Promise<RespondResult> {
  const service = createServiceClient()
  return respondToProofCore(service, token, proofVersionId, decision, feedback, acknowledgedChecks, markupFileUrl)
}

export type UploadMarkupResult = { ok: true; url: string } | { ok: false; error: string }

// Item 4b — customer-side markup-file upload, part of Request Changes.
// Kept as its own action (called by proof-response-client.tsx *before*
// respondToProof) rather than folded into respondToProofCore, so the file
// lands in storage first and the resulting URL is passed into the same
// atomic status-changing UPDATE in respondToProofCore — one write for the
// whole response, not two independent ones that could disagree if either
// half failed.
//
// Token -> proof_sends -> proof_send_items membership resolution is shared
// with respondToProofCore and the print view via verifyProofSendMembership
// (see that file's header for the full security model) — this used to be
// an independent copy of that same check, consolidated to avoid the two
// drifting apart.
export async function uploadProofMarkup(
  token: string,
  proofVersionId: string,
  file: File,
): Promise<UploadMarkupResult> {
  // Checked explicitly here (ahead of the file-size/presence checks below)
  // rather than left to verifyProofSendMembership's own internal copy of
  // this same check, so a malformed link is still reported as
  // "Invalid link." even when the file field is ALSO invalid — preserves
  // this function's original check ordering from before the
  // shared-membership extraction.
  if (!UUID_RE.test(token) || !UUID_RE.test(proofVersionId)) {
    return { ok: false, error: 'Invalid link.' }
  }
  if (!file || file.size === 0) return { ok: false, error: 'No file selected.' }
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'File must be under 10MB.' }

  const service = createServiceClient()

  const result = await verifyProofSendMembership(service, token, proofVersionId)
  if (!result.ok) return { ok: false, error: result.error }
  const { membership } = result

  if (membership.status !== 'pending') {
    return { ok: false, error: 'This proof has already been responded to.' }
  }

  // Separate bucket from staff's `proofs` bucket, deliberately — this is
  // anonymous customer-supplied content, not staff-vetted output, and
  // keeping the namespaces apart avoids any chance of a markup file being
  // mistaken for (or listed alongside) a real proof version.
  const { data: buckets } = await service.storage.listBuckets()
  const exists = (buckets ?? []).some((b) => b.name === 'proof-markups')
  if (!exists) {
    await service.storage.createBucket('proof-markups', { public: true })
  }

  const ext = file.name.split('.').pop() || 'bin'
  const storagePath = `${membership.organizationId}/${proofVersionId}/markup-${Date.now()}.${ext}`

  const { error: uploadErr } = await service.storage
    .from('proof-markups')
    .upload(storagePath, file, { contentType: file.type || 'application/octet-stream', upsert: true })
  if (uploadErr) {
    console.error('[uploadProofMarkup] Storage error:', uploadErr.message)
    return { ok: false, error: `Upload failed: ${uploadErr.message}` }
  }

  const { data: urlData } = service.storage.from('proof-markups').getPublicUrl(storagePath)
  return { ok: true, url: urlData.publicUrl }
}
