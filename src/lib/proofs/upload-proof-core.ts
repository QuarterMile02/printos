import type { SupabaseClient } from '@supabase/supabase-js'

// Shared proof-upload logic, extracted from the original
// jobs/[jobId]/proof-actions.ts's uploadProof (that file's own action is
// now a thin wrapper around this) so the new SO-page upload path
// (sales-orders/[id]/proof-actions.ts's uploadProofForLineItem) can't
// drift from it -- same "one implementation, not two copies" reasoning as
// build-invoices-iif.ts and respond-to-proof-core.ts elsewhere in this
// codebase.

type ServiceClient = SupabaseClient

export type UploadProofInput = {
  service: ServiceClient
  orgId: string
  jobId: string
  quoteLineItemId: string | null
  uploadedBy: string
  file: File | null
}

export type UploadProofResult =
  | { ok: true; proofId: string; fileName: string; versionNumber: number }
  | { ok: false; error: string }

export async function uploadProofCore(input: UploadProofInput): Promise<UploadProofResult> {
  const { service, orgId, jobId, quoteLineItemId, uploadedBy, file } = input

  if (!file || file.size === 0) return { ok: false, error: 'No file selected' }
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'File must be under 10MB' }

  // Ensure bucket exists, public: true -- getPublicUrl() below only
  // resolves to something viewable if the bucket actually is public (see
  // this same note's original home in uploadProof for the history of why
  // this was flipped from false).
  const { data: buckets } = await service.storage.listBuckets()
  const exists = (buckets ?? []).some((b) => b.name === 'proofs')
  if (!exists) {
    await service.storage.createBucket('proofs', { public: true })
  }

  // Get next version number, scoped to this job
  const { data: existing } = await service
    .from('proof_versions')
    .select('version_number')
    .eq('job_id', jobId)
    .order('version_number', { ascending: false })
    .limit(1)
  const nextVersion = ((existing as { version_number: number }[] | null)?.[0]?.version_number ?? 0) + 1

  const ext = file.name.split('.').pop() ?? 'bin'
  const storagePath = `${orgId}/${jobId}/v${nextVersion}.${ext}`

  const { error: uploadErr } = await service.storage
    .from('proofs')
    .upload(storagePath, file, { contentType: file.type, upsert: true })
  if (uploadErr) {
    console.error('[uploadProofCore] Storage error:', uploadErr.message)
    return { ok: false, error: `Upload failed: ${uploadErr.message}` }
  }

  const { data: urlData } = service.storage.from('proofs').getPublicUrl(storagePath)
  const fileUrl = urlData.publicUrl

  const { data: proofRow, error: dbErr } = await service
    .from('proof_versions')
    .insert({
      job_id: jobId,
      organization_id: orgId,
      file_url: fileUrl,
      file_name: file.name,
      version_number: nextVersion,
      uploaded_by: uploadedBy,
      status: 'pending',
      quote_line_item_id: quoteLineItemId,
    })
    .select('id')
    .single() as { data: { id: string } | null; error: { message: string } | null }

  if (dbErr || !proofRow) {
    console.error('[uploadProofCore] DB error:', dbErr?.message)
    return { ok: false, error: `Save failed: ${dbErr?.message ?? 'unknown error'}` }
  }

  return { ok: true, proofId: proofRow.id, fileName: file.name, versionNumber: nextVersion }
}
