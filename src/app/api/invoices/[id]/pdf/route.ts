import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { renderToBuffer } from '@react-pdf/renderer'
import QuoteDocument, { type QuotePdfData, type QuotePdfLineItem, type OrgProfile } from '@/lib/pdf/quote-document'
import { formatInvNumber } from '@/app/(dashboard)/dashboard/[slug]/invoices/format'
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

    // 1. Fetch the invoice (service client, no RLS)
    type InvRow = {
      organization_id: string; sales_order_id: string | null; customer_id: string | null
      invoice_number: number; status: string
      subtotal: number | null; tax_total: number | null; total: number | null
      discount_percent: number | null
      amount_paid: number | null; balance_due: number | null
      due_date: string | null; notes: string | null; created_at: string
    }
    const { data: inv } = await service
      .from('invoices')
      .select('organization_id, sales_order_id, customer_id, invoice_number, status, subtotal, tax_total, total, discount_percent, amount_paid, balance_due, due_date, notes, created_at')
      .eq('id', id)
      .maybeSingle() as { data: InvRow | null; error: unknown }
    if (!inv) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // 2. Permission gate
    const { allowed } = await checkPermission(inv.organization_id, 'quotes.export_pdf')
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 3. Fetch linked SO to get quote_id and title
    type SoRow = { quote_id: string | null; title: string | null; po_number: string | null }
    let soRow: SoRow | null = null
    if (inv.sales_order_id) {
      const { data } = await service
        .from('sales_orders')
        .select('quote_id, title, po_number')
        .eq('id', inv.sales_order_id)
        .maybeSingle() as { data: SoRow | null; error: unknown }
      soRow = data
    }

    const quoteId = soRow?.quote_id ?? null

    // 4. Fetch quote for terms and notes
    type QuoteRow = { terms: string | null; notes: string | null }
    let quoteRow: QuoteRow | null = null
    if (quoteId) {
      const { data } = await service
        .from('quotes')
        .select('terms, notes')
        .eq('id', quoteId)
        .maybeSingle() as { data: QuoteRow | null; error: unknown }
      quoteRow = data
    }

    // 5. Line items from the linked quote
    // Two-step fetch: retry without modifier_values if the column doesn't exist yet.
    type RawLineItem = { id: string; description: string | null; quantity: number | null; unit_price: number | null; total_price: number | null; discount_percent: number | null; taxable: boolean | null; sort_order: number | null; modifier_values?: Record<string, boolean | number> | null }
    const lineItems: QuotePdfLineItem[] = []
    if (quoteId) {
      let rawLineItems: RawLineItem[] = []
      {
        const { data, error } = await service
          .from('quote_line_items')
          .select('id, description, quantity, unit_price, total_price, discount_percent, taxable, sort_order, modifier_values')
          .eq('quote_id', quoteId)
          .order('sort_order') as { data: RawLineItem[] | null; error: { message?: string } | null }
        if (data) {
          rawLineItems = data
        } else if (error?.message?.includes('modifier_values')) {
          const { data: legacy } = await service
            .from('quote_line_items')
            .select('id, description, quantity, unit_price, total_price, discount_percent, taxable, sort_order')
            .eq('quote_id', quoteId)
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

    // 6. Customer
    type CustomerRow = { company_name: string | null; first_name: string; last_name: string; email: string | null; phone: string | null; street: string | null; city: string | null; state: string | null; zip: string | null; tax_rate: string | null; tax_exempt_code: string | null; tax_exempt_expires: string | null }
    let customer: CustomerRow | null = null
    if (inv.customer_id) {
      const { data } = await service
        .from('customers')
        .select('company_name, first_name, last_name, email, phone, street, city, state, zip, tax_rate, tax_exempt_code, tax_exempt_expires')
        .eq('id', inv.customer_id)
        .maybeSingle() as { data: CustomerRow | null; error: unknown }
      customer = data
    }

    // Primary contact
    let primaryContact: { full_name: string | null; email: string | null; phone: string | null } | null = null
    if (inv.customer_id) {
      const { data: contactRow } = await service
        .from('customer_contacts')
        .select('full_name, email, phone')
        .eq('customer_id', inv.customer_id)
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
        .eq('organization_id', inv.organization_id)
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

    // 7. Document settings
    type DocSettingsRow = {
      show_signature_line: boolean; show_tax_line: boolean
      footer_note: string | null; terms_and_conditions: string | null
    }
    const { data: docSettings } = await service
      .from('document_settings')
      .select('show_signature_line, show_tax_line, footer_note, terms_and_conditions')
      .eq('organization_id', inv.organization_id)
      .eq('document_type', 'invoice')
      .maybeSingle() as { data: DocSettingsRow | null; error: unknown }

    // 8. Org profile
    const { data: orgProfileRow } = await service
      .from('org_profile')
      .select('legal_name, dba_name, phone, email, street, city, state, zip, logo_url, tagline, footer_note')
      .eq('organization_id', inv.organization_id)
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

    // 8b. Tax rate — resolved per customer (exemption -> customer rate ->
    // org default), not hardcoded. Throws if the org has no default
    // sales_taxes row, which the outer try/catch turns into a real error
    // response rather than a silently-wrong PDF.
    const { rate: taxRate } = await resolveTaxRateForCustomer(
      service,
      inv.organization_id,
      inv.customer_id,
    )

    // 9. Build PDF data
    const invNumber = formatInvNumber(inv.invoice_number, inv.created_at)
    const pdfData: QuotePdfData = {
      quoteNumber: invNumber,
      date: inv.created_at,
      expiresAt: inv.due_date ?? null,
      title: soRow?.title ?? invNumber,
      terms: termsText,
      notes: inv.notes,
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
      discountPercent: inv.discount_percent ?? 0,
      taxRate,
      modifierLabels,
      org: orgProfile,
      ...(inv.amount_paid != null ? { amountPaid: inv.amount_paid } : {}),
      ...(inv.balance_due != null ? { balanceDue: inv.balance_due } : {}),
    }

    // 10. Render PDF
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = React.createElement(QuoteDocument as any, {
      data: pdfData,
      documentType: 'Invoice',
      documentNumber: invNumber,
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
    const filename = `invoice-${invNumber}-${customerName}.pdf`
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[/api/invoices/[id]/pdf] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}
