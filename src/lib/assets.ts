import { createServiceClient } from '@/lib/supabase/server'

export const ASSETS_BUCKET = 'assets'
export const MAX_ASSET_SIZE = 10 * 1024 * 1024 // 10MB, matches the proofs upload cap

async function ensureAssetsBucket(service: ReturnType<typeof createServiceClient>) {
  const { data: buckets } = await service.storage.listBuckets()
  const exists = (buckets ?? []).some((b) => b.name === ASSETS_BUCKET)
  if (!exists) {
    await service.storage.createBucket(ASSETS_BUCKET, { public: false })
  }
}

export async function uploadAssetFile(
  service: ReturnType<typeof createServiceClient>,
  storagePath: string,
  file: File,
): Promise<{ error?: string }> {
  await ensureAssetsBucket(service)
  const { error } = await service.storage
    .from(ASSETS_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false })
  if (error) return { error: error.message }
  return {}
}

export async function getAssetSignedUrl(storagePath: string, expiresInSeconds = 3600): Promise<string | null> {
  const service = createServiceClient()
  const { data, error } = await service.storage
    .from(ASSETS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds)
  if (error || !data) return null
  return data.signedUrl
}

export async function deleteAssetFile(storagePath: string): Promise<{ error?: string }> {
  const service = createServiceClient()
  const { error } = await service.storage.from(ASSETS_BUCKET).remove([storagePath])
  if (error) return { error: error.message }
  return {}
}

export type EmailAttachment = { filename: string; content: string }

// Fetches library assets by id and returns them as base64-encoded email
// attachments -- the shape Resend's create-email API expects
// (attachments[].content, not a URL). Used at the one real send site
// today (Quote SendEmailModal); org-scoped so a picker can never pull
// another org's file into an email by id.
export async function fetchAssetsAsAttachments(
  assetIds: string[],
  orgId: string,
): Promise<{ attachments: EmailAttachment[]; error?: string }> {
  if (assetIds.length === 0) return { attachments: [] }

  const service = createServiceClient()
  const { data: rows, error } = await service
    .from('assets')
    .select('id, file_name, storage_path')
    .eq('organization_id', orgId)
    .in('id', assetIds) as {
      data: { id: string; file_name: string; storage_path: string }[] | null
      error: { message: string } | null
    }
  if (error) return { attachments: [], error: error.message }
  if (!rows || rows.length === 0) return { attachments: [] }

  const attachments: EmailAttachment[] = []
  for (const row of rows) {
    const { data: fileData, error: downloadError } = await service.storage
      .from(ASSETS_BUCKET)
      .download(row.storage_path)
    if (downloadError || !fileData) {
      return { attachments: [], error: `Failed to load attachment "${row.file_name}": ${downloadError?.message ?? 'not found'}` }
    }
    const buffer = Buffer.from(await fileData.arrayBuffer())
    attachments.push({ filename: row.file_name, content: buffer.toString('base64') })
  }
  return { attachments }
}
