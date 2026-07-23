import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { renderToBuffer } from '@react-pdf/renderer'
import QuoteDocument, { type QuotePdfData, type QuotePdfLineItem, type OrgProfile } from '@/lib/pdf/quote-document'
import { formatQuoteNumber } from '@/app/(dashboard)/dashboard/[slug]/quotes/format'
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

    // 1. Fetch the quote to get organization_id (service client, no RLS)
    const { data: quoteOrg } = await service
      .from('quotes')
      .select('organization_id')
      .eq('id', id)
      .maybeSingle()
    if (!quoteOrg) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    // 2. Permission gate
    const { allowed } = await checkPermission(quoteOrg.organization_id, 'quotes.export_pdf')
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 3. Full quote data
    type QuoteCustomer = {
      id: string; company_name: string | null; first_name: string; last_name: string
      email: string | null; phone: string | null
      street: string | null; city: string | null; state: string | null; zip: string | null
      terms: string | null
    }
    type QuoteRow = {
      id: string; quote_number: number; title: string; description: string | null
      status: string; created_at: string; expires_at: string | null
      terms: string | null; notes: string | null
      subtotal: number | null; tax_total: number | null; total: number | null
      customer_id: string | null
      customers: QuoteCustomer | null
    }
    const { data: quoteRow } = await service
      .from('quotes')
      .select(`
        id, quote_number, title, description, status, created_at, expires_at,
        terms, notes, subtotal, tax_total, total,
        customer_id,
        customers (
          id, company_name, first_name, last_name, email, phone,
          street, city, state, zip, terms
        )
      `)
      .eq('id', id)
      .maybeSingle() as { data: QuoteRow | null; error: unknown }
    if (!quoteRow) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }
    const q = quoteRow

    // 4. Line items (show sell price only — never cost or markup)
    // Two-step fetch: retry without modifier_values if the column doesn't exist yet.
    type RawLineItem = { id: string; description: string | null; quantity: number | null; unit_price: number | null; total_price: number | null; discount_percent: number | null; taxable: boolean | null; sort_order: number | null; modifier_values?: Record<string, boolean | number> | null }
    let rawLineItems: RawLineItem[] = []
    {
      const { data, error } = await service
        .from('quote_line_items')
        .select('id, description, quantity, unit_price, total_price, discount_percent, taxable, sort_order, modifier_values')
        .eq('quote_id', id)
        .order('sort_order') as { data: RawLineItem[] | null; error: { message?: string } | null }
      if (data) {
        rawLineItems = data
      } else if (error?.message?.includes('modifier_values')) {
        const { data: legacy } = await service
          .from('quote_line_items')
          .select('id, description, quantity, unit_price, total_price, discount_percent, taxable, sort_order')
          .eq('quote_id', id)
          .order('sort_order') as { data: Omit<RawLineItem, 'modifier_values'>[] | null; error: unknown }
        rawLineItems = (legacy ?? []).map((li) => ({ ...li, modifier_values: null }))
      }
    }
    const lineItems: QuotePdfLineItem[] = rawLineItems.map((li) => ({
      sort_order: li.sort_order ?? 0,
      description: li.description ?? '',
      quantity: li.quantity ?? 1,
      unit_price: li.unit_price ?? 0,
      total_price: li.total_price ?? 0,
      discount_percent: Number(li.discount_percent ?? 0),
      taxable: li.taxable !== false,
      modifier_values: li.modifier_values ?? null,
    }))

    // 5. Primary contact
    let primaryContact: { full_name: string | null; email: string | null; phone: string | null } | null = null
    if (q.customer_id) {
      const { data: contactRow } = await service
        .from('customer_contacts')
        .select('full_name, email, phone')
        .eq('customer_id', q.customer_id)
        .eq('is_primary', true)
        .maybeSingle()
      primaryContact = contactRow ?? null
    }

    // 6. Deposit percent from the customer's assigned term code
    let depositPercent = 0
    let depositAmount = 0
    const customerTermsName = q.customers?.terms ?? null
    if (customerTermsName) {
      const { data: tcDeposit } = await service
        .from('term_codes')
        .select('down_payment_percent')
        .eq('organization_id', quoteOrg.organization_id)
        .eq('name', customerTermsName)
        .maybeSingle()
      const pct = Number(tcDeposit?.down_payment_percent ?? 0)
      if (pct > 0) {
        depositPercent = pct
        depositAmount = Math.round((q.total ?? 0) * pct / 100)
      }
    }

    // 7. Default terms from term_codes
    let termsText = q.terms ?? null
    if (!termsText) {
      const { data: tc } = await service
        .from('term_codes')
        .select('name')
        .eq('organization_id', quoteOrg.organization_id)
        .eq('is_default', true)
        .maybeSingle()
      termsText = tc?.name ?? null
    }

    // 8. Modifier display labels (for modifier_values keys in line items)
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
      // Also try system_lookup_name match for any remaining keys
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

    // 8. Document settings
    type DocSettingsRow = {
      show_signature_line: boolean; show_deposit_line: boolean; show_tax_line: boolean
      footer_note: string | null; terms_and_conditions: string | null
    }
    const { data: docSettings } = await service
      .from('document_settings')
      .select('show_signature_line, show_deposit_line, show_tax_line, footer_note, terms_and_conditions')
      .eq('organization_id', quoteOrg.organization_id)
      .eq('document_type', 'quote')
      .maybeSingle() as { data: DocSettingsRow | null; error: unknown }

    // 9. Org profile for header/footer
    const { data: orgProfileRow } = await service
      .from('org_profile')
      .select('legal_name, dba_name, phone, email, street, city, state, zip, logo_url, tagline, footer_note')
      .eq('organization_id', quoteOrg.organization_id)
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
      tax_rate: 0.0825,
    }

    // 10. Build PDF data
    const cust = q.customers
    const pdfData: QuotePdfData = {
      quoteNumber: formatQuoteNumber(q.quote_number, q.created_at),
      date: q.created_at,
      expiresAt: q.expires_at,
      title: q.title,
      terms: termsText,
      notes: q.notes,
      customer: {
        company_name: cust?.company_name ?? null,
        full_name: primaryContact?.full_name ?? (cust ? `${cust.first_name} ${cust.last_name}`.trim() : null),
        street: cust?.street ?? null,
        city: cust?.city ?? null,
        state: cust?.state ?? null,
        zip: cust?.zip ?? null,
        email: primaryContact?.email ?? cust?.email ?? null,
        phone: primaryContact?.phone ?? cust?.phone ?? null,
      },
      lineItems,
      discountPercent: 0,
      modifierLabels,
      org: orgProfile,
      ...(depositPercent > 0 ? { depositPercent, depositAmount } : {}),
    }

    // 11. Render PDF
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = React.createElement(QuoteDocument as any, {
      data: pdfData,
      options: {
        showSignatureLine: docSettings?.show_signature_line !== false,
        showDepositLine: docSettings?.show_deposit_line !== false,
        showTaxLine: docSettings?.show_tax_line !== false,
        footerNote: docSettings?.footer_note ?? null,
        termsAndConditions: docSettings?.terms_and_conditions ?? null,
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer: Buffer = await (renderToBuffer as any)(element)

    const filename = `Quote-${pdfData.quoteNumber}.pdf`
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[/api/quotes/[id]/pdf] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}
