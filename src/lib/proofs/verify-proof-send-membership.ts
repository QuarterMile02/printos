import type { SupabaseClient } from '@supabase/supabase-js'

// Shared UUID-shape guard for every public /proofs/[token]* surface. A
// non-uuid string passed to .eq() on a uuid column raises a Postgres
// "invalid input syntax" error — checking the shape first turns that into
// a clean "invalid link" response instead of an ugly 500. Exported so
// callers that need to run this check before some other, unrelated
// validation (e.g. respondToProofCore's decision check, uploadProofMarkup's
// file-size check) can preserve their original check ordering without
// re-declaring the pattern.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ProofSendMembership = {
  sendId: string
  organizationId: string
  salesOrderId: string
  proofVersionId: string
  status: string
  fileUrl: string
  fileName: string
}

export type VerifyMembershipResult =
  | { ok: true; membership: ProofSendMembership }
  | { ok: false; error: string }

// The single, shared implementation of "does this token genuinely own this
// proofVersionId." This was previously three independent copies (the
// customer approve/reject write path, the customer markup-upload write
// path, and the print view's read-only check) and had already started
// drifting in shape — consolidated here so there is exactly one place that
// can go wrong instead of three.
//
// SECURITY MODEL — read this before touching anything below.
// Every caller of this function is reachable with NO Supabase auth session
// at all: the public /proofs/[token]* pages have no cookie/user, they run
// entirely on the service-role client. The unguessable `token` column on
// proof_sends (a separate random uuid, distinct from that row's own id —
// see migration 119) is the ONLY thing standing between an anonymous
// caller and touching an arbitrary proof_versions row — whether that's
// writing its status, uploading a file against it, or just reading its
// file_url. Every check below exists because of that; each one maps to a
// specific way an anonymous, possibly adversarial caller could otherwise
// abuse this. Do not simplify this function without re-deriving why each
// step is here.
//
// This function only proves membership — it does NOT enforce any
// business rule on top of that (e.g. "only if status is still pending").
// Callers differ on which rules apply on top (the print view intentionally
// has none — an already-approved/rejected proof can still be printed) so
// those stay at the call site.
export async function verifyProofSendMembership(
  service: SupabaseClient,
  token: string,
  proofVersionId: string,
): Promise<VerifyMembershipResult> {
  // 1. Reject malformed input before it ever reaches a query. Neither
  // value's shape can be trusted from an unauthenticated caller.
  if (!UUID_RE.test(token) || !UUID_RE.test(proofVersionId)) {
    return { ok: false, error: 'Invalid link.' }
  }

  // 2. Resolve the token to its proof_sends row. This is the only lookup
  // that trusts the token; every check after this point scopes to *this
  // specific send*, never to the proof_version_id in isolation.
  const { data: send, error: sendErr } = await service
    .from('proof_sends')
    .select('id, organization_id, sales_order_id')
    .eq('token', token)
    .maybeSingle() as {
      data: { id: string; organization_id: string; sales_order_id: string } | null
      error: unknown
    }
  if (sendErr) return { ok: false, error: 'Lookup failed. Please try again.' }
  if (!send) return { ok: false, error: 'Invalid or expired link.' }

  // 3. THE critical ownership check. A token only proves "you were sent
  // *some* bundle" — on its own it says nothing about which proofs are in
  // it. Without this membership check, anyone holding any one valid token
  // (e.g. from their own, unrelated proof email) could reference an
  // arbitrary proofVersionId — guessed, enumerated, or seen elsewhere —
  // and touch that unrelated proof, across sales orders or even across
  // organizations. Requiring a matching row in proof_send_items, scoped
  // to *this* send.id, is what makes the token a capability over one
  // specific bundle rather than a bearer key over the whole
  // proof_versions table.
  const { data: sendItem, error: itemErr } = await service
    .from('proof_send_items')
    .select('id, organization_id')
    .eq('proof_send_id', send.id)
    .eq('proof_version_id', proofVersionId)
    .maybeSingle() as { data: { id: string; organization_id: string } | null; error: unknown }
  if (itemErr) return { ok: false, error: 'Lookup failed. Please try again.' }
  if (!sendItem) return { ok: false, error: 'This proof is not part of this link.' }

  // 4. Defense in depth: every row this touches should agree on
  // organization_id. This is already structurally guaranteed by how rows
  // get here — proof_send_items is only ever inserted by sendProofsBundle
  // (sales-orders/[id]/proof-actions.ts), which stamps organization_id
  // from the same org as the send and validates each proof belongs to
  // that org before insert — but re-checking here is nearly free and
  // turns any future bug that breaks that guarantee into a hard failure
  // instead of a silent cross-org access.
  if (sendItem.organization_id !== send.organization_id) {
    return { ok: false, error: 'This proof is not part of this link.' }
  }

  // 5. Resolve the proof itself. Fetches a superset of fields (status,
  // file_url, file_name) so every caller's own follow-up logic — the
  // status-lock in respondToProofCore/uploadProofMarkup, the file to
  // render in the print view — can run off this one shared read.
  const { data: proof, error: proofErr } = await service
    .from('proof_versions')
    .select('id, organization_id, status, file_url, file_name')
    .eq('id', proofVersionId)
    .maybeSingle() as {
      data: { id: string; organization_id: string; status: string; file_url: string; file_name: string } | null
      error: unknown
    }
  if (proofErr) return { ok: false, error: 'Lookup failed. Please try again.' }
  if (!proof) return { ok: false, error: 'Proof not found.' }
  if (proof.organization_id !== send.organization_id) {
    return { ok: false, error: 'This proof is not part of this link.' }
  }

  return {
    ok: true,
    membership: {
      sendId: send.id,
      organizationId: send.organization_id,
      salesOrderId: send.sales_order_id,
      proofVersionId: proof.id,
      status: proof.status,
      fileUrl: proof.file_url,
      fileName: proof.file_name,
    },
  }
}
