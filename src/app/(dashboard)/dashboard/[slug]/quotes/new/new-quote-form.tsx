'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createQuote } from '../actions'

type CustomerOption = {
  id: string
  first_name: string
  last_name: string
  company_name: string | null
}

type TeamMember = { id: string; name: string }

type Props = {
  orgId: string
  orgSlug: string
  customers: CustomerOption[]
  teamMembers: TeamMember[]
}

export default function NewQuoteForm({ orgId, orgSlug, customers, teamMembers }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [salesRepId, setSalesRepId] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [installAddress, setInstallAddress] = useState('')
  const [productionNotes, setProductionNotes] = useState('')

  const selectedCustomer = customers.find((c) => c.id === customerId)

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers
    const q = customerSearch.toLowerCase()
    return customers.filter((c) => {
      const full = `${c.first_name} ${c.last_name} ${c.company_name ?? ''}`.toLowerCase()
      return full.includes(q)
    })
  }, [customers, customerSearch])

  function selectCustomer(id: string) {
    setCustomerId(id)
    const c = customers.find((c) => c.id === id)
    if (c) setCustomerSearch(`${c.first_name} ${c.last_name}${c.company_name ? ` (${c.company_name})` : ''}`)
    setCustomerDropdownOpen(false)
  }

  function clearCustomer() {
    setCustomerId('')
    setCustomerSearch('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await createQuote(orgId, orgSlug, {
        title,
        customerId: customerId || null,
        description: null,
        expiresAt: null,
        terms: null,
        notes: null,
        dueDate: dueDate || null,
        salesRepId: salesRepId || null,
        poNumber: poNumber || null,
        installAddress: installAddress || null,
        productionNotes: productionNotes || null,
        lineItems: [],
      })
      if (result.error) {
        setError(result.error)
      } else if (result.quoteId) {
        router.push(`/dashboard/${orgSlug}/quotes/${result.quoteId}`)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-6">
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {/* Customer — searchable dropdown */}
      <div className="relative">
        <label className="block text-sm font-medium text-gray-700">Customer</label>
        <div className="mt-1 relative">
          <input
            type="text"
            value={customerId ? (selectedCustomer ? `${selectedCustomer.first_name} ${selectedCustomer.last_name}${selectedCustomer.company_name ? ` (${selectedCustomer.company_name})` : ''}` : customerSearch) : customerSearch}
            onChange={(e) => {
              setCustomerSearch(e.target.value)
              setCustomerId('')
              setCustomerDropdownOpen(true)
            }}
            onFocus={() => setCustomerDropdownOpen(true)}
            placeholder="Search customers..."
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
          {customerId && (
            <button
              type="button"
              onClick={clearCustomer}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {customerDropdownOpen && !customerId && (
          <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
            {filteredCustomers.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-500">No matches</li>
            ) : (
              filteredCustomers.slice(0, 50).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => selectCustomer(c.id)}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-qm-lime-light"
                  >
                    {c.first_name} {c.last_name}
                    {c.company_name && <span className="text-gray-400"> ({c.company_name})</span>}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Title <span className="text-red-500">*</span>
        </label>
        <input
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

      {/* Due Date + Sales Rep row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Due Date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Sales Rep</label>
          <select
            value={salesRepId}
            onChange={(e) => setSalesRepId(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          >
            <option value="">&mdash; Unassigned &mdash;</option>
            {teamMembers.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* PO Number + Install Address row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">PO Number</label>
          <input
            type="text"
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            placeholder="Customer PO #"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Install Address</label>
          <input
            type="text"
            value={installAddress}
            onChange={(e) => setInstallAddress(e.target.value)}
            placeholder="Job installation location"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>
      </div>

      {/* Production Notes */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Production Notes
          <span className="ml-2 text-xs font-normal text-gray-400">Internal &mdash; not shown on PDF</span>
        </label>
        <textarea
          rows={3}
          value={productionNotes}
          onChange={(e) => setProductionNotes(e.target.value)}
          placeholder="Special instructions for production staff..."
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
        <button
          type="button"
          onClick={() => router.push(`/dashboard/${orgSlug}/quotes`)}
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
  )
}
