'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function saveProductType(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const name = (formData.get('name') as string).trim()
  const sort_order = parseInt(formData.get('sort_order') as string) || 0
  const is_active = formData.get('is_active') === 'on'

  const service = createServiceClient()
  let savedId = id
  if (id) {
    await service.from('product_types').update({ name, sort_order, is_active }).eq('id', id)
  } else {
    const { data } = await service
      .from('product_types')
      .insert({ organization_id: orgId, name, sort_order, is_active })
      .select('id')
      .single()
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
  const { count } = await service
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('product_type_id', id)
  if (!count) {
    await service.from('product_types').delete().eq('id', id)
  }
  redirect(`/dashboard/${orgSlug}/settings/product-types`)
}
