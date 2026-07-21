'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

function rev(orgSlug: string) {
  revalidatePath(`/dashboard/${orgSlug}/settings/accounting`)
}

// ─── Accounting Settings ────────────────────────────────────────────────────

export async function upsertAccountingSettings(
  orgId: string,
  orgSlug: string,
  patch: Partial<{
    accounting_method: string
    program_fee_credit_card: number
    program_fee_debit_card: number
    program_fee_taxable: boolean
    program_fee_show_disclosure: boolean
  }>,
): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc
    .from('accounting_settings')
    .upsert({ organization_id: orgId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

// ─── Sales Taxes ────────────────────────────────────────────────────────────

type SalesTaxData = {
  name: string
  agency?: string | null
  description?: string | null
  rate?: number
  is_split?: boolean
  tax_code?: string | null
  is_default?: boolean
  sort_order?: number
}

export async function createSalesTax(
  orgId: string,
  orgSlug: string,
  data: SalesTaxData,
): Promise<{ data?: Record<string, unknown>; error?: string }> {
  const svc = createServiceClient()
  const { data: row, error } = await svc
    .from('sales_taxes')
    .insert({ organization_id: orgId, ...data })
    .select()
    .single()
  if (error) return { error: error.message }
  rev(orgSlug)
  return { data: row as Record<string, unknown> }
}

export async function updateSalesTax(
  id: string,
  orgId: string,
  orgSlug: string,
  data: Partial<SalesTaxData>,
): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc
    .from('sales_taxes')
    .update(data)
    .eq('id', id)
    .eq('organization_id', orgId)
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

export async function deleteSalesTax(id: string, orgId: string, orgSlug: string): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc.from('sales_taxes').delete().eq('id', id).eq('organization_id', orgId)
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

export async function setDefaultSalesTax(id: string, orgId: string, orgSlug: string): Promise<{ error?: string }> {
  const svc = createServiceClient()
  await svc.from('sales_taxes').update({ is_default: false }).eq('organization_id', orgId)
  const { error } = await svc.from('sales_taxes').update({ is_default: true }).eq('id', id).eq('organization_id', orgId)
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

// ─── Term Codes ─────────────────────────────────────────────────────────────

type TermCodeData = {
  name: string
  code_type?: string
  days?: number
  down_payment_percent?: number
  is_default?: boolean
  sort_order?: number
}

export async function createTermCode(
  orgId: string,
  orgSlug: string,
  data: TermCodeData,
): Promise<{ data?: Record<string, unknown>; error?: string }> {
  const svc = createServiceClient()
  const { data: row, error } = await svc
    .from('term_codes')
    .insert({ organization_id: orgId, ...data })
    .select()
    .single()
  if (error) return { error: error.message }
  rev(orgSlug)
  return { data: row as Record<string, unknown> }
}

export async function updateTermCode(
  id: string,
  orgId: string,
  orgSlug: string,
  data: Partial<TermCodeData>,
): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc.from('term_codes').update(data).eq('id', id).eq('organization_id', orgId)
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

export async function deleteTermCode(id: string, orgId: string, orgSlug: string): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc.from('term_codes').delete().eq('id', id).eq('organization_id', orgId)
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

export async function setDefaultTermCode(id: string, orgId: string, orgSlug: string): Promise<{ error?: string }> {
  const svc = createServiceClient()
  await svc.from('term_codes').update({ is_default: false }).eq('organization_id', orgId)
  const { error } = await svc.from('term_codes').update({ is_default: true }).eq('id', id).eq('organization_id', orgId)
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

// ─── Payment Methods ─────────────────────────────────────────────────────────

type PaymentMethodData = { name: string; type?: string; sort_order?: number }

export async function createPaymentMethod(
  orgId: string,
  orgSlug: string,
  data: PaymentMethodData,
): Promise<{ data?: Record<string, unknown>; error?: string }> {
  const svc = createServiceClient()
  const { data: row, error } = await svc
    .from('payment_methods')
    .insert({ organization_id: orgId, ...data })
    .select()
    .single()
  if (error) return { error: error.message }
  rev(orgSlug)
  return { data: row as Record<string, unknown> }
}

export async function updatePaymentMethod(
  id: string,
  orgId: string,
  orgSlug: string,
  data: Partial<PaymentMethodData>,
): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc.from('payment_methods').update(data).eq('id', id).eq('organization_id', orgId)
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

export async function deletePaymentMethod(id: string, orgId: string, orgSlug: string): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc.from('payment_methods').delete().eq('id', id).eq('organization_id', orgId)
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

// ─── Chart of Accounts ───────────────────────────────────────────────────────

type ChartOfAccountData = { name: string; number?: string | null; type?: string; sort_order?: number }

export async function createChartOfAccount(
  orgId: string,
  orgSlug: string,
  data: ChartOfAccountData,
): Promise<{ data?: Record<string, unknown>; error?: string }> {
  const svc = createServiceClient()
  const { data: row, error } = await svc
    .from('chart_of_accounts')
    .insert({ organization_id: orgId, ...data })
    .select()
    .single()
  if (error) return { error: error.message }
  rev(orgSlug)
  return { data: row as Record<string, unknown> }
}

export async function updateChartOfAccount(
  id: string,
  orgId: string,
  orgSlug: string,
  data: Partial<ChartOfAccountData>,
): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc.from('chart_of_accounts').update(data).eq('id', id).eq('organization_id', orgId)
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

export async function deleteChartOfAccount(id: string, orgId: string, orgSlug: string): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc.from('chart_of_accounts').delete().eq('id', id).eq('organization_id', orgId)
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

// ─── Account Mapping ─────────────────────────────────────────────────────────

export async function updateAccountMapping(
  orgId: string,
  orgSlug: string,
  patch: Partial<Record<string, string | null>>,
): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc
    .from('account_mapping')
    .upsert({ organization_id: orgId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

// ─── Transaction Numbers ──────────────────────────────────────────────────────

export async function updateTransactionNumbers(
  orgId: string,
  orgSlug: string,
  patch: Partial<Record<string, number>>,
): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc
    .from('transaction_numbers')
    .upsert({ organization_id: orgId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}
