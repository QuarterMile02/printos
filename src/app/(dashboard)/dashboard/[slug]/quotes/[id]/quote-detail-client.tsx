'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { QuoteStatus } from '@/types/database'
import {
  updateQuoteFields,
  addQuoteLineItem,
  updateQuoteLineItem,
  deleteQuoteLineItem,
  sendQuoteEmailAndDeliver,
  sendQuoteSmsAndDeliver,
  convertQuoteToSalesOrder,
} from '../actions'
import {
  formatQuoteNumber,
  formatSoNumber,
  formatCents,
  productUsesDimensions,
  QUOTE_STATUS_STYLES,
  QUOTE_STATUS_LABELS,
  TAX_RATE,
} from '../format'

type Quote = {
  id: string
  quote_number: number
  title: string
  description: string | null
  status: QuoteStatus
  created_at: string
  expires_at: string | null
  terms: string | null
  notes: string | null
  subtotal: number
  tax_total: number
  total: number
  due_date: string | null
  sales_rep_id: string | null
  po_number: string | null
  install_address: string | null
  production_notes: string | null
  customer: {
    first_name: string
    last_name: string
    company_name: string | null
    email: string | null
    phone: string | null
  } | null
}

type TeamMember = { id: string; name: string }

type LineItem = {
  id: string
  product_id: string | null
  description: string
  width: number | null
  height: number | null
  quantity: number
  unit_price: number       // cents
  discount_percent: number
  total_price: number      // cents
  taxable: boolean
  sort_order: number
  material_name: string | null
}

type ProductOption = { id: string; name: string; formula: string | null }

type Props = {
  orgId: string
  orgSlug: string
  quote: Quote
  lineItems: LineItem[]
  products: ProductOption[]
  salesOrder: { id: string; so_number: number; created_at: string } | null
  teamMembers: TeamMember[]
  salesRepName: string | null
}

function lineTotalCents(qty: number, unitPriceCents: number, discountPct: number): number {
  return Math.round(qty * unitPriceCents * (1 - discountPct / 100))
}

function dollarsToCents(s: string): number {
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ''))
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100)
}

export default function QuoteDetailClient({
  orgId, orgSlug, quote, lineItems, products, salesOrder, teamMembers, salesRepName,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [isEditing, setIsEditing] = useState(false)

  const [status, setStatus] = useState<QuoteStatus>(quote.status)
  const [items, setItems] = useState<LineItem[]>(lineItems)
  const [title, setTitle] = useState(quote.title)
  const [expiresAt, setExpiresAt] = useState<string>(quote.expires_at ? quote.expires_at.slice(0, 10) : '')
  const [terms, setTerms] = useState<string>(quote.terms ?? '')
  const [notes, setNotes] = useState<string>(quote.notes ?? '')
  const [dueDate, setDueDate] = useState<string>(quote.due_date ? quote.due_date.slice(0, 10) : '')
  const [salesRepId, setSalesRepId] = useState<string>(quote.sales_rep_id ?? '')
  const [poNumber, setPoNumber] = useState<string>(quote.po_number ?? '')
  const [installAddress, setInstallAddress] = useState<string>(quote.install_address ?? '')
  const [productionNotes, setProductionNotes] = useState<string>(quote.production_notes ?? '')
  const [convertedSo, setConvertedSo] = useState(salesOrder)

  const productMap = useMemo(() => {
    const m = new Map<string, ProductOption>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.total_price, 0), [items])
  const taxableTotal = useMemo(
    () => items.filter((i) => i.taxable).reduce((s, i) => s + i.total_price, 0),
    [items],
  )
  const taxAmount = Math.round(taxableTotal * TAX_RATE)
  const grandTotal = subtotal + taxAmount

  function flash(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  // ── Action handlers (available in both modes) ─────────────────────
  function handleSendEmail() {
    startTransition(async () => {
      const res = await sendQuoteEmailAndDeliver(quote.id, orgId, orgSlug)
      if (res.error) {
        flash(res.error, 'error')
      } else {
        setStatus('delivered')
        flash('Quote email sent')
      }
    })
  }

  function handleSendSms() {
    startTransition(async () => {
      const res = await sendQuoteSmsAndDeliver(quote.id, orgId, orgSlug)
      if (res.error) {
        flash(res.error, 'error')
      } else {
        setStatus('delivered')
        flash('Quote SMS sent')
      }
    })
  }

  function handleConvert() {
    startTransition(async () => {
      try {
        const res = await convertQuoteToSalesOrder(quote.id, orgId, orgSlug)
        if (res.error) {
          flash(res.error, 'error')
        } else if (res.soId) {
          setStatus('ordered')
          setConvertedSo({ id: res.soId, so_number: res.soNumber!, created_at: res.createdAt! })
          router.push(`/dashboard/${orgSlug}/sales-orders/${res.soId}`)
        } else {
          flash('Conversion failed — no sales order was returned.', 'error')
        }
      } catch (err) {
        flash(`Conversion error: ${err instanceof Error ? err.message : String(err)}`, 'error')
      }
    })
  }

  // ── Edit-mode helpers ─────────────────────────────────────────────
  function saveFields(patch: Record<string, string | null | undefined>) {
    startTransition(async () => {
      const res = await updateQuoteFields(quote.id, orgId, orgSlug, patch)
      if (res.error) flash(res.error, 'error')
    })
  }

  function handleAddLineItem() {
    startTransition(async () => {
      const res = await addQuoteLineItem(quote.id, orgId, orgSlug, {
        product_id: null,
        description: 'New item',
        width: null,
        height: null,
        quantity: 1,
        unit_price: 0,
        discount_percent: 0,
        taxable: true,
      })
      if (res.error || !res.id) {
        flash(res.error ?? 'Failed to add line item', 'error')
        return
      }
      setItems((cur) => [
        ...cur,
        {
          id: res.id!,
          product_id: null,
          description: 'New item',
          width: null,
          height: null,
          quantity: 1,
          unit_price: 0,
          discount_percent: 0,
          total_price: 0,
          taxable: true,
          sort_order: cur.length,
          material_name: null,
        },
      ])
    })
  }

  function patchItem(id: string, patch: Partial<LineItem>) {
    setItems((cur) => cur.map((i) => {
      if (i.id !== id) return i
      const merged = { ...i, ...patch }
      merged.total_price = lineTotalCents(merged.quantity, merged.unit_price, merged.discount_percent)
      return merged
    }))
  }

  function commitItem(id: string, fields: Partial<LineItem>) {
    startTransition(async () => {
      const res = await updateQuoteLineItem(id, quote.id, orgId, orgSlug, fields)
      if (res.error) flash(res.error, 'error')
    })
  }

  function handleProductChange(itemId: string, productId: string) {
    const product = productId ? productMap.get(productId) : null
    const desc = product ? product.name : items.find((i) => i.id === itemId)?.description ?? ''
    const usesDims = productUsesDimensions(product?.formula)
    patchItem(itemId, {
      product_id: product ? product.id : null,
      description: desc,
      width: usesDims ? items.find((i) => i.id === itemId)?.width ?? null : null,
      height: usesDims ? items.find((i) => i.id === itemId)?.height ?? null : null,
    })
    commitItem(itemId, {
      product_id: product ? product.id : null,
      description: desc,
      width: usesDims ? items.find((i) => i.id === itemId)?.width ?? null : null,
      height: usesDims ? items.find((i) => i.id === itemId)?.height ?? null : null,
    })
  }

  function handleDeleteItem(id: string) {
    if (!confirm('Delete this line item?')) return
    const prev = items
    setItems((cur) => cur.filter((i) => i.id !== id))
    startTransition(async () => {
      const res = await deleteQuoteLineItem(id, quote.id, orgId, orgSlug)
      if (res.error) {
        setItems(prev)
        flash(res.error, 'error')
      }
    })
  }

  // ── Derived ────────────────────────────────────────────────────────
  const customerName = quote.customer
    ? `${quote.customer.first_name} ${quote.customer.last_name}`
    : null
  const companyName = quote.customer?.company_name
  const canConvert = (status === 'approved' || status === 'customer_review') && !convertedSo

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <>
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg ${
          toast.type === 'success'
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          {toast.message}
        </div>
      )}

      {/* ── Header card ────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
              {formatQuoteNumber(quote.quote_number, quote.created_at)}
            </p>
            <h1 className="mt-1 text-2xl font-extrabold text-gray-900">{title}</h1>
            {customerName ? (
              <p className="mt-1 text-sm text-gray-600">
                {customerName}
                {companyName && <span className="text-gray-400"> &mdash; {companyName}</span>}
              </p>
            ) : (
              <p className="mt-1 text-sm text-gray-400">No customer linked</p>
            )}
          </div>
          <div className="text-right">
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${QUOTE_STATUS_STYLES[status]}`}>
              {QUOTE_STATUS_LABELS[status]}
            </span>
            <p className="mt-2 text-xs text-gray-500">
              Created {new Date(quote.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Read-only metadata row */}
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {dueDate && (
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Due </span>
              <span className="text-gray-700">
                {new Date(dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
          )}
          {(salesRepName || salesRepId) && (
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Sales Rep </span>
              <span className="text-gray-700">{salesRepName ?? 'Unassigned'}</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSendEmail}
            disabled={isPending || !quote.customer?.email}
            className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            Send Email
          </button>
          <button
            type="button"
            onClick={handleSendSms}
            disabled={isPending || !quote.customer?.phone}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            Send SMS
          </button>
          {canConvert && (
            <button
              type="button"
              onClick={handleConvert}
              disabled={isPending}
              className="rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              Convert to Sales Order
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsEditing(!isEditing)}
            className={`rounded-md border px-4 py-2 text-sm font-medium ${
              isEditing
                ? 'border-qm-lime bg-qm-lime text-white'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {isEditing ? 'Done Editing' : 'Edit'}
          </button>
        </div>

        {convertedSo && (
          <div className="mt-4 rounded-md border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-800">
            Sales order <span className="font-semibold">{formatSoNumber(convertedSo.so_number, convertedSo.created_at)}</span> created from this quote.
          </div>
        )}
      </div>

      {/* ── Edit-mode metadata fields ──────────────────────────────── */}
      {isEditing && (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-bold text-gray-900">Quote Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => saveFields({ title })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                onBlur={() => saveFields({ due_date: dueDate || null })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Sales Rep</label>
              <select
                value={salesRepId}
                onChange={(e) => {
                  setSalesRepId(e.target.value)
                  saveFields({ sales_rep_id: e.target.value || null })
                }}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              >
                <option value="">— Unassigned —</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">PO Number</label>
              <input
                type="text"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                onBlur={() => saveFields({ po_number: poNumber || null })}
                placeholder="Customer PO #"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Expires</label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                onBlur={() => saveFields({ expires_at: expiresAt || null })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Terms</label>
              <input
                type="text"
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                onBlur={() => saveFields({ terms: terms || null })}
                placeholder="Net 30"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Install Address</label>
              <input
                type="text"
                value={installAddress}
                onChange={(e) => setInstallAddress(e.target.value)}
                onBlur={() => saveFields({ install_address: installAddress || null })}
                placeholder="Job installation address"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Internal Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => saveFields({ notes: notes || null })}
                placeholder="Notes for the team"
                rows={3}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Production Notes</label>
              <textarea
                value={productionNotes}
                onChange={(e) => setProductionNotes(e.target.value)}
                onBlur={() => saveFields({ production_notes: productionNotes || null })}
                placeholder="Visible to production staff only — not on customer PDF"
                rows={3}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Line items ─────────────────────────────────────────────── */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-bold text-gray-900">Line Items</h2>
          {isEditing && (
            <button
              type="button"
              onClick={handleAddLineItem}
              disabled={isPending}
              className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              + Add Line Item
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            {isEditing ? (
              <>No line items yet. Click <span className="font-semibold">Add Line Item</span> to start.</>
            ) : (
              'No line items.'
            )}
          </div>
        ) : isEditing ? (
          /* ── Editable table ─────────────────────────────────────── */
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Product</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Description</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">W &times; H</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Qty</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Unit Price</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Disc%</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Total</th>
                  <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Tax</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item) => {
                  const product = item.product_id ? productMap.get(item.product_id) : null
                  const usesDims = productUsesDimensions(product?.formula)
                  return (
                    <tr key={item.id}>
                      <td className="px-3 py-2">
                        <select
                          value={item.product_id ?? ''}
                          onChange={(e) => handleProductChange(item.id, e.target.value)}
                          className="block w-44 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                        >
                          <option value="">&mdash; manual &mdash;</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => patchItem(item.id, { description: e.target.value })}
                          onBlur={() => commitItem(item.id, { description: item.description })}
                          className="block w-56 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                        />
                      </td>
                      <td className="px-3 py-2">
                        {usesDims ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={item.width ?? ''}
                              onChange={(e) => patchItem(item.id, { width: e.target.value === '' ? null : Number(e.target.value) })}
                              onBlur={() => commitItem(item.id, { width: item.width })}
                              placeholder="W"
                              className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                            />
                            <span className="text-xs text-gray-400">&times;</span>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={item.height ?? ''}
                              onChange={(e) => patchItem(item.id, { height: e.target.value === '' ? null : Number(e.target.value) })}
                              onBlur={() => commitItem(item.id, { height: item.height })}
                              placeholder="H"
                              className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">&mdash;</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(e) => patchItem(item.id, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                          onBlur={() => commitItem(item.id, { quantity: item.quantity })}
                          className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm tabular-nums text-right focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="text"
                          value={(item.unit_price / 100).toFixed(2)}
                          onChange={(e) => patchItem(item.id, { unit_price: dollarsToCents(e.target.value) })}
                          onBlur={() => commitItem(item.id, { unit_price: item.unit_price })}
                          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm tabular-nums text-right focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="0.1"
                          value={item.discount_percent}
                          onChange={(e) => patchItem(item.id, { discount_percent: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })}
                          onBlur={() => commitItem(item.id, { discount_percent: item.discount_percent })}
                          className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm tabular-nums text-right focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                        />
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-semibold text-gray-900 tabular-nums">
                        ${formatCents(item.total_price)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={item.taxable}
                          onChange={(e) => {
                            patchItem(item.id, { taxable: e.target.checked })
                            commitItem(item.id, { taxable: e.target.checked })
                          }}
                          className="h-4 w-4 rounded border-gray-300 accent-qm-lime"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteItem(item.id)}
                          disabled={isPending}
                          className="rounded p-1 text-gray-400 hover:text-red-500 disabled:opacity-30"
                          title="Delete"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={6} className="px-3 py-2 text-right text-xs font-bold uppercase tracking-wider text-gray-500">Subtotal</td>
                  <td className="px-3 py-2 text-right text-sm tabular-nums text-gray-900">${formatCents(subtotal)}</td>
                  <td colSpan={2}></td>
                </tr>
                {taxAmount > 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-2 text-right text-xs font-bold uppercase tracking-wider text-gray-500">
                      Tax ({(TAX_RATE * 100).toFixed(2)}%)
                    </td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums text-gray-900">${formatCents(taxAmount)}</td>
                    <td colSpan={2}></td>
                  </tr>
                )}
                <tr>
                  <td colSpan={6} className="px-3 py-2 text-right text-sm font-bold text-gray-900">Total</td>
                  <td className="px-3 py-2 text-right text-base font-extrabold tabular-nums text-gray-900">${formatCents(grandTotal)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          /* ── Read-only table ────────────────────────────────────── */
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Dimensions</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Qty</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Material</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Unit Price</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 text-sm text-gray-900">{item.description}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {item.width != null && item.height != null
                        ? `${item.width}" \u00d7 ${item.height}"`
                        : <span className="text-gray-300">&mdash;</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">{item.quantity}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {item.material_name ?? <span className="text-gray-300">&mdash;</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">${formatCents(item.unit_price)}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right tabular-nums">${formatCents(item.total_price)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={5} className="px-4 py-2 text-right text-xs font-bold uppercase tracking-wider text-gray-500">Subtotal</td>
                  <td className="px-4 py-2 text-right text-sm tabular-nums text-gray-900">${formatCents(subtotal)}</td>
                </tr>
                {taxAmount > 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-2 text-right text-xs font-bold uppercase tracking-wider text-gray-500">
                      Tax ({(TAX_RATE * 100).toFixed(2)}%)
                    </td>
                    <td className="px-4 py-2 text-right text-sm tabular-nums text-gray-900">${formatCents(taxAmount)}</td>
                  </tr>
                )}
                <tr>
                  <td colSpan={5} className="px-4 py-2 text-right text-sm font-bold text-gray-900">Total</td>
                  <td className="px-4 py-2 text-right text-base font-extrabold tabular-nums text-gray-900">${formatCents(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
