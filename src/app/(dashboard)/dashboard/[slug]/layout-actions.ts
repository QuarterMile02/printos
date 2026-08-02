'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// Upsert the user's dashboard layout for one org.
// user_id is read from the server session — never trusted from the client.
export async function saveLayout(
  orgId: string,
  orgSlug: string,
  orderedIds: string[],
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const config = {
    version: 1,
    widgets: orderedIds.map((id, i) => ({ id, visible: true, order: i })),
  }

  const service = createServiceClient()
  const { error } = await service
    .from('dashboard_layouts')
    .upsert(
      {
        user_id: user.id,
        organization_id: orgId,
        widget_config: config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,organization_id' },
    )

  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}`)
  return {}
}

// Delete the user's saved layout — next page load falls back to role default.
export async function resetLayout(
  orgId: string,
  orgSlug: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const service = createServiceClient()
  const { error } = await service
    .from('dashboard_layouts')
    .delete()
    .eq('user_id', user.id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}`)
  return {}
}
