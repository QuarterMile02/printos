'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { logActivity } from '@/lib/logActivity'

export async function uploadProof(formData: FormData) {
  const jobId = formData.get('jobId') as string
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const file = formData.get('file') as File | null

  if (!file || file.size === 0) throw new Error('No file selected')
  if (file.size > 10 * 1024 * 1024) throw new Error('File must be under 10MB')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const service = createServiceClient()

  // Ensure bucket exists
  const { data: buckets } = await service.storage.listBuckets()
  const exists = (buckets ?? []).some(b => b.name === 'proofs')
  if (!exists) {
    await service.storage.createBucket('proofs', { public: false })
  }

  // Get next version number
  const { data: existing } = await service
    .from('proof_versions')
    .select('version_number')
    .eq('job_id', jobId)
    .order('version_number', { ascending: false })
    .limit(1)
  const nextVersion = ((existing as { version_number: number }[] | null)?.[0]?.version_number ?? 0) + 1

  // Upload file
  const ext = file.name.split('.').pop() ?? 'bin'
  const storagePath = `${orgId}/${jobId}/v${nextVersion}.${ext}`

  const { error: uploadErr } = await service.storage
    .from('proofs')
    .upload(storagePath, file, { contentType: file.type, upsert: true })

  if (uploadErr) {
    console.error('[uploadProof] Storage error:', uploadErr.message)
    throw new Error(`Upload failed: ${uploadErr.message}`)
  }

  // Get public URL
  const { data: urlData } = service.storage.from('proofs').getPublicUrl(storagePath)
  const fileUrl = urlData.publicUrl

  // Insert record
  const { data: proofRow, error: dbErr } = await service.from('proof_versions').insert({
    job_id: jobId,
    organization_id: orgId,
    file_url: fileUrl,
    file_name: file.name,
    version_number: nextVersion,
    uploaded_by: user.id,
    status: 'pending',
  }).select('id').single() as { data: { id: string } | null; error: { message: string } | null }

  if (dbErr) {
    console.error('[uploadProof] DB error:', dbErr.message)
    throw new Error(`Save failed: ${dbErr.message}`)
  }

  if (proofRow?.id) {
    await logActivity({
      org_id: orgId,
      user_id: user.id,
      entity_type: 'proof',
      entity_id: proofRow.id,
      action: 'proof_sent',
      metadata: { job_id: jobId, version: nextVersion, file_name: file.name },
    })
  }

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

  await service.from('proof_versions').update({ status: newStatus }).eq('id', proofId)

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
        await service.from('jobs').update({
          status: nextStatus,
          updated_at: new Date().toISOString(),
        }).eq('id', jobId).eq('organization_id', orgId)

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
