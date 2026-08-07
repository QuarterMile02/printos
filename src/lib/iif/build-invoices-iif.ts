import type { SupabaseClient } from '@supabase/supabase-js'

// Shared IIF-generation logic, extracted verbatim from
// src/app/api/invoices/export-iif-bulk/route.ts (the existing manual "Post
// to Accounting" bulk export) so the new scheduled cron export
// (src/app/api/cron/invoice-iif-export/route.ts) and the manual route stay
// on exactly one implementation instead of two copies that can drift --
// this exact class of file already needed a real bug fix once (commit
// ddfdc7b, invalid TAX/SERV INVITEMTYPE values), so duplicating it into a
// second file risked reintroducing that bug independently in one copy
// after a future fix only lands in the other.

type ServiceClient = SupabaseClient

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
  // migration 120 — repeat-send safeguard. NOT NULL DEFAULT 0 in the DB
  // (always a real number once 120 is applied); typed nullable here and
  // read with ?? 0 below only as normal TS defensiveness, not because the
  // column itself is optional.
  iif_export_count: number | null
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

export type BuiltInvoicesIif = {
  iifBody: string
  filename: string
  invoiceCount: number
  // The invoices actually resolved and included (validated against
  // organizationId, unlike the raw invoiceIds argument callers pass in) —
  // this is what markInvoicesIifExported below should be called with, not
  // the caller's original input list.
  invoiceIds: string[]
  invoiceNumbers: string[]
  // Split by whether each invoice had already been included in a prior
  // successful export (iif_export_count > 0 as of this build, i.e.
  // migration 120's repeat-send safeguard) — same info that's baked into
  // the IIF body itself as the "[REPEAT EXPORT]" MEMO marker below, surfaced
  // separately here so callers building an email (invoice-iif-export/route.ts)
  // can show a New vs Repeat split without re-deriving it.
  newInvoiceNumbers: string[]
  repeatInvoiceNumbers: string[]
}

export async function buildInvoicesIif(
  service: ServiceClient,
  organizationId: string,
  invoiceIds: string[],
): Promise<{ result: BuiltInvoicesIif | null; error: string | null }> {
  if (invoiceIds.length === 0) return { result: null, error: 'No matching invoices found' }

  // 1. Fetch all invoices (validate they belong to the org)
  const { data: invRows, error: invErr } = await service
    .from('invoices')
    .select('id, organization_id, invoice_number, total, tax_total, subtotal, notes, due_date, sales_order_id, customer_id, created_at, iif_export_count, customers(first_name, last_name, company_name)')
    .eq('organization_id', organizationId)
    .in('id', invoiceIds)
  if (invErr) return { result: null, error: `invoice fetch: ${invErr.message}` }
  const invoices = (invRows ?? []) as unknown as InvoiceRow[]

  if (invoices.length === 0) return { result: null, error: 'No matching invoices found' }

  // 2. Org profile + account mappings + QB settings (fetched once)
  const [accountMappingsRes] = await Promise.all([
    service.from('account_mapping').select('mapping_key, account_name, account_number').eq('organization_id', organizationId),
  ])
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
    for (const li of ((liRows ?? []) as (LineItem & { quote_id: string })[])) {
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
  // Note: "Sales Tax" is intentionally NOT declared here. QuickBooks IIF
  // does not support creating tax items via import (TAX is not a valid
  // INVITEMTYPE) — the "Sales Tax" item must already exist in QuickBooks,
  // and is referenced by name only on the SPL line below.
  lines.push('!INVITEM\tNAME\tINVITEMTYPE\tACCNT\tPRICE\tCOST\tDESC')
  for (const name of allServiceItemNames) {
    lines.push(`INVITEM\t${name}\tSERVICE\t${DEFAULT_INCOME_ACCOUNT}\t0\t0\t${name}`)
  }

  // ONE header block
  lines.push('!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO')
  lines.push('!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO\tQNTY\tPRICE\tINVITEM')
  lines.push('!ENDTRNS')

  // Each invoice = TRNS + SPL rows + ENDTRNS
  const TRNSTYPE = 'INVOICE'
  const invoiceNumbers: string[] = []
  const newInvoiceNumbers: string[] = []
  const repeatInvoiceNumbers: string[] = []
  for (const inv of invoices) {
    const cust = customerName(inv.customers)
    const dateStr = formatDate(inv.created_at)
    const invNumStr = `INV-${String(inv.invoice_number).padStart(4, '0')}`
    invoiceNumbers.push(invNumStr)
    const totalDollars = (inv.total / 100).toFixed(2)

    // Repeat-send safeguard (migration 120): QuickBooks Desktop's IIF
    // import has no native duplicate protection (confirmed — see
    // migration 120's header comment), so an invoice that's shown up in a
    // prior successful export gets a visible marker here rather than
    // silently going out again indistinguishable from a first-time send.
    const isRepeat = (inv.iif_export_count ?? 0) > 0
    if (isRepeat) repeatInvoiceNumbers.push(invNumStr)
    else newInvoiceNumbers.push(invNumStr)
    const baseMemo = inv.notes ?? ''
    const memo = isRepeat ? (baseMemo ? `${baseMemo} [REPEAT EXPORT]` : '[REPEAT EXPORT]') : baseMemo

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

  return {
    result: {
      iifBody,
      filename,
      invoiceCount: invoices.length,
      invoiceIds: invoices.map((inv) => inv.id),
      invoiceNumbers,
      newInvoiceNumbers,
      repeatInvoiceNumbers,
    },
    error: null,
  }
}

// Called by both export routes (export-iif-bulk/route.ts's manual bulk
// download, invoice-iif-export/route.ts's scheduled cron send) right
// after their own definition of "this export actually went out" —
// manual: once the file body is generated, since the download response
// *is* the delivery; cron: only after Resend confirms the email sent, not
// before, so a failed send doesn't get falsely marked as exported. Takes
// BuiltInvoicesIif's own invoiceIds (the resolved, org-validated list),
// not whatever the caller originally passed to buildInvoicesIif.
//
// Not done as a single atomic UPDATE ... SET iif_export_count =
// iif_export_count + 1 because the Supabase JS client can't express a
// column-referencing SET expression without a Postgres function (a bigger
// change than this safeguard warranted) -- read-then-write per invoice
// instead. A race between two overlapping exports of the exact same
// invoice at the exact same moment is the only way this could under-count
// by one; given exports are at most once/day (cron) or human-triggered
// (manual), and this count only ever feeds a "you've seen this before"
// warning rather than anything relied on for correctness, that's an
// acceptable tradeoff over adding a migration + DB function for it.
export async function markInvoicesIifExported(service: ServiceClient, invoiceIds: string[]): Promise<void> {
  if (invoiceIds.length === 0) return

  const { data: rows, error } = await service
    .from('invoices')
    .select('id, iif_export_count, iif_first_exported_at')
    .in('id', invoiceIds)
  if (error || !rows) {
    console.error('[markInvoicesIifExported] fetch failed:', error?.message)
    return
  }

  const nowIso = new Date().toISOString()
  const results = await Promise.all(
    (rows as { id: string; iif_export_count: number | null; iif_first_exported_at: string | null }[]).map((r) =>
      service
        .from('invoices')
        .update({
          iif_export_count: (r.iif_export_count ?? 0) + 1,
          iif_last_exported_at: nowIso,
          iif_first_exported_at: r.iif_first_exported_at ?? nowIso,
        })
        .eq('id', r.id),
    ),
  )
  for (const res of results) {
    if (res.error) console.error('[markInvoicesIifExported] update failed:', res.error.message)
  }
}
