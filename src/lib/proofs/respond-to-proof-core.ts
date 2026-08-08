import type { SupabaseClient } from '@supabase/supabase-js'
import { logActivity } from '@/lib/logActivity'
import { UUID_RE, verifyProofSendMembership } from './verify-proof-send-membership'

// The single, shared implementation of "a customer clicked Approve/Reject
// on one specific proof inside their emailed proof-review link." The
// public /proofs/[token] page's server action (src/app/proofs/[token]/actions.ts)
// is the only caller today, but this is factored out on its own so any
// future caller (e.g. an admin "respond on the customer's behalf" tool)
// goes through the exact same checks rather than a second, possibly
// looser, copy of this logic.
//
// SECURITY MODEL — read this before touching anything below.
// This function is reachable with NO Supabase auth session at all: the
// public page has no cookie/user, it runs entirely on the service-role
// client. The unguessable `token` column on proof_sends (a separate
// random uuid, distinct from that row's own id — see migration 119) is
// the ONLY thing standing between an anonymous caller and writing to
// proof_versions.status for an arbitrary row. The actual token -> send ->
// send_item -> proof resolution lives in verifyProofSendMembership
// (shared with uploadProofMarkup and the print view) — see that file's
// header for the full walkthrough of why each of its steps exists. Do not
// simplify this function without re-deriving why each step is here.

export type RespondResult = { ok: true } | { ok: false; error: string }

export async function respondToProofCore(
  service: SupabaseClient,
  token: string,
  proofVersionId: string,
  decision: 'approved' | 'rejected',
  feedback: string | null,
  // Item 3 — the required review checkboxes (Colors/Text/Spelling/Logos/
  // Finishes/color-variance disclaimer). This is the REAL gate: the
  // public page's Approve button is disabled client-side until all 6 are
  // checked, but a disabled attribute is only ever a UX nicety, not a
  // security boundary -- a scripted caller can POST decision:'approved'
  // directly regardless of what the button showed. This boolean is
  // re-derived and re-checked here, server-side, before any approval is
  // ever written.
  acknowledgedChecks: boolean,
  // Item 4b — optional customer-uploaded markup file URL, already uploaded
  // to the separate `proof-markups` bucket by uploadProofMarkup (actions.ts)
  // *before* this function is called. Purely additive: just one more field
  // on the same status-changing UPDATE below, so the whole response (status
  // + feedback + markup) still lands atomically in one write. Deliberately
  // NOT resolving/uploading anything here — this function's job stays "flip
  // status," not "handle file I/O."
  markupFileUrl: string | null = null,
): Promise<RespondResult> {
  // 1. Reject malformed input before it ever reaches a query. Neither
  // value's shape can be trusted from an unauthenticated POST body,
  // Checked explicitly here (ahead of the decision/acknowledgedChecks
  // checks below) rather than left to verifyProofSendMembership's own
  // internal copy of this same check, so a malformed link is still
  // reported as "Invalid link." even when the decision/acknowledgedChecks
  // fields are ALSO malformed — preserves this function's original check
  // ordering from before the shared-membership extraction.
  if (!UUID_RE.test(token) || !UUID_RE.test(proofVersionId)) {
    return { ok: false, error: 'Invalid link.' }
  }
  if (decision !== 'approved' && decision !== 'rejected') {
    return { ok: false, error: 'Invalid decision.' }
  }
  if (decision === 'approved' && !acknowledgedChecks) {
    return { ok: false, error: 'Please check all required boxes before approving.' }
  }

  // 2-4. Token -> proof_sends -> proof_send_items -> proof_versions
  // ownership resolution — see verify-proof-send-membership.ts for the
  // full walkthrough of why each step exists. Shared with uploadProofMarkup
  // (actions.ts) and the print view (print/[proofId]/page.tsx).
  const result = await verifyProofSendMembership(service, token, proofVersionId)
  if (!result.ok) return { ok: false, error: result.error }
  const { membership } = result

  // 5. Status-based lock — the agreed access model (no time expiry, but
  // once a proof has been responded to it's locked from further action on
  // this link). verifyProofSendMembership re-fetches the live status on
  // every call rather than trusting anything the client claims about it.
  if (membership.status !== 'pending') {
    return { ok: false, error: 'This proof has already been responded to.' }
  }

  // 6. Write. status='pending' is repeated in the WHERE clause as an
  // atomic guard against a race between two near-simultaneous submits for
  // the same proof (double click, two open tabs, a retried request) —
  // whichever UPDATE actually matches a row wins; the other gets 0 rows
  // back below and is treated as "already responded" instead of silently
  // overwriting the first response.
  //
  // customer_checks_acknowledged_at (migration 122) is set ONLY for a
  // verified-acknowledged approval — never for a rejection, and never
  // just because the client claimed acknowledgedChecks was true (step 1
  // above already rejected that combination before reaching here, but
  // this stays decision-gated too rather than trusting the boolean
  // directly, so a future edit to the check above can't silently start
  // writing a false acknowledgment timestamp). Given the checkbox text is
  // explicit liability language, this timestamp is meant to be a durable
  // record that the gate was actually enforced for THIS approval,
  // independent of whether the enforcement logic itself is ever changed
  // or has a bug later.
  const nowIso = new Date().toISOString()
  const { data: updated, error: updateErr } = await service
    .from('proof_versions')
    .update({
      status: decision,
      customer_feedback: feedback?.trim() || null,
      customer_responded_at: nowIso,
      customer_checks_acknowledged_at: decision === 'approved' ? nowIso : null,
      // Only meaningful for a rejection (the UI only offers the markup
      // upload as part of Request Changes) — written whenever the caller
      // provided one, regardless of decision, since a null value here is
      // always a safe no-op.
      customer_markup_file_url: markupFileUrl,
    })
    .eq('id', proofVersionId)
    .eq('status', 'pending')
    .select('id')
  if (updateErr) return { ok: false, error: 'Failed to save your response. Please try again.' }
  if (!updated || updated.length === 0) {
    return { ok: false, error: 'This proof has already been responded to.' }
  }

  // Not advancing job.status here on approval (unlike the staff-side
  // updateProofStatus in jobs/[jobId]/proof-actions.ts) — deliberately
  // out of scope. A job can bundle multiple line items/proofs (see
  // migration 037's material_selection), so one line item's proof being
  // approved doesn't mean the whole job is ready to advance a stage.
  // Wiring that up correctly is a separate decision, not implied by "the
  // customer can approve/reject each proof independently."

  await logActivity({
    org_id: membership.organizationId,
    user_id: null, // customer action — no staff auth.users id to attribute this to
    entity_type: 'proof',
    entity_id: proofVersionId,
    action: decision === 'approved' ? 'proof_approved' : 'proof_rejected',
    metadata: {
      source: 'customer_proof_link',
      proof_send_id: membership.sendId,
      sales_order_id: membership.salesOrderId,
      // Deliberately not logging the raw token here — activity_log is
      // read by staff-facing UI (recent-activity.tsx); no reason for a
      // live bearer credential to sit in an audit table.
    },
  })

  return { ok: true }
}
