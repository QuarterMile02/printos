'use server'

import { createClient } from '@/lib/supabase/server'

export type PickerAssetCategory = { id: string; name: string; sort_order: number }
export type PickerAsset = {
  id: string
  category_id: string | null
  file_name: string
  mime_type: string
  file_size: number
}

// Read-only listing for the "Attach from Library" picker -- callable from
// any send-flow, org-scoped via the caller's own membership (RLS on
// asset_categories/assets already restricts to the caller's orgs; the
// explicit orgId filter here just narrows to the one being viewed).
export async function listAssetsForPicker(
  orgId: string,
): Promise<{ categories: PickerAssetCategory[]; assets: PickerAsset[]; error?: string }> {
  const supabase = await createClient()

  const { data: categories, error: catError } = await supabase
    .from('asset_categories')
    .select('id, name, sort_order')
    .eq('organization_id', orgId)
    .order('sort_order') as { data: PickerAssetCategory[] | null; error: { message: string } | null }
  if (catError) return { categories: [], assets: [], error: catError.message }

  const { data: assets, error: assetError } = await supabase
    .from('assets')
    .select('id, category_id, file_name, mime_type, file_size')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false }) as { data: PickerAsset[] | null; error: { message: string } | null }
  if (assetError) return { categories: categories ?? [], assets: [], error: assetError.message }

  return { categories: categories ?? [], assets: assets ?? [] }
}
