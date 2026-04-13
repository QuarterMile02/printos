'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function clockIn(formData: FormData) {
  const jobId = formData.get('jobId') as string
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const stage = formData.get('stage') as string

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const service = createServiceClient()
  await service.from('job_time_logs').insert({
    job_id: jobId,
    organization_id: orgId,
    user_id: user.id,
    action: 'clock_in',
    stage,
  })

  redirect(`/dashboard/${orgSlug}/jobs/${jobId}/scan`)
}

export async function clockOut(formData: FormData) {
  const jobId = formData.get('jobId') as string
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const stage = formData.get('stage') as string

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const service = createServiceClient()

  // Find last clock_in for this user + job
  const { data: lastIn } = await service
    .from('job_time_logs')
    .select('scanned_at')
    .eq('job_id', jobId)
    .eq('user_id', user.id)
    .eq('action', 'clock_in')
    .order('scanned_at', { ascending: false })
    .limit(1)

  let durationMinutes: number | null = null
  const lastInRow = (lastIn as { scanned_at: string }[] | null)?.[0]
  if (lastInRow) {
    const inTime = new Date(lastInRow.scanned_at).getTime()
    const now = Date.now()
    durationMinutes = Math.round(((now - inTime) / 60000) * 100) / 100
  }

  await service.from('job_time_logs').insert({
    job_id: jobId,
    organization_id: orgId,
    user_id: user.id,
    action: 'clock_out',
    stage,
    duration_minutes: durationMinutes,
  })

  redirect(`/dashboard/${orgSlug}/jobs/${jobId}/scan`)
}
