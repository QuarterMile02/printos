'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { JobStatus, OrgRole } from '@/types/database'

const VALID_STATUSES: JobStatus[] = [
  'new', 'in_progress', 'proof_review', 'ready_for_pickup', 'completed',
]

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

export async function createJob(
  orgId: string,
  orgSlug: string,
  formData: FormData
): Promise<{ error?: string }> {
  const title = (formData.get('title') as string | null)?.trim()
  const customerId = (formData.get('customer_id') as string | null) || null
  const description = (formData.get('description') as string | null)?.trim() || null
  const dueDate = (formData.get('due_date') as string | null) || null
  const status = ((formData.get('status') as string | null) ?? 'new') as JobStatus

  if (!title) return { error: 'Title is required.' }
  if (!VALID_STATUSES.includes(status)) return { error: 'Invalid status.' }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot create jobs.' }

  const service = createServiceClient()
  const { error: insertError } = await service
    .from('jobs')
    .insert({
      organization_id: orgId,
      customer_id: customerId || null,
      title,
      description,
      status,
      due_date: dueDate || null,
    })

  if (insertError) return { error: insertError.message }

  revalidatePath(`/dashboard/${orgSlug}/jobs`)
  return {}
}

export async function updateJobStatus(
  jobId: string,
  orgId: string,
  orgSlug: string,
  status: JobStatus
): Promise<{ error?: string }> {
  if (!VALID_STATUSES.includes(status)) return { error: 'Invalid status.' }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot update jobs.' }

  const service = createServiceClient()
  const { error: updateError } = await service
    .from('jobs')
    .update({ status })
    .eq('id', jobId)
    .eq('organization_id', orgId)

  if (updateError) return { error: updateError.message }

  revalidatePath(`/dashboard/${orgSlug}/jobs`)
  return {}
}
