'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole } from '@/types/database'
import { uploadAssetFile, deleteAssetFile, getAssetSignedUrl, MAX_ASSET_SIZE } from '@/lib/assets'

async function getMembership(orgId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, membership: null }
  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: OrgRole } | null; error: unknown }
  return { user, membership }
}

function rev(orgSlug: string) {
  revalidatePath(`/dashboard/${orgSlug}/settings/assets`)
}

export async function uploadAsset(
  orgId: string,
  orgSlug: string,
  categoryId: string | null,
  file: File,
): Promise<{ error?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot upload assets.' }

  if (!file || file.size === 0) return { error: 'No file selected.' }
  if (file.size > MAX_ASSET_SIZE) return { error: 'File must be under 10MB.' }

  const service = createServiceClient()
  const { data: assetRow, error: insertErr } = await service
    .from('assets')
    .insert({
      organization_id: orgId,
      category_id: categoryId,
      name: file.name,
      file_name: file.name,
      storage_path: '', // filled in below once we have the id
      mime_type: file.type || 'application/octet-stream',
      file_size: file.size,
      uploaded_by: user.id,
    })
    .select('id')
    .single() as { data: { id: string } | null; error: { message: string } | null }
  if (insertErr || !assetRow) return { error: insertErr?.message ?? 'Failed to create asset record.' }

  const ext = file.name.split('.').pop() ?? 'bin'
  const storagePath = `${orgId}/${assetRow.id}.${ext}`

  const uploadResult = await uploadAssetFile(service, storagePath, file)
  if (uploadResult.error) {
    // Roll back the DB row so we don't leave an orphaned asset with no file.
    await service.from('assets').delete().eq('id', assetRow.id)
    return { error: uploadResult.error }
  }

  const { error: updateErr } = await service
    .from('assets')
    .update({ storage_path: storagePath })
    .eq('id', assetRow.id)
  if (updateErr) return { error: updateErr.message }

  rev(orgSlug)
  return {}
}

export async function deleteAsset(
  orgId: string,
  orgSlug: string,
  assetId: string,
): Promise<{ error?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot delete assets.' }

  const service = createServiceClient()
  const { data: asset } = await service
    .from('assets')
    .select('storage_path')
    .eq('id', assetId)
    .eq('organization_id', orgId)
    .maybeSingle() as { data: { storage_path: string } | null }
  if (!asset) return { error: 'Asset not found.' }

  const { error: deleteErr } = await service
    .from('assets')
    .delete()
    .eq('id', assetId)
    .eq('organization_id', orgId)
  if (deleteErr) return { error: deleteErr.message }

  // Best-effort storage cleanup -- the DB row is the source of truth for
  // what the library shows, so a storage-delete failure here shouldn't
  // block the asset from disappearing from the UI.
  if (asset.storage_path) await deleteAssetFile(asset.storage_path)

  rev(orgSlug)
  return {}
}

export async function getAssetUrl(orgId: string, assetId: string): Promise<{ url?: string; error?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }

  const service = createServiceClient()
  const { data: asset } = await service
    .from('assets')
    .select('storage_path')
    .eq('id', assetId)
    .eq('organization_id', orgId)
    .maybeSingle() as { data: { storage_path: string } | null }
  if (!asset) return { error: 'Asset not found.' }

  const url = await getAssetSignedUrl(asset.storage_path)
  if (!url) return { error: 'Failed to generate a preview link.' }
  return { url }
}

export async function renameAssetCategory(
  orgId: string,
  orgSlug: string,
  categoryId: string,
  name: string,
): Promise<{ error?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot rename categories.' }

  const trimmed = name.trim()
  if (!trimmed) return { error: 'Category name is required.' }

  const service = createServiceClient()
  const { error } = await service
    .from('asset_categories')
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq('id', categoryId)
    .eq('organization_id', orgId)
  if (error) return { error: error.message }

  rev(orgSlug)
  return {}
}
