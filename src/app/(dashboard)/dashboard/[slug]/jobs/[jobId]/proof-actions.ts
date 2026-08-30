'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { logActivity } from '@/lib/logActivity'
import { uploadProofCore } from '@/lib/proofs/upload-proof-core'

export async function uploadProof(formData: FormData) {
  const jobId = formData.get('jobId') as string
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const file = formData.get('file') as File | null
  // Which quote line item this proof belongs to (migration 119) — optional,
  // the upload form's dropdown allows leaving it unset for older-style
  // single-item jobs. Source of truth for "which line items have a ready
  // proof" on the SO detail page's bulk Send Proofs UI.
  const rawLineItemId = formData.get('quoteLineItemId') as string | null
  const quoteLineItemId = rawLineItemId && rawLineItemId.trim() ? rawLineItemId.trim() : null

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const service = createServiceClient()

  const result = await uploadProofCore({ service, orgId, jobId, quoteLineItemId, uploadedBy: user.id, file })
  if (!result.ok) throw new Error(result.error)

  await logActivity({
    org_id: orgId,
    user_id: user.id,
    entity_type: 'proof',
    entity_id: result.proofId,
    action: 'proof_sent',
    metadata: { job_id: jobId, version: result.versionNumber, file_name: result.fileName },
  })

  redirect(`/dashboard/${orgSlug}/jobs/${jobId}`)
}

// updateProofStatus (staff-side proof approve/reject) removed here --
// confirmed dead code: zero callers and no approve/reject control
// anywhere in the staff job-detail UI. The real, working approval path
// is customer-facing (respondToProofCore, via the emailed
// /proofs/[token] link), which already logs correctly.
// (schema-drift-findings.md Section 9)
