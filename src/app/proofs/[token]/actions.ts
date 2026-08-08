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
  markupFileUrl: string | null = null,
): Promise<RespondResult> {
  const service = createServiceClient()
  return respondToProofCore(service, token, proofVersionId, decision, feedback, acknowledgedChecks, markupFileUrl)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type UploadMarkupResult = { ok: true; url: string } | { ok: false; error: string }

// Item 4b — customer-side markup-file upload, part of Request Changes.
// Kept as its own action (called by proof-response-client.tsx *before*
// respondToProof) rather than folded into respondToProofCore, so the file
// lands in storage first and the resulting URL is passed into the same
// atomic status-changing UPDATE in respondToProofCore — one write for the
// whole response, not two independent ones that could disagree if either
// half failed.
//
// This re-derives its own independent copy of the same
// token -> proof_sends -> proof_send_items membership check that
// respond-to-proof-core.ts uses for its write path (see that file's header
// for the full security model), rather than refactoring that
// already-verified file to share this logic — the two paths' failure modes
// differ enough (this one uploads a file and returns a URL; that one flips
// a status) that keeping them independent was judged safer than coupling
// an already-tested security boundary to a brand-new code path.
export async function uploadProofMarkup(
  token: string,
  proofVersionId: string,
  file: File,
): Promise<UploadMarkupResult> {
  if (!UUID_RE.test(token) || !UUID_RE.test(proofVersionId)) {
    return { ok: false, error: 'Invalid link.' }
  }
  if (!file || file.size === 0) return { ok: false, error: 'No file selected.' }
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'File must be under 10MB.' }

  const service = createServiceClient()

  const { data: send, error: sendErr } = await service
    .from('proof_sends')
    .select('id, organization_id')
    .eq('token', token)
    .maybeSingle() as { data: { id: string; organization_id: string } | null; error: unknown }
  if (sendErr) return { ok: false, error: 'Lookup failed. Please try again.' }
  if (!send) return { ok: false, error: 'Invalid or expired link.' }

  const { data: sendItem, error: itemErr } = await service
    .from('proof_send_items')
    .select('id, organization_id')
    .eq('proof_send_id', send.id)
    .eq('proof_version_id', proofVersionId)
    .maybeSingle() as { data: { id: string; organization_id: string } | null; error: unknown }
  if (itemErr) return { ok: false, error: 'Lookup failed. Please try again.' }
  if (!sendItem || sendItem.organization_id !== send.organization_id) {
    return { ok: false, error: 'This proof is not part of this link.' }
  }

  const { data: proof, error: proofErr } = await service
    .from('proof_versions')
    .select('id, organization_id, status')
    .eq('id', proofVersionId)
    .maybeSingle() as { data: { id: string; organization_id: string; status: string } | null; error: unknown }
  if (proofErr) return { ok: false, error: 'Lookup failed. Please try again.' }
  if (!proof || proof.organization_id !== send.organization_id) {
    return { ok: false, error: 'This proof is not part of this link.' }
  }
  if (proof.status !== 'pending') {
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
  const storagePath = `${send.organization_id}/${proofVersionId}/markup-${Date.now()}.${ext}`

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
