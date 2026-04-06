'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { OrgRole } from '@/types/database'
import type { ProductStatus } from '@/types/product-builder'

// Tabs 1 + 2 wired up. Tabs 3/4 will extend this type.
export type ProductFormData = {
  // Tab 1 — Basic Settings
  name: string
  description: string | null
  product_type: string | null
  category_id: string | null
  secondary_category: string | null
  workflow_template_id: string | null
  complexity_value: number | null
  image_url: string | null
  status: ProductStatus
  // Tab 2 — Advanced Settings
  income_account: string | null
  income_account_number: string | null
  cog_account: string | null
  cog_account_number: number | null
  asset_account: string | null
  default_sale_type: string | null
  qb_item_type: string | null
  rounding: number | null
  taxable: boolean
  in_house_commission: boolean
  outsourced_commission: boolean
  include_base_product_in_po: boolean
  print_image_on_pdf: boolean
  production_details: string | null
}

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

function buildRecord(data: ProductFormData) {
  return {
    // Tab 1
    name: data.name.trim(),
    description: data.description?.trim() || null,
    product_type: data.product_type?.trim() || null,
    category_id: data.category_id,
    secondary_category: data.secondary_category?.trim() || null,
    workflow_template_id: data.workflow_template_id,
    complexity_value: data.complexity_value,
    image_url: data.image_url?.trim() || null,
    status: data.status,
    active: data.status === 'published',
    // Tab 2
    income_account: data.income_account?.trim() || null,
    income_account_number: data.income_account_number?.trim() || null,
    cog_account: data.cog_account?.trim() || null,
    cog_account_number: data.cog_account_number,
    asset_account: data.asset_account?.trim() || null,
    default_sale_type: data.default_sale_type,
    qb_item_type: data.qb_item_type,
    rounding: data.rounding,
    taxable: data.taxable,
    in_house_commission: data.in_house_commission,
    outsourced_commission: data.outsourced_commission,
    include_base_product_in_po: data.include_base_product_in_po,
    print_image_on_pdf: data.print_image_on_pdf,
    production_details: data.production_details?.trim() || null,
  }
}

export async function createProduct(
  orgId: string,
  orgSlug: string,
  data: ProductFormData
): Promise<{ error?: string; id?: string }> {
  if (!data.name.trim()) return { error: 'Name is required.' }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot create products.' }

  const service = createServiceClient()
  const { data: inserted, error } = await service
    .from('products')
    .insert({
      organization_id: orgId,
      ...buildRecord(data),
      created_by: user.id,
      updated_by: user.id,
    })
    .select('id')
    .single()

  if (error || !inserted) return { error: error?.message ?? 'Failed to create product.' }

  revalidatePath(`/dashboard/${orgSlug}/products`)
  return { id: inserted.id }
}

export async function updateProduct(
  id: string,
  orgId: string,
  orgSlug: string,
  data: ProductFormData
): Promise<{ error?: string }> {
  if (!data.name.trim()) return { error: 'Name is required.' }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot update products.' }

  const service = createServiceClient()
  const { error } = await service
    .from('products')
    .update({ ...buildRecord(data), updated_by: user.id })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/products`)
  revalidatePath(`/dashboard/${orgSlug}/products/${id}`)
  return {}
}

export async function createProductAndRedirect(
  orgId: string,
  orgSlug: string,
  data: ProductFormData
) {
  const result = await createProduct(orgId, orgSlug, data)
  if (result.error) return result
  if (result.id) {
    redirect(`/dashboard/${orgSlug}/products/${result.id}`)
  }
  return result
}
