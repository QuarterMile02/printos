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

    // 2. Line items — invoices → sales_orders.quote_id → quote_line_items
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

    // 3. Per-line income account from products.income_account (fallback "Sales:Signs")
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
    const DEFAULT_INCOME_ACCOUNT = 'Sales:Signs'

    // 4. Build IIF content
    const cust = customerName(inv.customers)
    const dateStr = formatDate(inv.created_at)
    const invNumStr = `INV-${String(inv.invoice_number).padStart(4, '0')}`
    const memo = inv.notes ?? ''

    const TRNSTYPE = 'INVOICE'
    const lines: string[] = []

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
        'Accounts Receivable',
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

    // Tax split (if any) — negative, into a Sales-Tax Payable account
    if (inv.tax_total > 0) {
      lines.push(
        [
          'SPL',
          '',
          TRNSTYPE,
          dateStr,
          'Sales Tax Payable',
          iif(cust),
          (-(inv.tax_total / 100)).toFixed(2),
          'Sales Tax',
          '',                         // no qty
          '',                         // no price
          '',                         // no item
        ].join('\t'),
      )
    }

    lines.push('ENDTRNS')

    // QB Desktop expects CRLF line endings.
    const iifBody = lines.join('\r\n') + '\r\n'

    const filename = `QMI-INV-${String(inv.invoice_number).padStart(4, '0')}-${formatDateForFilename(inv.created_at)}.iif`

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
