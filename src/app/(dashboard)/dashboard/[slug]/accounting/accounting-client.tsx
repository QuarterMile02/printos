'use client'

import { useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { formatInvNumber, formatCents, INV_STATUS_STYLES, INV_STATUS_LABELS } from '../invoices/format'

type UnpostedInvoice = {
  id: string
  invoice_number: number
  status: string
  subtotal: number
  tax_total: number
  total: number
  created_at: string
  customers: { first_name: string | null; last_name: string | null; company_name: string | null } | null
}

type UnpostedPayment = {
  id: string
  payment_number: number
  paid_on: string | null
  note: string | null
  amount_paid: number
  balance: number
  customers: { first_name: string | null; last_name: string | null; company_name: string | null } | null
}

type Props = {
  slug: string
  orgId: string
  initialInvoices: UnpostedInvoice[]
  postInvoices: (ids: string[], orgId: string) => Promise<{ posted?: number; error?: string }>
  initialPayments: UnpostedPayment[]
  postPayments: (ids: string[], orgId: string) => Promise<{ posted?: number; error?: string }>
}

type Tab = 'invoices' | 'purchase_orders' | 'payments' | 'unapplied_payments' | 'credit_memos'

const TABS: { value: Tab; label: string }[] = [
  { value: 'invoices',           label: 'Invoices'           },
  { value: 'purchase_orders',    label: 'Purchase Orders'    },
  { value: 'payments',           label: 'Payments'           },
  { value: 'unapplied_payments', label: 'Unapplied Payments' },
  { value: 'credit_memos',       label: 'Credit Memos'       },
]

function customerDisplayName(c: UnpostedInvoice['customers'] | UnpostedPayment['customers']): string {
  if (!c) return '—'
  if (c.company_name?.trim()) return c.company_name.trim()
  const parts = [c.first_name, c.last_name].filter(Boolean).join(' ')
  return parts || '—'
}

function formatPyNumber(num: number): string {
  return `PY-${String(num).padStart(4, '0')}`
}

export default function AccountingClient({ slug, orgId, initialInvoices, postInvoices, initialPayments, postPayments }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('invoices')
  const [invoices, setInvoices] = useState<UnpostedInvoice[]>(initialInvoices)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [posting, setPosting] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'warn' | 'error' } | null>(null)

  const [payments, setPayments] = useState<UnpostedPayment[]>(initialPayments)
  const [paymentSearch, setPaymentSearch] = useState('')
  const [paymentSelected, setPaymentSelected] = useState<Set<string>>(new Set())
  const [postingPayments, setPostingPayments] = useState(false)

  function showToast(msg: string, type: 'success' | 'warn' | 'error' = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return invoices
    const q = search.toLowerCase()
    return invoices.filter(inv => {
      const num = formatInvNumber(inv.invoice_number, inv.created_at).toLowerCase()
      const cust = customerDisplayName(inv.customers).toLowerCase()
      return num.includes(q) || cust.includes(q)
    })
  }, [invoices, search])

  const allSelected = filtered.length > 0 && filtered.every(inv => selected.has(inv.id))

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(prev => {
        const next = new Set(prev)
        filtered.forEach(inv => next.delete(inv.id))
        return next
      })
    } else {
      setSelected(prev => {
        const next = new Set(prev)
        filtered.forEach(inv => next.add(inv.id))
        return next
      })
    }
  }, [allSelected, filtered])

  const toggleOne = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  async function handlePost(ids: string[]) {
    if (!ids.length) return
    setPosting(true)
    try {
      const result = await postInvoices(ids, orgId)
      if (result.error) {
        showToast(result.error, 'error')
        return
      }
      // Remove posted invoices from local state
      setInvoices(prev => prev.filter(inv => !ids.includes(inv.id)))
      setSelected(prev => {
        const next = new Set(prev)
        ids.forEach(id => next.delete(id))
        return next
      })
      showToast(`${result.posted} invoice${(result.posted ?? 0) === 1 ? '' : 's'} posted to accounting.`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Posting failed', 'error')
    } finally {
      setPosting(false)
    }
  }

  const totalValue = invoices.reduce((sum, inv) => sum + inv.total, 0)

  const toastColors = {
    success: 'bg-green-50  border-green-200  text-green-800',
    warn:    'bg-amber-50  border-amber-200  text-amber-800',
    error:   'bg-red-50    border-red-200    text-red-800',
  }

  const selectedInTab = filtered.filter(inv => selected.has(inv.id)).map(inv => inv.id)

  const filteredPayments = useMemo(() => {
    if (!paymentSearch.trim()) return payments
    const q = paymentSearch.toLowerCase()
    return payments.filter(py => {
      const num = formatPyNumber(py.payment_number).toLowerCase()
      const cust = customerDisplayName(py.customers).toLowerCase()
      return num.includes(q) || String(py.payment_number).includes(q) || cust.includes(q)
    })
  }, [payments, paymentSearch])

  const allPaymentsSelected = filteredPayments.length > 0 && filteredPayments.every(py => paymentSelected.has(py.id))

  const togglePaymentsAll = useCallback(() => {
    if (allPaymentsSelected) {
      setPaymentSelected(prev => {
        const next = new Set(prev)
        filteredPayments.forEach(py => next.delete(py.id))
        return next
      })
    } else {
      setPaymentSelected(prev => {
        const next = new Set(prev)
        filteredPayments.forEach(py => next.add(py.id))
        return next
      })
    }
  }, [allPaymentsSelected, filteredPayments])

  const togglePaymentOne = useCallback((id: string) => {
    setPaymentSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  async function handlePostPayments(ids: string[]) {
    if (!ids.length) return
    setPostingPayments(true)
    try {
      const result = await postPayments(ids, orgId)
      if (result.error) {
        showToast(result.error, 'error')
        return
      }
      setPayments(prev => prev.filter(py => !ids.includes(py.id)))
      setPaymentSelected(prev => {
        const next = new Set(prev)
        ids.forEach(id => next.delete(id))
        return next
      })
      showToast(`${result.posted} payment${(result.posted ?? 0) === 1 ? '' : 's'} posted to accounting.`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Posting failed', 'error')
    } finally {
      setPostingPayments(false)
    }
  }

  const totalPaymentsValue = payments.reduce((sum, py) => sum + py.amount_paid, 0)
  const paymentSelectedInTab = filteredPayments.filter(py => paymentSelected.has(py.id)).map(py => py.id)

  return (
    <>
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border px-4 py-3 text-sm font-medium shadow-lg ${toastColors[toast.type]}`}>
          {toast.msg}
        </div>
      )}

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 border-b border-gray-200">
        {TABS.map(tab => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setActiveTab(tab.value)}
            className={`inline-flex items-center px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.value
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Invoices tab */}
      {activeTab === 'invoices' && (
        <div>
          {/* Info banner */}
          <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
            <p className="text-sm text-blue-800">
              These are invoices not yet posted to your accounting software.
            </p>
            {invoices.length > 0 && (
              <p className="mt-1 text-sm font-semibold text-blue-900">
                {invoices.length} unposted invoice{invoices.length === 1 ? '' : 's'} totaling{' '}
                <span className="tabular-nums">${formatCents(totalValue)}</span>
              </p>
            )}
          </div>

          {invoices.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
              <svg className="mx-auto h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <p className="mt-3 text-sm font-medium text-gray-900">All invoices have been posted</p>
              <p className="mt-1 text-sm text-gray-500">No unposted invoices to show.</p>
              <Link
                href={`/dashboard/${slug}/invoices`}
                className="mt-4 inline-block text-sm font-medium text-teal-700 hover:underline"
              >
                View all invoices →
              </Link>
            </div>
          ) : (
            <>
              {/* Search + action toolbar */}
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-48">
                  <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                  </svg>
                  <input
                    type="search"
                    placeholder="Search by invoice # or customer…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </div>

                <button
                  onClick={() => handlePost(selectedInTab)}
                  disabled={posting || selectedInTab.length === 0}
                  className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-40 transition-colors"
                >
                  {posting && selectedInTab.length > 0 ? (
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : null}
                  Post Selected{selectedInTab.length > 0 ? ` (${selectedInTab.length})` : ''}
                </button>

                <button
                  onClick={() => handlePost(invoices.map(inv => inv.id))}
                  disabled={posting}
                  className="inline-flex items-center gap-2 rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40 transition-colors"
                >
                  {posting && selectedInTab.length === 0 ? (
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : null}
                  Post All Invoices
                </button>
              </div>

              {/* Table */}
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleAll}
                          className="h-4 w-4 rounded border-gray-300 accent-teal-600 cursor-pointer"
                          title="Select all visible"
                        />
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">IN#</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Customer</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Total Price</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Total Tax</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Invoice Total</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                          No invoices match &ldquo;{search}&rdquo;
                        </td>
                      </tr>
                    ) : filtered.map(inv => (
                      <tr key={inv.id} className={`hover:bg-gray-50 ${selected.has(inv.id) ? 'bg-teal-50/40' : ''}`}>
                        <td className="w-10 px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selected.has(inv.id)}
                            onChange={() => toggleOne(inv.id)}
                            className="h-4 w-4 rounded border-gray-300 accent-teal-600 cursor-pointer"
                          />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <Link
                            href={`/dashboard/${slug}/invoices/${inv.id}`}
                            className="text-sm font-medium text-qm-fuchsia hover:underline"
                          >
                            {formatInvNumber(inv.invoice_number, inv.created_at)}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                          {customerDisplayName(inv.customers)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-gray-700">
                          ${formatCents(inv.subtotal)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-gray-700">
                          ${formatCents(inv.tax_total)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-900">
                          ${formatCents(inv.total)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${INV_STATUS_STYLES[inv.status] ?? 'bg-gray-100 text-gray-700'}`}>
                            {INV_STATUS_LABELS[inv.status] ?? inv.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {filtered.length > 0 && (
                    <tfoot className="bg-gray-50 border-t border-gray-200">
                      <tr>
                        <td colSpan={3} className="px-4 py-2 text-xs text-gray-400">
                          {filtered.length} invoice{filtered.length === 1 ? '' : 's'}
                          {search ? ` matching "${search}"` : ''}
                        </td>
                        <td className="px-4 py-2 text-right text-xs font-semibold tabular-nums text-gray-700">
                          ${formatCents(filtered.reduce((s, i) => s + i.subtotal, 0))}
                        </td>
                        <td className="px-4 py-2 text-right text-xs font-semibold tabular-nums text-gray-700">
                          ${formatCents(filtered.reduce((s, i) => s + i.tax_total, 0))}
                        </td>
                        <td className="px-4 py-2 text-right text-xs font-bold tabular-nums text-gray-900">
                          ${formatCents(filtered.reduce((s, i) => s + i.total, 0))}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Payments tab */}
      {activeTab === 'payments' && (
        <div>
          {/* Info banner */}
          <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
            <p className="text-sm text-blue-800">
              These are payments not yet posted to your accounting software.
            </p>
            {payments.length > 0 && (
              <p className="mt-1 text-sm font-semibold text-blue-900">
                {payments.length} unposted payment{payments.length === 1 ? '' : 's'} totaling{' '}
                <span className="tabular-nums">${formatCents(totalPaymentsValue)}</span>
              </p>
            )}
          </div>

          {payments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
              <svg className="mx-auto h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <p className="mt-3 text-sm font-medium text-gray-900">All payments have been posted</p>
              <p className="mt-1 text-sm text-gray-500">No unposted payments to show.</p>
            </div>
          ) : (
            <>
              {/* Search + action toolbar */}
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-48">
                  <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                  </svg>
                  <input
                    type="search"
                    placeholder="Search by PY# or Customer…"
                    value={paymentSearch}
                    onChange={e => setPaymentSearch(e.target.value)}
                    className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </div>

                <button
                  onClick={() => handlePostPayments(paymentSelectedInTab)}
                  disabled={postingPayments || paymentSelectedInTab.length === 0}
                  className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-40 transition-colors"
                >
                  {postingPayments && paymentSelectedInTab.length > 0 ? (
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : null}
                  Post Selected Payments{paymentSelectedInTab.length > 0 ? ` (${paymentSelectedInTab.length})` : ''}
                </button>

                <button
                  onClick={() => handlePostPayments(payments.map(py => py.id))}
                  disabled={postingPayments}
                  className="inline-flex items-center gap-2 rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40 transition-colors"
                >
                  {postingPayments && paymentSelectedInTab.length === 0 ? (
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : null}
                  Post All Payments
                </button>
              </div>

              {/* Table */}
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={allPaymentsSelected}
                          onChange={togglePaymentsAll}
                          className="h-4 w-4 rounded border-gray-300 accent-teal-600 cursor-pointer"
                          title="Select all visible"
                        />
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">PY#</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Customer</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Paid On</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Note</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Amount Paid</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredPayments.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                          No payments match &ldquo;{paymentSearch}&rdquo;
                        </td>
                      </tr>
                    ) : filteredPayments.map(py => (
                      <tr key={py.id} className={`hover:bg-gray-50 ${paymentSelected.has(py.id) ? 'bg-teal-50/40' : ''}`}>
                        <td className="w-10 px-4 py-3">
                          <input
                            type="checkbox"
                            checked={paymentSelected.has(py.id)}
                            onChange={() => togglePaymentOne(py.id)}
                            className="h-4 w-4 rounded border-gray-300 accent-teal-600 cursor-pointer"
                          />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <Link
                            href={`/dashboard/${slug}/payments/${py.id}`}
                            className="text-sm font-medium text-qm-fuchsia hover:underline"
                          >
                            {formatPyNumber(py.payment_number)}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                          {customerDisplayName(py.customers)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                          {py.paid_on ?? '—'}
                        </td>
                        <td className="max-w-xs truncate px-4 py-3 text-sm text-gray-500">
                          {py.note ?? '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-900">
                          ${formatCents(py.amount_paid)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-gray-700">
                          ${formatCents(py.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {filteredPayments.length > 0 && (
                    <tfoot className="bg-gray-50 border-t border-gray-200">
                      <tr>
                        <td colSpan={5} className="px-4 py-2 text-xs text-gray-400">
                          {filteredPayments.length} payment{filteredPayments.length === 1 ? '' : 's'}
                          {paymentSearch ? ` matching "${paymentSearch}"` : ''}
                        </td>
                        <td className="px-4 py-2 text-right text-xs font-bold tabular-nums text-gray-900">
                          ${formatCents(filteredPayments.reduce((s, p) => s + p.amount_paid, 0))}
                        </td>
                        <td className="px-4 py-2 text-right text-xs font-semibold tabular-nums text-gray-700">
                          ${formatCents(filteredPayments.reduce((s, p) => s + p.balance, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Coming-soon tabs */}
      {activeTab !== 'invoices' && activeTab !== 'payments' && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-20 text-center">
          <svg className="mx-auto h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <p className="mt-3 text-sm font-semibold text-gray-700">
            {TABS.find(t => t.value === activeTab)?.label} — Coming Soon
          </p>
          <p className="mt-1 text-sm text-gray-400">This section is under construction.</p>
        </div>
      )}
    </>
  )
}
