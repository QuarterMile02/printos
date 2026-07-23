'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type DocumentSettingsInput = {
  show_signature_line: boolean
  show_deposit_line: boolean
  show_pricing: boolean
  show_unit_price: boolean
  show_line_totals: boolean
  show_subtotal: boolean
  show_tax_line: boolean
  show_production_notes: boolean
  paper_size: string
  terms_and_conditions: string | null
  footer_note: string | null
}

export async function upsertDocumentSettings(
  orgId: string,
  orgSlug: string,
  documentType: 'quote' | 'sales_order' | 'invoice' | 'purchase_order',
  settings: DocumentSettingsInput,
): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc
    .from('document_settings')
    .upsert(
      {
        organization_id: orgId,
        document_type: documentType,
        ...settings,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,document_type' },
    )
  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/settings/documents`)
  return {}
}
