'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type TransactionSettingsPatch = Partial<{
  show_parent_description_only: boolean
  check_line_item_minimum_before_discount: boolean
  allow_discount_codes: boolean
  allow_line_item_taxable_override: boolean
  default_include_payment_link: boolean
  down_payment_type: string
  down_payment_amount: number
  default_next_contact_date_days: number
  hide_ordered_quotes: boolean
  hide_invoiced_quotes: boolean
  hide_lost_quotes: boolean
  online_quote_review_by_customer: boolean
  allow_change_financial_info_after_convert: boolean
  default_quote_expiration_days: number
  sync_zero_invoices: boolean
  allow_editing_of_invoice: boolean
  taxes_on_purchase_orders: boolean
  purchase_orders_combine_items: boolean
  default_po_line_item_type: string
  default_inhouse_commission_on: string
  default_outsourced_commission_on: string
  sales_commission_by: string
  setup_charge_default: number
  setup_charge_type: string
  setup_charge_taxable: boolean
  shipping_charge_default: number
  shipping_charge_type: string
  shipping_charge_taxable: boolean
  finance_charge_default: number
  finance_charge_type: string
  finance_charge_taxable: boolean
  misc_charge_default: number
  misc_charge_type: string
  misc_charge_taxable: boolean
  misc_charge_label: string
  copy_transaction_title_to_job: boolean
  keep_job_in_sync_with_line_item: boolean
  allow_jobs_for_quotes: boolean
  allow_jobs_for_invoices: boolean
  allow_jobs_without_downpayment: boolean
  show_customer_pending_balance: boolean
}>

export async function updateTransactionSettings(
  orgId: string,
  orgSlug: string,
  patch: TransactionSettingsPatch,
): Promise<{ error?: string }> {
  const service = createServiceClient()
  const { error } = await service
    .from('transaction_settings')
    .upsert(
      { organization_id: orgId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'organization_id' },
    )
  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/settings/transactions`)
  return {}
}
