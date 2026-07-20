'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type NotificationPatch = {
  channel_email?: boolean
  channel_sms?: boolean
  channel_inapp?: boolean
  notify_sales_rep?: boolean
  notify_production_manager?: boolean
  notify_assignee?: boolean
  notify_designer?: boolean
  notify_roles?: string[]
}

export async function updateNotificationSetting(
  orgId: string,
  orgSlug: string,
  eventGroup: string,
  eventName: string,
  patch: NotificationPatch,
): Promise<{ error?: string }> {
  const service = createServiceClient()
  const { error } = await service
    .from('notification_settings')
    .upsert(
      {
        organization_id: orgId,
        event_group: eventGroup,
        event_name: eventName,
        ...patch,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,event_group,event_name' },
    )
  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/settings/notifications`)
  return {}
}
