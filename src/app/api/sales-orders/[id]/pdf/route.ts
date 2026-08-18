import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { renderToBuffer } from '@react-pdf/renderer'
import QuoteDocument, { type QuotePdfData, type QuotePdfLineItem, type OrgProfile } from '@/lib/pdf/quote-document'
import { formatSoNumber } from '@/app/(dashboard)/dashboard/[slug]/quotes/format'
import { resolveTaxRateForCustomer } from '@/lib/tax-rate'
import React from 'react'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const service = createServiceClient()

    // 1. Fetch the sales order to get organization_id (service client, no RLS)
    type SoOrgRow = { organization_id: string; so_number: number; title: string | null; status: string; quote_id: string | null; customer_id: string | null; created_at: string; discount_percent: number | null }
    const { data: so } = await service
      .from('sales_orders')
      .select('organization_id, so_number, title, status, quote_id, customer_id, created_at, discount_percent')
      .eq('id', id)
      .maybeSingle() as { data: SoOrgRow | null; error: unknown }
    if (!so) {
      return NextResponse.json({ error: 'Sales order not found' }, { status: 404 })
    }

    // 2. Permission gate
    const { allowed } = await checkPermission(so.organization_id, 'quotes.export_pdf')
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 3. Fetch linked quote for line item totals, terms, notes, etc.
    type QuoteRow = {
      id: string; terms: string | null; notes: string | null
      subtotal: number | null; tax_total: number | null; total: number | null
      po_number: string | null; sales_rep_id: string | null
      due_date: string | null; expires_at: string | null
    }
    let quoteRow: QuoteRow | null = null
    if (so.quote_id) {
      const { data } = await service
        .from('quotes')
        .select('id, terms, notes, subtotal, tax_total, total, po_number, sales_rep_id, due_date, expires_at')
        .eq('id', so.quote_id)
        .maybeSingle() as { data: QuoteRow | null; error: unknown }
      quoteRow = data
    }

    // 4. Line items from the linked quote
    // Two-step fetch: retry without modifier_values if the column doesn't exist yet.
    type RawLineItem = { id: string; description: string | null; quantity: number | null; unit_price: number | null; total_price: number | null; discount_percent: number | null; taxable: boolean | null; sort_order: number | null; modifier_values?: Record<string, boolean | number> | null }
    const lineItems: QuotePdfLineItem[] = []
    if (so.quote_id) {
      let rawLineItems: RawLineItem[] = []
      {
        const { data, error } = await service
          .from('quote_line_items')
          .select('id, description, quantity, unit_price, total_price, discount_percent, taxable, sort_order, modifier_values')
          .eq('quote_id', so.quote_id)
          .order('sort_order') as { data: RawLineItem[] | null; error: { message?: string } | null }
        if (data) {
          rawLineItems = data
        } else if (error?.message?.includes('modifier_values')) {
          const { data: legacy } = await service
            .from('quote_line_items')
            .select('id, description, quantity, unit_price, total_price, discount_percent, taxable, sort_order')
            .eq('quote_id', so.quote_id)
            .order('sort_order') as { data: Omit<RawLineItem, 'modifier_values'>[] | null; error: unknown }
          rawLineItems = (legacy ?? []).map((li) => ({ ...li, modifier_values: null }))
        }
      }
      for (const li of rawLineItems) {
        lineItems.push({
          sort_order: li.sort_order ?? 0,
          description: li.description ?? '',
          quantity: li.quantity ?? 1,
          unit_price: li.unit_price ?? 0,
          total_price: li.total_price ?? 0,
          discount_percent: Number(li.discount_percent ?? 0),
          taxable: li.taxable !== false,
          modifier_values: li.modifier_values ?? null,
        })
      }
    }

    // 5. Customer
    type CustomerRow = { company_name: string | null; first_name: string; last_name: string; email: string | null; phone: string | null; street: string | null; city: string | null; state: string | null; zip: string | null; tax_rate: string | null; tax_exempt_code: string | null; tax_exempt_expires: string | null }
    let customer: CustomerRow | null = null
    if (so.customer_id) {
      const { data } = await service
        .from('customers')
        .select('company_name, first_name, last_name, email, phone, street, city, state, zip, tax_rate, tax_exempt_code, tax_exempt_expires')
        .eq('id', so.customer_id)
        .maybeSingle() as { data: CustomerRow | null; error: unknown }
      customer = data
    }

    // Primary contact
    let primaryContact: { full_name: string | null; email: string | null; phone: string | null } | null = null
    if (so.customer_id) {
      const { data: contactRow } = await service
        .from('customer_contacts')
        .select('full_name, email, phone')
        .eq('customer_id', so.customer_id)
        .eq('is_primary', true)
        .maybeSingle()
      primaryContact = contactRow ?? null
    }

    // Default terms from term_codes
    let termsText = quoteRow?.terms ?? null
    if (!termsText) {
      const { data: tc } = await service
        .from('term_codes')
        .select('name')
        .eq('organization_id', so.organization_id)
        .eq('is_default', true)
        .maybeSingle()
      termsText = tc?.name ?? null
    }

    // Modifier display labels
    const allModifierKeys = new Set<string>()
    for (const li of lineItems) {
      if (li.modifier_values) {
        for (const k of Object.keys(li.modifier_values)) allModifierKeys.add(k)
      }
    }
    const modifierLabels: Record<string, string> = {}
    if (allModifierKeys.size > 0) {
      const keys = [...allModifierKeys]
      const { data: modRows } = await service
        .from('modifiers')
        .select('id, system_lookup_name, display_name')
        .in('id', keys)
      for (const m of modRows ?? []) {
        modifierLabels[m.id] = m.display_name
        if (m.system_lookup_name) modifierLabels[m.system_lookup_name] = m.display_name
      }
      const unmatchedKeys = keys.filter(k => !modifierLabels[k])
      if (unmatchedKeys.length > 0) {
        const { data: modRows2 } = await service
          .from('modifiers')
          .select('id, system_lookup_name, display_name')
          .in('system_lookup_name', unmatchedKeys)
        for (const m of modRows2 ?? []) {
          modifierLabels[m.id] = m.display_name
          if (m.system_lookup_name) modifierLabels[m.system_lookup_name] = m.display_name
        }
      }
    }

    // 6. Document settings
    type DocSettingsRow = {
      show_signature_line: boolean; show_tax_line: boolean
      footer_note: string | null; terms_and_conditions: string | null
    }
    const { data: docSettings } = await service
      .from('document_settings')
      .select('show_signature_line, show_tax_line, footer_note, terms_and_conditions')
      .eq('organization_id', so.organization_id)
      .eq('document_type', 'sales_order')
      .maybeSingle() as { data: DocSettingsRow | null; error: unknown }

    // 7. Org profile
    const { data: orgProfileRow } = await service
      .from('org_profile')
      .select('legal_name, dba_name, phone, email, street, city, state, zip, logo_url, tagline, footer_note')
      .eq('organization_id', so.organization_id)
      .maybeSingle()
    const orgProfile: OrgProfile = orgProfileRow ?? {
      legal_name: 'Quarter Mile Inc.',
      dba_name: null,
      phone: '(956) 722-7690',
      email: 'sales@quartermileinc.com',
      street: '6420 Polaris Dr. Ste 4',
      city: 'Laredo',
      state: 'TX',
      zip: '78041',
      logo_url: null,
      tagline: 'Get it Done Right the First Time!',
      footer_note: null,
    }

    // 7b. Tax rate — resolved per customer (exemption -> customer rate ->
    // org default), not hardcoded. Throws if the org has no default
    // sales_taxes row, which the outer try/catch turns into a real error
    // response rather than a silently-wrong PDF.
    const { rate: taxRate } = await resolveTaxRateForCustomer(
      service,
      so.organization_id,
      so.customer_id,
    )

    // 8. Build PDF data
    const soNumber = formatSoNumber(so.so_number, so.created_at)
    const pdfData: QuotePdfData = {
      quoteNumber: soNumber,
      date: so.created_at,
      expiresAt: null,
      title: so.title ?? soNumber,
      terms: termsText,
      notes: quoteRow?.notes ?? null,
      customer: {
        company_name: customer?.company_name ?? null,
        full_name: primaryContact?.full_name ?? (customer ? `${customer.first_name} ${customer.last_name}`.trim() : null),
        street: customer?.street ?? null,
        city: customer?.city ?? null,
        state: customer?.state ?? null,
        zip: customer?.zip ?? null,
        email: primaryContact?.email ?? customer?.email ?? null,
        phone: primaryContact?.phone ?? customer?.phone ?? null,
      },
      lineItems,
      discountPercent: so.discount_percent ?? 0,
      taxRate,
      modifierLabels,
      org: orgProfile,
    }

    // 9. Render PDF
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = React.createElement(QuoteDocument as any, {
      data: pdfData,
      documentType: 'Sales Order',
      documentNumber: soNumber,
      options: {
        showSignatureLine: docSettings?.show_signature_line !== false,
        showTaxLine: docSettings?.show_tax_line !== false,
        footerNote: docSettings?.footer_note ?? null,
        termsAndConditions: docSettings?.terms_and_conditions ?? null,
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer: Buffer = await (renderToBuffer as any)(element)

    const customerName = customer?.company_name ?? (customer ? `${customer.first_name} ${customer.last_name}`.trim() : 'Unknown')
    const filename = `sales-order-${soNumber}-${customerName}.pdf`
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[/api/sales-orders/[id]/pdf] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}
