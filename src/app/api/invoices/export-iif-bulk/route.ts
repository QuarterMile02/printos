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

function customerName(c: InvoiceRow['customers']): string {
  if (!c) return 'Unknown Customer'
  if (c.company_name && c.company_name.trim()) return c.company_name.trim()
  const first = (c.first_name ?? '').trim()
  const last = (c.last_name ?? '').trim()
  const joined = [first, last].filter(Boolean).join(' ')
  return joined || 'Unknown Customer'
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { invoiceIds?: string[]; organizationId?: string }
    const { invoiceIds, organizationId } = body

    if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return NextResponse.json({ error: 'invoiceIds must be a non-empty array' }, { status: 400 })
    }
    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }

    const service = createServiceClient()

    // 1. Fetch all invoices (validate they belong to the org)
    const { data: invRows, error: invErr } = await service
      .from('invoices')
      .select('id, organization_id, invoice_number, total, tax_total, subtotal, notes, due_date, sales_order_id, customer_id, created_at, customers(first_name, last_name, company_name)')
      .eq('organization_id', organizationId)
      .in('id', invoiceIds)
    if (invErr) throw new Error(`invoice fetch: ${invErr.message}`)
    const invoices = (invRows ?? []) as unknown as InvoiceRow[]

    if (invoices.length === 0) {
      return NextResponse.json({ error: 'No matching invoices found' }, { status: 404 })
    }

    // 2. Org profile + account mappings + QB settings (fetched once)
    const [orgProfileRes, accountMappingsRes] = await Promise.all([
      service.from('org_profile').select('legal_name, dba_name').eq('organization_id', organizationId).maybeSingle(),
      service.from('account_mapping').select('mapping_key, account_name, account_number').eq('organization_id', organizationId),
    ])

    const orgProfile = orgProfileRes.data
    const accountMappings = accountMappingsRes.data

    type QbSettingsRow = { ar_account: string | null; default_income_account: string | null; tax_payable_account: string | null }
    let qbSettings: QbSettingsRow | null = null
    try {
      const { data } = await service
        .from('qb_settings')
        .select('ar_account, default_income_account, tax_payable_account')
        .eq('organization_id', organizationId)
        .maybeSingle() as { data: QbSettingsRow | null; error: unknown }
      qbSettings = data
    } catch { /* qb_settings table may not exist yet */ }

    const acct = (key: string, fallback: string) =>
      (accountMappings as { mapping_key: string; account_name: string }[] | null)?.find((m) => m.mapping_key === key)?.account_name ?? fallback

    const AR_ACCOUNT = qbSettings?.ar_account?.trim() || acct('accounts_receivable', 'Accounts Receivable')
    const DEFAULT_INCOME_ACCOUNT = qbSettings?.default_income_account?.trim() || acct('sales_income', 'Sales')
    const TAX_PAYABLE_ACCOUNT = qbSettings?.tax_payable_account?.trim() || acct('sales_tax_payable', 'Sales Tax')

    // 3. Resolve invoice → SO → quote → line items chain
    const soIds = invoices.map(i => i.sales_order_id).filter(Boolean) as string[]
    const soToQuote = new Map<string, string>()
    if (soIds.length > 0) {
      const { data: soRows } = await service
        .from('sales_orders')
        .select('id, quote_id')
        .in('id', soIds)
      for (const so of ((soRows ?? []) as { id: string; quote_id: string | null }[])) {
        if (so.quote_id) soToQuote.set(so.id, so.quote_id)
      }
    }

    const quoteIds = Array.from(new Set(soToQuote.values()))
    const quoteToLineItems = new Map<string, LineItem[]>()
    if (quoteIds.length > 0) {
      const { data: liRows } = await service
        .from('quote_line_items')
        .select('quote_id, product_id, product_name, description, quantity, unit_price, total_price, sort_order')
        .in('quote_id', quoteIds)
        .order('sort_order')
      for (const li of ((liRows ?? []) as (LineItem & { quote_id: string })[]) ) {
        const existing = quoteToLineItems.get(li.quote_id) ?? []
        existing.push(li)
        quoteToLineItems.set(li.quote_id, existing)
      }
    }

    // 4. Collect all product IDs across all invoices, fetch income accounts
    const allProductIds = new Set<string>()
    for (const [, lineItems] of quoteToLineItems) {
      for (const li of lineItems) {
        if (li.product_id) allProductIds.add(li.product_id)
      }
    }
    const incomeAccountById = new Map<string, string>()
    if (allProductIds.size > 0) {
      const { data: productRows } = await service
        .from('products')
        .select('id, income_account')
        .in('id', Array.from(allProductIds))
      for (const p of ((productRows ?? []) as { id: string; income_account: string | null }[])) {
        if (p.income_account?.trim()) incomeAccountById.set(p.id, p.income_account.trim())
      }
    }

    // 5. Collect all unique INVITEM names across all invoices
    const allServiceItemNames = new Set<string>(['Custom Item'])
    for (const [, lineItems] of quoteToLineItems) {
      for (const li of lineItems) {
        const name = li.product_name ?? li.description ?? 'Product'
        if (name) allServiceItemNames.add(iif(name))
      }
    }

    // 6. Build IIF
    const lines: string[] = []

    // ONE !INVITEM block (all unique items, deduplicated)
    lines.push('!INVITEM\tNAME\tINVITEMTYPE\tACCNT\tPRICE\tCOST\tDESC')
    for (const name of allServiceItemNames) {
      lines.push(`INVITEM\t${name}\tSERV\t${DEFAULT_INCOME_ACCOUNT}\t0\t0\t${name}`)
    }
    lines.push(`INVITEM\tSales Tax\tTAX\t${TAX_PAYABLE_ACCOUNT}\t0\t0\tSales Tax`)

    // ONE header block
    lines.push('!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO')
    lines.push('!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO\tQNTY\tPRICE\tINVITEM')
    lines.push('!ENDTRNS')

    // Each invoice = TRNS + SPL rows + ENDTRNS
    const TRNSTYPE = 'INVOICE'
    for (const inv of invoices) {
      const cust = customerName(inv.customers)
      const dateStr = formatDate(inv.created_at)
      const invNumStr = `INV-${String(inv.invoice_number).padStart(4, '0')}`
      const memo = inv.notes ?? ''
      const totalDollars = (inv.total / 100).toFixed(2)

      // Get line items for this invoice
      const quoteId = inv.sales_order_id ? soToQuote.get(inv.sales_order_id) : undefined
      const lineItems = quoteId ? (quoteToLineItems.get(quoteId) ?? []) : []

      // TRNS row
      lines.push(
        ['TRNS', '', TRNSTYPE, dateStr, AR_ACCOUNT, iif(cust), totalDollars, iif(invNumStr), iif(memo)].join('\t'),
      )

      // SPL rows
      for (const li of lineItems) {
        const account = (li.product_id && incomeAccountById.get(li.product_id)) ?? DEFAULT_INCOME_ACCOUNT
        const lineTotal = -(li.total_price / 100)
        const unitPrice = (li.unit_price / 100).toFixed(2)
        const itemName = li.product_name ?? li.description ?? 'Product'
        const itemMemo = li.description ?? itemName
        lines.push(
          ['SPL', '', TRNSTYPE, dateStr, iif(account), iif(cust), lineTotal.toFixed(2), iif(itemMemo), String(li.quantity), unitPrice, iif(itemName)].join('\t'),
        )
      }

      // Tax split
      if (inv.tax_total > 0) {
        lines.push(
          ['SPL', '', TRNSTYPE, dateStr, TAX_PAYABLE_ACCOUNT, iif(cust), (-(inv.tax_total / 100)).toFixed(2), 'Sales Tax', '', '', 'Sales Tax'].join('\t'),
        )
      }

      lines.push('ENDTRNS')
    }

    const iifBody = lines.join('\r\n') + '\r\n'

    const today = new Date()
    const mm = String(today.getMonth() + 1).padStart(2, '0')
    const dd = String(today.getDate()).padStart(2, '0')
    const dateTag = `${today.getFullYear()}-${mm}-${dd}`
    const filename = `QMI-BULK-INV-${dateTag}-${invoices.length}invoices.iif`

    return new NextResponse(iifBody, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[/api/invoices/export-iif-bulk] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}
