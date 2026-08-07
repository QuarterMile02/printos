import { createServiceClient } from '@/lib/supabase/server'

export interface LogActivityParams {
  org_id: string
  // Nullable for the one legitimate "no staff user" case: a customer
  // acting on their own emailed proof-review link (respond-to-proof-core.ts)
  // has no auth.users id at all. activity_log.user_id is already a
  // nullable FK — every existing staff-initiated call site still passes a
  // real id, this only widens the type to let that one caller pass null.
  user_id: string | null
  entity_type: 'quote' | 'sales_order' | 'job' | 'invoice' | 'proof' | 'customer' | 'qr_scan'
  entity_id: string
  action: string
  from_value?: string
  to_value?: string
  qr_scan_location?: string
  equipment_name?: string
  department_code?: string
  duration_seconds?: number
  metadata?: Record<string, unknown>
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('activity_log').insert({
    org_id: params.org_id,
    user_id: params.user_id,
    entity_type: params.entity_type,
    entity_id: params.entity_id,
    action: params.action,
    from_value: params.from_value ?? null,
    to_value: params.to_value ?? null,
    qr_scan_location: params.qr_scan_location ?? null,
    equipment_name: params.equipment_name ?? null,
    department_code: params.department_code ?? null,
    duration_seconds: params.duration_seconds ?? null,
    metadata: params.metadata ?? null,
  })
  if (error) {
    console.error('[logActivity] failed:', error.message, params)
  }
}
