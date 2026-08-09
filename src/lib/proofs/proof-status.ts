// Plain, directive-free module — shared between the Sales Order detail
// page (server-fetched, rendered client-side in unified-line-items.tsx)
// and the Jobs List view (jobs-list-client.tsx, 'use client'). No 'use
// server'/'use client' directive here on purpose: this is the same class
// of pitfall documented in jobs-list-constants.ts/board-config.ts — a
// plain function exported from a directive-marked file doesn't cross that
// boundary as a real value. Keeping the classification logic in one
// undirected module is also what keeps the two call sites' status pills
// from silently drifting apart, the same reasoning as
// resolve-jobs-for-line-items.ts and verify-proof-send-membership.ts.
//
// No new migration/columns needed for any of this — every input here
// (proof_versions.status, proof_versions.customer_responded_at,
// proof_send_items -> proof_sends.sent_at) already exists and is already
// queried elsewhere (readyProofs' lastSentAt on the SO page, in fact,
// already computes the exact "has this pending proof been sent" signal
// this module needs — see sales-orders/[id]/page.tsx).

export type ProofStatusKey = 'not_started' | 'ready_to_send' | 'in_review' | 'approved' | 'redesign'

export type ProofStatusInput = {
  // null = no proof_version exists yet for this line item at all.
  proofStatus: 'pending' | 'approved' | 'rejected' | null
  // Most recent proof_sends.sent_at this proof was included in, if any.
  // Only meaningful when proofStatus === 'pending'.
  sentAt: string | null
  // proof_versions.customer_responded_at. Only meaningful when
  // proofStatus === 'rejected'.
  respondedAt: string | null
}

export type ProofStatusResult = {
  key: ProofStatusKey
  label: string
  // Days elapsed since sentAt (in_review) or respondedAt (redesign).
  // null for not_started/ready_to_send/approved, where the plan
  // explicitly says elapsed days don't apply.
  elapsedDays: number | null
}

export const PROOF_STATUS_LABELS: Record<ProofStatusKey, string> = {
  not_started: 'Not Started',
  ready_to_send: 'Ready to Send',
  in_review: 'In Review',
  approved: 'Approved',
  redesign: 'Redesign',
}

// 'redesign' reuses proof_versions.status = 'rejected' under the hood
// (see computeProofStatus) -- "Redesign" is purely a display relabel,
// not a new underlying value. Don't be surprised finding 'rejected' in
// the DB for a row showing "Redesign" here.
export const PROOF_STATUS_STYLES: Record<ProofStatusKey, string> = {
  not_started: 'bg-gray-100 text-gray-500',
  ready_to_send: 'bg-amber-50 text-amber-700',
  in_review: 'bg-blue-50 text-blue-700',
  approved: 'bg-green-50 text-green-700',
  redesign: 'bg-red-50 text-red-700',
}

function daysSince(iso: string): number {
  const diffMs = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(diffMs / 86_400_000))
}

export function computeProofStatus(input: ProofStatusInput): ProofStatusResult {
  if (!input.proofStatus) {
    return { key: 'not_started', label: PROOF_STATUS_LABELS.not_started, elapsedDays: null }
  }
  if (input.proofStatus === 'approved') {
    return { key: 'approved', label: PROOF_STATUS_LABELS.approved, elapsedDays: null }
  }
  if (input.proofStatus === 'rejected') {
    return {
      key: 'redesign',
      label: PROOF_STATUS_LABELS.redesign,
      elapsedDays: input.respondedAt ? daysSince(input.respondedAt) : null,
    }
  }
  // pending
  if (input.sentAt) {
    return { key: 'in_review', label: PROOF_STATUS_LABELS.in_review, elapsedDays: daysSince(input.sentAt) }
  }
  return { key: 'ready_to_send', label: PROOF_STATUS_LABELS.ready_to_send, elapsedDays: null }
}

// Compact "3d" / "today" suffix for a pill's elapsed-days badge. Kept
// separate from computeProofStatus (which stays a pure classification
// function) since formatting is a display concern.
export function formatElapsedDays(n: number | null): string | null {
  if (n === null) return null
  return n === 0 ? 'today' : `${n}d`
}
