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
  // Migration 132 additions — field-level diff support.
  // field_name: set only on field-level diff rows (action='field_changed');
  //   leave unset for status-transition rows, same as every call site today.
  // change_group_id: one uuid shared across every field-diff row a single
  //   save produced, so a multi-field edit renders as one grouped event.
  // order_thread_id: the anchor id (originating quote_id, or sales_order_id
  //   if there's no quote) tying one order's full lifecycle together across
  //   quote/SO/job/invoice, for the centralized audit view.
  field_name?: string
  change_group_id?: string
  order_thread_id?: string
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('activity_log').insert({
    // Bug fix (schema-drift-findings.md Section 9): the table's real
    // column is organization_id, not org_id — every insert here was
    // silently failing (masked until now by the table itself also being
    // missing, per the same finding).
    organization_id: params.org_id,
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
    field_name: params.field_name ?? null,
    change_group_id: params.change_group_id ?? null,
    order_thread_id: params.order_thread_id ?? null,
  })
  if (error) {
    console.error('[logActivity] failed:', error.message, params)
  }
}
