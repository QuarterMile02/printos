'use client'

import { useState, useTransition } from 'react'
import { createQuote } from './actions'

type CustomerOption = {
  id: string
  first_name: string
  last_name: string
  company_name: string | null
}

type LineItem = {
  key: number
  description: string
  quantity: number
  unit_price: number // in cents
}

type Props = {
  orgId: string
  orgSlug: string
  customers: CustomerOption[]
}

let nextKey = 0

function emptyLineItem(): LineItem {
  return { key: ++nextKey, description: '', quantity: 1, unit_price: 0 }
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

function parseDollars(value: string): number {
  const num = parseFloat(value)
  if (isNaN(num) || num < 0) return 0
  return Math.round(num * 100)
}

export default function CreateQuoteForm({ orgId, orgSlug, customers }: Props) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const [title, setTitle] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [description, setDescription] = useState('')
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLineItem()])

  function resetForm() {
    setTitle('')
    setCustomerId('')
    setDescription('')
    setLineItems([emptyLineItem()])
    setError(null)
  }

  function updateLineItem(key: number, field: keyof Omit<LineItem, 'key'>, value: string | number) {
    setLineItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, [field]: value } : item))
    )
  }

  function removeLineItem(key: number) {
    setLineItems((prev) => (prev.length <= 1 ? prev : prev.filter((i) => i.key !== key)))
  }

  function addLineItem() {
    setLineItems((prev) => [...prev, emptyLineItem()])
  }

  const grandTotal = lineItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await createQuote(orgId, orgSlug, {
        title,
        customerId: customerId || null,
        description: description || null,
        lineItems: lineItems.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
        })),
      })
      if (result.error) {
        setError(result.error)
      } else {
        resetForm()
        setOpen(false)
      }
    })
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); setError(null) }}
        className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-qm-fuchsia focus:ring-offset-2"
      >
        Create Quote
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !isPending && setOpen(false)}
          />

          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Create Quote</h2>
            <p className="mt-1 text-sm text-gray-500">
              A quote number will be assigned automatically.
            </p>

            {error && (
              <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="quote_title" className="block text-sm font-medium text-gray-700">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  id="quote_title"
                  type="text"
                  required
                  autoFocus
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Vehicle wrap — Fleet of 10"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                />
              </div>

              <div>
                <label htmlFor="quote_customer" className="block text-sm font-medium text-gray-700">
                  Customer
                </label>
                <select
                  id="quote_customer"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                >
                  <option value="">— No customer —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.first_name} {c.last_name}
                      {c.company_name ? ` (${c.company_name})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="quote_description" className="block text-sm font-medium text-gray-700">
                  Description
                </label>
                <textarea
                  id="quote_description"
                  rows={2}
                  maxLength={2000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Additional details or notes for the customer..."
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                />
              </div>

              {/* Line items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Line Items <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={addLineItem}
                    className="text-sm font-medium text-qm-lime hover:brightness-110"
                  >
                    + Add item
                  </button>
                </div>

                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  {/* Header */}
                  <div className="grid grid-cols-[1fr_80px_100px_90px_32px] gap-2 bg-gray-50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                    <span>Description</span>
                    <span>Qty</span>
                    <span>Unit Price</span>
                    <span className="text-right">Total</span>
                    <span />
                  </div>

                  {/* Rows */}
                  {lineItems.map((item) => (
                    <div
                      key={item.key}
                      className="grid grid-cols-[1fr_80px_100px_90px_32px] gap-2 border-t border-gray-100 px-3 py-2 items-center"
                    >
                      <input
                        type="text"
                        required
                        maxLength={200}
                        value={item.description}
                        onChange={(e) => updateLineItem(item.key, 'description', e.target.value)}
                        placeholder="Item description"
                        className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                      />
                      <input
                        type="number"
                        required
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateLineItem(item.key, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                        className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                      />
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                        <input
                          type="number"
                          required
                          min={0}
                          step="0.01"
                          value={formatCents(item.unit_price)}
                          onChange={(e) => updateLineItem(item.key, 'unit_price', parseDollars(e.target.value))}
                          className="block w-full rounded-md border border-gray-300 pl-6 pr-2 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                        />
                      </div>
                      <span className="text-right text-sm text-gray-700">
                        ${formatCents(item.quantity * item.unit_price)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeLineItem(item.key)}
                        disabled={lineItems.length <= 1}
                        className="flex items-center justify-center rounded p-1 text-gray-400 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Remove item"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}

                  {/* Grand total */}
                  <div className="grid grid-cols-[1fr_80px_100px_90px_32px] gap-2 border-t border-gray-200 bg-gray-50 px-3 py-2.5 items-center">
                    <span className="text-sm font-semibold text-gray-900 col-span-3 text-right">
                      Grand Total
                    </span>
                    <span className="text-right text-sm font-semibold text-gray-900">
                      ${formatCents(grandTotal)}
                    </span>
                    <span />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { resetForm(); setOpen(false) }}
                  disabled={isPending}
                  className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
                >
                  {isPending ? 'Creating...' : 'Create Quote'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
