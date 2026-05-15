'use client'

import { useState, useRef, useTransition, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { searchCustomers } from '@/app/(dashboard)/dashboard/[slug]/customers/actions'
import {
  assignCustomerToQuote, assignContactToQuote,
  assignCustomerToSalesOrder, assignContactToSalesOrder,
  assignContactToJob,
  fetchContactsForCustomer,
  quickCreateCustomer,
  type ContactOption,
} from '@/app/(dashboard)/dashboard/[slug]/assign-actions'

type RecordType = 'quote' | 'sales_order' | 'job'

type CustomerResult = {
  id: string
  name: string
  company: string | null
  status: string | null
}

type Props = {
  recordId: string
  recordType: RecordType
  orgId: string
  orgSlug: string
  initialCustomerId: string | null
  initialCustomerName: string | null
  initialCompanyName: string | null
  initialContactId: string | null
  initialContactName: string | null
  isOwnerOrAdmin: boolean
  allowCustomerChange: boolean
}

const STATUS_BADGE: Record<string, string> = {
  lead: 'bg-gray-100 text-gray-700',
  prospect: 'bg-yellow-50 text-yellow-700',
  closable: 'bg-blue-50 text-blue-700',
  sold: 'bg-green-50 text-green-700',
}

const ic = 'block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

export default function CustomerContactPicker({
  recordId, recordType, orgId, orgSlug,
  initialCustomerId, initialCustomerName, initialCompanyName,
  initialContactId, initialContactName,
  isOwnerOrAdmin, allowCustomerChange,
}: Props) {
  const router = useRouter()

  // Committed (server) state
  const [committed, setCommitted] = useState({
    customerId: initialCustomerId,
    customerName: initialCustomerName,
    companyName: initialCompanyName,
    contactId: initialContactId,
    contactName: initialContactName,
  })

  // Pending (locally staged) state — what the user has selected but not yet saved
  const [pending, setPending] = useState({
    customerId: initialCustomerId,
    customerName: initialCustomerName,
    companyName: initialCompanyName,
    contactId: initialContactId,
    contactName: initialContactName,
  })

  const isDirty =
    pending.customerId !== committed.customerId ||
    pending.contactId !== committed.contactId

  // Customer dropdown state
  const [custOpen, setCustOpen] = useState(false)
  const [custSearch, setCustSearch] = useState('')
  const [custResults, setCustResults] = useState<CustomerResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const custDropRef = useRef<HTMLDivElement>(null)

  // Quick-add customer mini-form state
  const [showAddForm, setShowAddForm] = useState(false)
  const [addFirst, setAddFirst] = useState('')
  const [addLast, setAddLast] = useState('')
  const [addCompany, setAddCompany] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [isAdding, startAdding] = useTransition()

  // Contact dropdown state
  const [contactOpen, setContactOpen] = useState(false)
  const [contactOptions, setContactOptions] = useState<ContactOption[]>([])
  const [isLoadingContacts, setIsLoadingContacts] = useState(false)
  const contactDropRef = useRef<HTMLDivElement>(null)

  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [saving, startSave] = useTransition()

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeqRef = useRef(0)

  function flash(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  // Close customer dropdown on outside click
  const closeCustDrop = useCallback(() => {
    setCustOpen(false)
    setShowAddForm(false)
    setCustSearch('')
    setCustResults([])
    setAddFirst(''); setAddLast(''); setAddCompany(''); setAddError(null)
  }, [])

  useEffect(() => {
    if (!custOpen) return
    function handle(e: MouseEvent) {
      if (custDropRef.current && !custDropRef.current.contains(e.target as Node)) {
        closeCustDrop()
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [custOpen, closeCustDrop])

  // Close contact dropdown on outside click
  const closeContactDrop = useCallback(() => setContactOpen(false), [])

  useEffect(() => {
    if (!contactOpen) return
    function handle(e: MouseEvent) {
      if (contactDropRef.current && !contactDropRef.current.contains(e.target as Node)) {
        closeContactDrop()
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [contactOpen, closeContactDrop])

  // ── Customer search ────────────────────────────────────────────────────────

  function handleCustSearchChange(val: string) {
    setCustSearch(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const term = val.trim()
    if (term.length < 2) { setCustResults([]); setIsSearching(false); return }
    setIsSearching(true)
    const seq = ++searchSeqRef.current
    debounceRef.current = setTimeout(async () => {
      const rows = await searchCustomers(orgId, term, {})
      if (searchSeqRef.current !== seq) return
      setCustResults(rows.map((r) => ({
        id: r.id,
        name: `${r.first_name} ${r.last_name}`,
        company: r.company_name,
        status: r.status,
      })))
      setIsSearching(false)
    }, 300)
  }

  function selectCustomer(id: string, name: string, company: string | null) {
    setPending((p) => ({ ...p, customerId: id, customerName: name, companyName: company, contactId: null, contactName: null }))
    setContactOptions([])
    closeCustDrop()
  }

  // ── Quick-add customer ─────────────────────────────────────────────────────

  function handleQuickAdd() {
    setAddError(null)
    startAdding(async () => {
      const res = await quickCreateCustomer(orgId, orgSlug, addFirst, addLast, addCompany || null)
      if (res.error) { setAddError(res.error); return }
      selectCustomer(res.id!, res.name!, res.company ?? null)
    })
  }

  // ── Contact picker ─────────────────────────────────────────────────────────

  async function openContactDrop() {
    const cid = pending.customerId
    if (!cid) return
    setContactOpen(true)
    if (contactOptions.length === 0) {
      setIsLoadingContacts(true)
      const opts = await fetchContactsForCustomer(cid, orgId)
      setContactOptions(opts)
      setIsLoadingContacts(false)
    }
  }

  // When pending customer changes, clear cached contact list
  useEffect(() => {
    setContactOptions([])
  }, [pending.customerId])

  function selectContact(id: string | null, name: string | null) {
    setPending((p) => ({ ...p, contactId: id, contactName: name }))
    setContactOpen(false)
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  function handleSave() {
    startSave(async () => {
      // Save customer if changed
      if (pending.customerId !== committed.customerId) {
        if (recordType === 'quote') {
          const res = await assignCustomerToQuote(recordId, orgId, orgSlug, pending.customerId)
          if (res.error) { flash(res.error, false); return }
        } else if (recordType === 'sales_order') {
          const res = await assignCustomerToSalesOrder(recordId, orgId, orgSlug, pending.customerId)
          if (res.error) { flash(res.error, false); return }
        }
      }

      // Save contact if changed
      if (pending.contactId !== committed.contactId) {
        const contactAction = recordType === 'quote'
          ? assignContactToQuote
          : recordType === 'sales_order'
            ? assignContactToSalesOrder
            : assignContactToJob
        const res = await contactAction(recordId, orgId, orgSlug, pending.contactId)
        if (res.error) { flash(res.error, false); return }
      }

      setCommitted({ ...pending })
      flash('Customer updated', true)
      router.refresh()
    })
  }

  function handleCancel() {
    setPending({ ...committed })
    closeCustDrop()
    setContactOpen(false)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">Customer</h2>
        <div className="flex items-center gap-2">
          {toast && (
            <span className={`text-xs font-medium ${toast.ok ? 'text-green-600' : 'text-red-600'}`}>
              {toast.msg}
            </span>
          )}
          {isDirty && (
            <>
              <button
                onClick={handleCancel}
                disabled={saving}
                className="rounded px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-md bg-qm-lime px-3 py-1 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50 transition-all"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Customer field ── */}
      <div ref={custDropRef} className="relative">
        {isOwnerOrAdmin && allowCustomerChange ? (
          <>
            <button
              type="button"
              onClick={() => { setCustOpen((o) => !o); if (custOpen) closeCustDrop() }}
              className={`w-full flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm text-left transition-colors ${
                custOpen
                  ? 'border-qm-lime ring-1 ring-qm-lime bg-white'
                  : 'border-gray-300 bg-white hover:border-gray-400'
              }`}
            >
              <span className="min-w-0 flex-1">
                {pending.customerName ? (
                  <span className="block">
                    {pending.companyName && (
                      <span className="font-semibold text-gray-900 mr-1">{pending.companyName}</span>
                    )}
                    <span className={pending.companyName ? 'text-gray-500 text-xs' : 'font-medium text-gray-900'}>
                      {pending.customerName}
                    </span>
                  </span>
                ) : (
                  <span className="text-gray-400 italic">No customer assigned</span>
                )}
              </span>
              <svg className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${custOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
              </svg>
            </button>

            {custOpen && (
              <div className="absolute left-0 top-full mt-1 z-[100] w-full min-w-[280px] rounded-md border border-gray-200 bg-white shadow-lg overflow-hidden">
                {!showAddForm ? (
                  <>
                    {/* Search input */}
                    <div className="p-2 border-b border-gray-100">
                      <div className="relative">
                        {isSearching ? (
                          <svg className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-qm-lime animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                          </svg>
                        ) : (
                          <svg className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                          </svg>
                        )}
                        <input
                          autoFocus
                          type="text"
                          placeholder="Search customers…"
                          value={custSearch}
                          onChange={(e) => handleCustSearchChange(e.target.value)}
                          className="block w-full rounded border border-gray-200 py-1.5 pl-7 pr-3 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                        />
                      </div>
                    </div>

                    {/* Results */}
                    <div className="max-h-52 overflow-y-auto">
                      {custResults.length > 0 ? (
                        custResults.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            disabled={saving}
                            onClick={() => selectCustomer(r.id, r.name, r.company)}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-qm-lime-light transition-colors disabled:opacity-50"
                          >
                            <div className="min-w-0">
                              {r.company && <p className="font-medium text-gray-900 truncate">{r.company}</p>}
                              <p className={r.company ? 'text-xs text-gray-500 truncate' : 'font-medium text-gray-900 truncate'}>{r.name}</p>
                            </div>
                            {r.status && (
                              <span className={`shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[r.status] ?? 'bg-gray-100 text-gray-600'}`}>
                                {r.status}
                              </span>
                            )}
                          </button>
                        ))
                      ) : custSearch.trim().length >= 2 && !isSearching ? (
                        <p className="px-3 py-3 text-xs text-gray-400 text-center">No customers found</p>
                      ) : null}
                    </div>

                    {/* Add New Customer — pinned at bottom */}
                    <div className="border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => { setShowAddForm(true); setCustSearch(''); setCustResults([]) }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-qm-lime hover:bg-qm-lime-light transition-colors"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        Add New Customer
                      </button>
                    </div>
                  </>
                ) : (
                  /* Quick-add mini-form */
                  <div className="p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-600 mb-1">New customer</p>
                    {addError && (
                      <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{addError}</p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        autoFocus
                        type="text"
                        placeholder="First name *"
                        value={addFirst}
                        onChange={(e) => setAddFirst(e.target.value)}
                        className={ic}
                      />
                      <input
                        type="text"
                        placeholder="Last name *"
                        value={addLast}
                        onChange={(e) => setAddLast(e.target.value)}
                        className={ic}
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="Company (optional)"
                      value={addCompany}
                      onChange={(e) => setAddCompany(e.target.value)}
                      className={ic}
                    />
                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() => setShowAddForm(false)}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        ← Back
                      </button>
                      <button
                        type="button"
                        disabled={isAdding || !addFirst.trim() || !addLast.trim()}
                        onClick={handleQuickAdd}
                        className="rounded-md bg-qm-lime px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50 transition-all"
                      >
                        {isAdding ? 'Creating…' : 'Create & Select'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          /* Read-only view for non-admin roles */
          <div>
            {committed.customerName ? (
              <>
                {committed.companyName && <p className="font-semibold text-gray-900">{committed.companyName}</p>}
                <p className={committed.companyName ? 'text-sm text-gray-600' : 'font-semibold text-gray-900'}>{committed.customerName}</p>
              </>
            ) : (
              <p className="text-sm text-gray-400 italic">No customer assigned</p>
            )}
          </div>
        )}
      </div>

      {/* ── Contact field ── */}
      {pending.customerId && (
        <div ref={contactDropRef} className="relative mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Contact</p>
          {isOwnerOrAdmin ? (
            <>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { if (contactOpen) { setContactOpen(false) } else { openContactDrop() } }}
                  className={`flex-1 flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm text-left transition-colors ${
                    contactOpen
                      ? 'border-qm-lime ring-1 ring-qm-lime bg-white'
                      : 'border-gray-300 bg-white hover:border-gray-400'
                  }`}
                >
                  <span className={pending.contactName ? 'text-gray-900 font-medium' : 'text-gray-400 italic'}>
                    {pending.contactName ?? 'None assigned'}
                  </span>
                  <svg className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${contactOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                  </svg>
                </button>

                {/* Clear button */}
                {pending.contactId && (
                  <button
                    type="button"
                    onClick={() => selectContact(null, null)}
                    title="Clear contact"
                    className="shrink-0 rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {contactOpen && (
                <div className="absolute left-0 top-full mt-1 z-[100] w-full rounded-md border border-gray-200 bg-white shadow-lg overflow-hidden">
                  {isLoadingContacts ? (
                    <p className="px-3 py-3 text-sm text-gray-400">Loading contacts…</p>
                  ) : contactOptions.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-gray-400 italic">No contacts on file.</p>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => selectContact(null, null)}
                        className="w-full px-3 py-2.5 text-left text-sm text-gray-400 italic hover:bg-gray-50 border-b border-gray-100 transition-colors"
                      >
                        Clear / No contact
                      </button>
                      <div className="max-h-48 overflow-y-auto">
                        {contactOptions.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => selectContact(c.id, c.full_name)}
                            className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-qm-lime-light transition-colors ${
                              c.id === pending.contactId ? 'bg-qm-lime-light font-medium' : ''
                            }`}
                          >
                            <span className="text-gray-900 truncate">{c.full_name}</span>
                            <span className="shrink-0 flex items-center gap-1.5">
                              {c.title && <span className="text-xs text-gray-500">{c.title}</span>}
                              {c.is_primary && (
                                <span className="text-xs font-semibold text-qm-lime-dark bg-qm-lime-light rounded-full px-1.5 py-0.5">
                                  Primary
                                </span>
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-700">
              {committed.contactName ?? <span className="text-gray-400 italic">None assigned</span>}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
