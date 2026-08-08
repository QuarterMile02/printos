'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { logActivity } from '@/lib/logActivity'
import { dbOrThrow } from '@/lib/db'
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

const STATUS_ADVANCE: Record<string, string> = {
  new: 'in_progress',
  in_progress: 'proof_review',
  proof_review: 'ready_for_pickup',
  ready_for_pickup: 'completed',
}

export async function updateProofStatus(formData: FormData) {
  const proofId = formData.get('proofId') as string
  const jobId = formData.get('jobId') as string
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const newStatus = formData.get('status') as string

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const service = createServiceClient()

  await dbOrThrow(service.from('proof_versions').update({ status: newStatus }).eq('id', proofId))

  if (user && newStatus === 'approved') {
    await logActivity({
      org_id: orgId,
      user_id: user.id,
      entity_type: 'proof',
      entity_id: proofId,
      action: 'proof_approved',
      metadata: { job_id: jobId },
    })
  }

  // If approved, advance job to next stage
  if (newStatus === 'approved') {
    const { data: jobRow } = await service
      .from('jobs')
      .select('status')
      .eq('id', jobId)
      .single()
    const currentStatus = (jobRow as { status: string } | null)?.status
    if (currentStatus) {
      const nextStatus = STATUS_ADVANCE[currentStatus]
      if (nextStatus) {
        await dbOrThrow(service.from('jobs').update({
          status: nextStatus,
          updated_at: new Date().toISOString(),
        }).eq('id', jobId).eq('organization_id', orgId))

        if (user) {
          await logActivity({
            org_id: orgId,
            user_id: user.id,
            entity_type: 'job',
            entity_id: jobId,
            action: 'stage_entered',
            from_value: currentStatus,
            to_value: nextStatus,
            metadata: { triggered_by: 'proof_approved' },
          })
        }
      }
    }
  }

  redirect(`/dashboard/${orgSlug}/jobs/${jobId}`)
}
