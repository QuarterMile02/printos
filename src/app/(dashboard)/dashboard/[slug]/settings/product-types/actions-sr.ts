'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function saveProductType(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const name = (formData.get('name') as string).trim()
  const is_active = formData.get('is_active') === 'on'

  const service = createServiceClient()
  let savedId = id
  if (id) {
    const { error } = await service.from('product_types').update({ name, is_active }).eq('id', id)
    if (error) redirect(`/dashboard/${orgSlug}/settings/product-types?edit=${id}&error=${encodeURIComponent(error.message)}`)
  } else {
    const { data, error } = await service
      .from('product_types')
      .insert({ organization_id: orgId, name, is_active })
      .select('id')
      .single()
    if (error) redirect(`/dashboard/${orgSlug}/settings/product-types?add=1&error=${encodeURIComponent(error.message)}`)
    savedId = (data as { id: string } | null)?.id ?? null
  }
  redirect(savedId
    ? `/dashboard/${orgSlug}/settings/product-types?edit=${savedId}&saved=1`
    : `/dashboard/${orgSlug}/settings/product-types`)
}

export async function deleteProductType(formData: FormData) {
  const id = formData.get('id') as string
  const orgSlug = formData.get('orgSlug') as string
  const service = createServiceClient()

  // Delete requires BOTH: already deactivated, AND zero linked records.
  const { data: type } = await service.from('product_types').select('is_active').eq('id', id).maybeSingle()
  if (type?.is_active !== false) {
    redirect(`/dashboard/${orgSlug}/settings/product-types?error=${encodeURIComponent('Cannot delete — product type must be deactivated first.')}`)
  }

  const { count, error: countError } = await service
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('product_type_id', id)
  if (countError) redirect(`/dashboard/${orgSlug}/settings/product-types?error=${encodeURIComponent(countError.message)}`)
  if (count) {
    redirect(`/dashboard/${orgSlug}/settings/product-types?error=${encodeURIComponent(`Cannot delete — used by ${count} product${count === 1 ? '' : 's'}. Modify those first.`)}`)
  }
  const { error } = await service.from('product_types').delete().eq('id', id)
  if (error) redirect(`/dashboard/${orgSlug}/settings/product-types?error=${encodeURIComponent(error.message)}`)
  redirect(`/dashboard/${orgSlug}/settings/product-types`)
}
