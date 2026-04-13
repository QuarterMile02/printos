'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole, SalesOrderStatus } from '@/types/database'

const MANUAL_STATUSES: SalesOrderStatus[] = [
  'hold', 'no_charge', 'no_charge_approved', 'void',
]

export async function updateSalesOrderStatus(
  soId: string,
  orgId: string,
  orgSlug: string,
  status: SalesOrderStatus,
): Promise<{ error?: string }> {
  if (!MANUAL_STATUSES.includes(status)) {
    return { error: 'This status can only be set automatically.' }
  }

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
  if (membership.role === 'viewer') return { error: 'Viewers cannot update sales orders.' }

  const service = createServiceClient()
  const { error } = await service
    .from('sales_orders')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', soId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/sales-orders`)
  revalidatePath(`/dashboard/${orgSlug}/sales-orders/${soId}`)
  return {}
}
