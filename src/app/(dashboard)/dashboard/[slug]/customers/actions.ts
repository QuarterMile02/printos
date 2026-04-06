'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole } from '@/types/database'

export async function createCustomer(
  orgId: string,
  orgSlug: string,
  formData: FormData
): Promise<{ error?: string }> {
  const firstName = (formData.get('first_name') as string | null)?.trim()
  const lastName = (formData.get('last_name') as string | null)?.trim()
  const companyName = (formData.get('company_name') as string | null)?.trim() || null
  const email = (formData.get('email') as string | null)?.trim() || null
  const phone = (formData.get('phone') as string | null)?.trim() || null
  const notes = (formData.get('notes') as string | null)?.trim() || null

  if (!firstName || firstName.length < 1) return { error: 'First name is required.' }
  if (!lastName || lastName.length < 1) return { error: 'Last name is required.' }

  // Verify the caller is an org member before writing with service client
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: OrgRole } | null; error: unknown }

  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot create customers.' }

  // Service client bypasses RLS for the insert
  const service = createServiceClient()
  const { error: insertError } = await service
    .from('customers')
    .insert({ organization_id: orgId, first_name: firstName, last_name: lastName, company_name: companyName, email, phone, notes })

  if (insertError) return { error: insertError.message }

  revalidatePath(`/dashboard/${orgSlug}/customers`)
  return {}
}

export async function updateCustomer(
  customerId: string,
  orgId: string,
  orgSlug: string,
  data: {
    first_name: string
    last_name: string
    company_name: string | null
    email: string | null
    phone: string | null
    notes: string | null
  }
): Promise<{ error?: string }> {
  if (!data.first_name.trim()) return { error: 'First name is required.' }
  if (!data.last_name.trim()) return { error: 'Last name is required.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: OrgRole } | null; error: unknown }

  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot update customers.' }

  const service = createServiceClient()
  const { error: updateError } = await service
    .from('customers')
    .update({
      first_name: data.first_name.trim(),
      last_name: data.last_name.trim(),
      company_name: data.company_name?.trim() || null,
      email: data.email?.trim() || null,
      phone: data.phone?.trim() || null,
      notes: data.notes?.trim() || null,
    })
    .eq('id', customerId)
    .eq('organization_id', orgId)

  if (updateError) return { error: updateError.message }

  revalidatePath(`/dashboard/${orgSlug}/customers`)
  revalidatePath(`/dashboard/${orgSlug}/customers/${customerId}`)
  return {}
}
