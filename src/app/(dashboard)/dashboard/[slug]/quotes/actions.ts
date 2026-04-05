'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole, QuoteStatus } from '@/types/database'

const VALID_STATUSES: QuoteStatus[] = ['draft', 'sent', 'approved', 'declined']

type LineItemInput = {
  description: string
  quantity: number
  unit_price: number
}

export async function createQuote(
  orgId: string,
  orgSlug: string,
  data: {
    title: string
    customerId: string | null
    description: string | null
    lineItems: LineItemInput[]
  }
): Promise<{ error?: string }> {
  if (!data.title.trim()) return { error: 'Title is required.' }
  if (data.lineItems.length === 0) return { error: 'At least one line item is required.' }

  for (let i = 0; i < data.lineItems.length; i++) {
    const item = data.lineItems[i]
    if (!item.description.trim()) return { error: `Line item ${i + 1} needs a description.` }
    if (item.quantity < 1) return { error: `Line item ${i + 1} quantity must be at least 1.` }
    if (item.unit_price < 0) return { error: `Line item ${i + 1} unit price cannot be negative.` }
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
  if (membership.role === 'viewer') return { error: 'Viewers cannot create quotes.' }

  const service = createServiceClient()

  // Insert quote — quote_number is set by trigger
  const { data: quote, error: quoteError } = await service
    .from('quotes')
    .insert({
      organization_id: orgId,
      customer_id: data.customerId || null,
      title: data.title.trim(),
      description: data.description?.trim() || null,
      status: 'draft' as QuoteStatus,
    })
    .select('id')
    .single()

  if (quoteError || !quote) return { error: quoteError?.message ?? 'Failed to create quote.' }

  // Insert line items
  const lineItemRows = data.lineItems.map((item, i) => ({
    quote_id: quote.id,
    description: item.description.trim(),
    quantity: item.quantity,
    unit_price: item.unit_price,
    sort_order: i,
  }))

  const { error: itemsError } = await service
    .from('quote_line_items')
    .insert(lineItemRows)

  if (itemsError) return { error: itemsError.message }

  revalidatePath(`/dashboard/${orgSlug}/quotes`)
  return {}
}

export async function updateQuoteStatus(
  quoteId: string,
  orgId: string,
  orgSlug: string,
  status: QuoteStatus
): Promise<{ error?: string }> {
  if (!VALID_STATUSES.includes(status)) return { error: 'Invalid status.' }

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
  if (membership.role === 'viewer') return { error: 'Viewers cannot update quotes.' }

  const service = createServiceClient()
  const { error: updateError } = await service
    .from('quotes')
    .update({ status })
    .eq('id', quoteId)
    .eq('organization_id', orgId)

  if (updateError) return { error: updateError.message }

  revalidatePath(`/dashboard/${orgSlug}/quotes`)
  return {}
}
