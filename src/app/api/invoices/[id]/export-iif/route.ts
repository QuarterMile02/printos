import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type InvoiceRow = {
  id: string
  organization_id: string
  invoice_number: number
  total: number
  tax_total: number
  subtotal: number
  notes: string | null
  due_date: string | null
  sales_order_id: string | null
  customer_id: string | null
  created_at: string
  customers: {
    first_name: string | null
    last_name: string | null
    company_name: string | null
  } | null
}

type LineItem = {
  product_id: string | null
  product_name: string | null
  description: string | null
  quantity: number
  unit_price: number
  total_price: number
  sort_order: number | null
}

// IIF is tab-separated. Strip tabs/newlines from any field so columns
// stay aligned, and default null/empty to a single space so QB doesn't
// collapse columns.
function iif(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = typeof value === 'number' ? String(value) : value
  return s.replace(/[\t\r\n]+/g, ' ').trim()
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${d.getFullYear()}`
}

function formatDateForFilename(iso: string): string {
  const d = new Date(iso)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// QuickBooks customer name — prefer Company, fallback to "First Last".
function customerName(c: InvoiceRow['customers']): string {
  if (!c) return 'Unknown Customer'
  if (c.company_name && c.company_name.trim()) return c.company_name.trim()
  const first = (c.first_name ?? '').trim()
  const last = (c.last_name ?? '').trim()
  const joined = [first, last].filter(Boolean).join(' ')
  return joined || 'Unknown Customer'
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const service = createServiceClient()

    // 1. Invoice + customer
    const { data: invRow, error: invErr } = await service
      .from('invoices')
      .select(
        'id, organization_id, invoice_number, total, tax_total, subtotal, notes, due_date, sales_order_id, customer_id, created_at, customers(first_name, last_name, company_name)',
      )
      .eq('id', id)
      .maybeSingle()
    if (invErr) throw new Error(`invoice fetch: ${invErr.message}`)
    const inv = invRow as InvoiceRow | null
    if (!inv) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // 2. Org profile (for filename) + account mappings
    const { data: orgProfile } = await service
      .from('org_profile')
      .select('legal_name, dba_name')
      .eq('organization_id', inv.organization_id)
      .maybeSingle()

    const { data: accountMappings } = await service
      .from('account_mapping')
      .select('mapping_key, account_name, account_number')
      .eq('organization_id', inv.organization_id)

    const acct = (key: string, fallback: string) =>
      accountMappings?.find((m) => m.mapping_key === key)?.account_name ?? fallback

    // 3. Line items — invoices → sales_orders.quote_id → quote_line_items
    let lineItems: LineItem[] = []
    if (inv.sales_order_id) {
      const { data: soRow } = await service
        .from('sales_orders')
        .select('quote_id')
        .eq('id', inv.sales_order_id)
        .maybeSingle()
      const quoteId = (soRow as { quote_id: string | null } | null)?.quote_id
      if (quoteId) {
        const { data: li } = await service
          .from('quote_line_items')
          .select('product_id, product_name, description, quantity, unit_price, total_price, sort_order')
          .eq('quote_id', quoteId)
          .order('sort_order')
        lineItems = (li ?? []) as LineItem[]
      }
    }

    // 3. Per-line income account from products.income_account (fallback to
    // qb_settings.default_income_account, which is "Sales" for QMI's COA).
    const productIds = Array.from(new Set(lineItems.map((l) => l.product_id).filter(Boolean))) as string[]
    const incomeAccountById = new Map<string, string>()
    if (productIds.length > 0) {
      const { data: productRows } = await service
        .from('products')
        .select('id, income_account')
        .in('id', productIds)
      for (const p of ((productRows ?? []) as { id: string; income_account: string | null }[])) {
        if (p.income_account && p.income_account.trim()) {
          incomeAccountById.set(p.id, p.income_account.trim())
        }
      }
    }

    // 3b. Load org-level QB account names. qb_settings may not be applied
    // yet; fall back to QMI's hardcoded chart-of-accounts strings so the
    // export still produces a valid IIF that matches QB Desktop exactly.
    type QbSettingsRow = {
      ar_account: string | null
      default_income_account: string | null
      tax_payable_account: string | null
    }
    let qbSettings: QbSettingsRow | null = null
    try {
      const { data } = await service
        .from('qb_settings')
        .select('ar_account, default_income_account, tax_payable_account')
        .eq('organization_id', inv.organization_id)
        .maybeSingle() as { data: QbSettingsRow | null; error: unknown }
      qbSettings = data
    } catch { /* qb_settings table not applied — use defaults */ }

    const AR_ACCOUNT = qbSettings?.ar_account?.trim() || acct('accounts_receivable', 'Accounts Receivable')
    const DEFAULT_INCOME_ACCOUNT = qbSettings?.default_income_account?.trim() || acct('sales_income', 'Sales')
    const TAX_PAYABLE_ACCOUNT = qbSettings?.tax_payable_account?.trim() || acct('sales_tax_payable', 'Sales Tax')

    // 4. Build IIF content
    const cust = customerName(inv.customers)
    const dateStr = formatDate(inv.created_at)
    const invNumStr = `INV-${String(inv.invoice_number).padStart(4, '0')}`
    const memo = inv.notes ?? ''

    const TRNSTYPE = 'INVOICE'
    const lines: string[] = []

    // Collect unique SERVICE item names for the INVITEM auto-create block.
    // Same name derivation used in the SPL rows below.
    const serviceItemNames = new Set<string>(['Custom Item'])
    for (const li of lineItems) {
      const name = li.product_name ?? li.description ?? 'Product'
      if (name) serviceItemNames.add(iif(name))
    }

    // INVITEM block — must come before !TRNS so QB Desktop creates any
    // missing items on import rather than rejecting the transaction.
    // Note: "Sales Tax" is intentionally NOT declared here. QuickBooks IIF
    // does not support creating tax items via import (TAX is not a valid
    // INVITEMTYPE) — the "Sales Tax" item must already exist in QuickBooks,
    // and is referenced by name only on the SPL line below.
    lines.push('!INVITEM\tNAME\tINVITEMTYPE\tACCNT\tPRICE\tCOST\tDESC')
    for (const name of serviceItemNames) {
      lines.push(`INVITEM\t${name}\tSERVICE\t${DEFAULT_INCOME_ACCOUNT}\t0\t0\t${name}`)
    }

    // Headers
    lines.push('!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO')
    lines.push('!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO\tQNTY\tPRICE\tINVITEM')
    lines.push('!ENDTRNS')

    // TRNS row — AR debit for the full invoice total (positive)
    const totalDollars = (inv.total / 100).toFixed(2)
    lines.push(
      [
        'TRNS',
        '',                           // TRNSID — let QB assign
        TRNSTYPE,
        dateStr,
        AR_ACCOUNT,
        iif(cust),
        totalDollars,
        iif(invNumStr),
        iif(memo),
      ].join('\t'),
    )

    // SPL rows — one per line item, amount NEGATIVE (income credit)
    for (const li of lineItems) {
      const account =
        (li.product_id && incomeAccountById.get(li.product_id)) ?? DEFAULT_INCOME_ACCOUNT
      const lineTotal = -(li.total_price / 100)
      const unitPrice = (li.unit_price / 100).toFixed(2)
      const itemName = li.product_name ?? li.description ?? 'Product'
      const itemMemo = li.description ?? itemName
      lines.push(
        [
          'SPL',
          '',                         // SPLID — let QB assign
          TRNSTYPE,
          dateStr,
          iif(account),
          iif(cust),
          lineTotal.toFixed(2),
          iif(itemMemo),
          String(li.quantity),
          unitPrice,
          iif(itemName),
        ].join('\t'),
      )
    }

    // Tax split (if any) — negative, into the QB sales-tax payable account.
    // QMI's COA uses "Sales tax" (account 2010). Freight is intentionally
    // omitted: the spec says no QB account is mapped for freight, so we
    // don't emit an SPL line for it even when the invoice has a freight charge.
    if (inv.tax_total > 0) {
      lines.push(
        [
          'SPL',
          '',
          TRNSTYPE,
          dateStr,
          TAX_PAYABLE_ACCOUNT,
          iif(cust),
          (-(inv.tax_total / 100)).toFixed(2),
          'Sales Tax',
          '',                         // no qty
          '',                         // no price
          'Sales Tax',                // INVITEM
        ].join('\t'),
      )
    }

    lines.push('ENDTRNS')

    // QB Desktop expects CRLF line endings.
    const iifBody = lines.join('\r\n') + '\r\n'

    const orgSlug = (orgProfile?.dba_name ?? orgProfile?.legal_name ?? 'QMI').replace(/\s+/g, '-')
    const filename = `${orgSlug}-INV-${String(inv.invoice_number).padStart(4, '0')}-${formatDateForFilename(inv.created_at)}.iif`

    return new NextResponse(iifBody, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[/api/invoices/[id]/export-iif] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}
