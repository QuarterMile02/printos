'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function saveProductCategory(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const name = (formData.get('name') as string).trim()
  const product_type_id = (formData.get('product_type_id') as string) || null
  const is_active = formData.get('is_active') === 'on'

  const service = createServiceClient()
  let savedId = id
  if (id) {
    const { error } = await service
      .from('product_categories')
      .update({ name, product_type_id, is_active })
      .eq('id', id)
    if (error) redirect(`/dashboard/${orgSlug}/settings/product-categories?edit=${id}&error=${encodeURIComponent(error.message)}`)
  } else {
    const { data, error } = await service
      .from('product_categories')
      .insert({ organization_id: orgId, name, product_type_id, is_active })
      .select('id')
      .single()
    if (error) redirect(`/dashboard/${orgSlug}/settings/product-categories?add=1&error=${encodeURIComponent(error.message)}`)
    savedId = (data as { id: string } | null)?.id ?? null
  }
  redirect(savedId
    ? `/dashboard/${orgSlug}/settings/product-categories?edit=${savedId}&saved=1`
    : `/dashboard/${orgSlug}/settings/product-categories`)
}

export async function deleteProductCategory(formData: FormData) {
  const id = formData.get('id') as string
  const orgSlug = formData.get('orgSlug') as string
  const service = createServiceClient()

  // Delete requires BOTH: already deactivated, AND zero linked records.
  const { data: category } = await service.from('product_categories').select('is_active').eq('id', id).maybeSingle()
  if (category?.is_active !== false) {
    redirect(`/dashboard/${orgSlug}/settings/product-categories?error=${encodeURIComponent('Cannot delete — category must be deactivated first.')}`)
  }

  const { count, error: countError } = await service
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('product_category_id', id)
  if (countError) redirect(`/dashboard/${orgSlug}/settings/product-categories?error=${encodeURIComponent(countError.message)}`)
  if (count) {
    redirect(`/dashboard/${orgSlug}/settings/product-categories?error=${encodeURIComponent(`Cannot delete — used by ${count} product${count === 1 ? '' : 's'}. Modify those first.`)}`)
  }
  const { error } = await service.from('product_categories').delete().eq('id', id)
  if (error) redirect(`/dashboard/${orgSlug}/settings/product-categories?error=${encodeURIComponent(error.message)}`)
  redirect(`/dashboard/${orgSlug}/settings/product-categories`)
}
