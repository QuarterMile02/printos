'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48)
}

export async function createOrganization(formData: FormData): Promise<{ error?: string }> {
  const name = (formData.get('name') as string | null)?.trim()
  if (!name || name.length < 2) return { error: 'Organization name must be at least 2 characters.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  // Service client bypasses RLS — needed to bootstrap the first owner member
  const service = createServiceClient()

  const baseSlug = toSlug(name)

  // Ensure slug uniqueness by appending a short random suffix if taken
  let slug = baseSlug
  const { data: existing } = await service
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (existing) {
    slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`
  }

  const { data: org, error: orgError } = await service
    .from('organizations')
    .insert({ name, slug })
    .select('id')
    .single()

  if (orgError || !org) {
    return { error: orgError?.message ?? 'Failed to create organization.' }
  }

  const { error: memberError } = await service
    .from('organization_members')
    .insert({ organization_id: org.id, user_id: user.id, role: 'owner' })

  if (memberError) {
    // Roll back the org if member insert fails
    await service.from('organizations').delete().eq('id', org.id)
    return { error: memberError.message }
  }

  revalidatePath('/dashboard')
  return {}
}
