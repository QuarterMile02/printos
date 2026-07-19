'use client'

import { useState, useRef, useTransition, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { searchCustomers } from '@/app/(dashboard)/dashboard/[slug]/customers/actions'
import {
  assignCustomerToQuote, assignContactToQuote,
  assignCustomerToSalesOrder, assignContactToSalesOrder,
  assignCustomerToJob, assignContactToJob,
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
  isActive: boolean | null
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

function PencilIcon() {
  return (
    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" />
    </svg>
  )
}

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

  // Pending (locally staged) state
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

  // Customer edit dropdown
  const [custOpen, setCustOpen] = useState(false)
  const [custSearch, setCustSearch] = useState('')
  const [custResults, setCustResults] = useState<CustomerResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const custDropRef = useRef<HTMLDivElement>(null)



  // Quick-add mini-form
  const [showAddForm, setShowAddForm] = useState(false)
  const [addFirst, setAddFirst] = useState('')
  const [addLast, setAddLast] = useState('')
  const [addCompany, setAddCompany] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [isAdding, startAdding] = useTransition()

  // Contact edit dropdown
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
      if (custDropRef.current && !custDropRef.current.contains(e.target as Node)) closeCustDrop()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [custOpen, closeCustDrop])

  const closeContactDrop = useCallback(() => setContactOpen(false), [])

  useEffect(() => {
    if (!contactOpen) return
    function handle(e: MouseEvent) {
      if (contactDropRef.current && !contactDropRef.current.contains(e.target as Node)) closeContactDrop()
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
        isActive: r.is_active ?? null,
      })))
      setIsSearching(false)
    }, 300)
  }

  function selectCustomer(id: string, name: string, company: string | null) {
    setPending((p) => ({ ...p, customerId: id, customerName: name, companyName: company, contactId: null, contactName: null }))
    setContactOptions([])
    closeCustDrop()
  }

  // ── Quick-add ─────────────────────────────────────────────────────────────

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

  useEffect(() => { setContactOptions([]) }, [pending.customerId])

  function selectContact(id: string | null, name: string | null) {
    setPending((p) => ({ ...p, contactId: id, contactName: name }))
    setContactOpen(false)
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  function handleSave() {
    startSave(async () => {
      if (pending.customerId !== committed.customerId) {
        if (recordType === 'quote') {
          const res = await assignCustomerToQuote(recordId, orgId, orgSlug, pending.customerId)
          if (res.error) { flash(res.error, false); return }
        } else if (recordType === 'sales_order') {
          const res = await assignCustomerToSalesOrder(recordId, orgId, orgSlug, pending.customerId)
          if (res.error) { flash(res.error, false); return }
        } else if (recordType === 'job') {
          const res = await assignCustomerToJob(recordId, orgId, orgSlug, pending.customerId)
          if (res.error) { flash(res.error, false); return }
        }
      }
      if (pending.contactId !== committed.contactId) {
        const contactAction = recordType === 'quote'
          ? assignContactToQuote
          : recordType === 'sales_order' ? assignContactToSalesOrder : assignContactToJob
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

  const customerDetailUrl = pending.customerId
    ? `/dashboard/${orgSlug}/customers/${pending.customerId}`
    : null

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      {/* Header */}
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

      {/* ── Customer row ── */}
      <div ref={custDropRef} className="relative">
        <div className="group flex items-center gap-2">
          {/* Avatar */}
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600 select-none">
            {(pending.customerName ?? '?')[0]?.toUpperCase()}
          </span>

          {/* Name — clickable link + hover pencil */}
          <div className="min-w-0 flex-1">
            {pending.customerName ? (
              pending.companyName ? (
                <>
                  <p className="font-semibold text-gray-900 truncate leading-tight">{pending.companyName}</p>
                  {customerDetailUrl ? (
                    <a
                      href={customerDetailUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-gray-500 hover:underline leading-tight"
                    >
                      {pending.customerName}
                    </a>
                  ) : (
                    <span className="text-sm text-gray-500 leading-tight">{pending.customerName}</span>
                  )}
                </>
              ) : (
                <>
                  {customerDetailUrl ? (
                    <a
                      href={customerDetailUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-gray-900 hover:underline leading-snug"
                    >
                      {pending.customerName}
                    </a>
                  ) : (
                    <span className="font-semibold text-gray-900 leading-snug">{pending.customerName}</span>
                  )}
                </>
              )
            ) : pending.customerId ? (
              <span className="text-sm text-gray-400 italic">Loading...</span>
            ) : (
              <span className="text-sm text-gray-400 italic">No customer assigned</span>
            )}
          </div>

          {/* Hover pencil — owner/admin + allowCustomerChange only */}
          {isOwnerOrAdmin && allowCustomerChange && (
            <button
              type="button"
              onClick={() => setCustOpen(true)}
              title="Change customer"
              className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            >
              <PencilIcon />
            </button>
          )}
        </div>

        {/* Customer edit dropdown */}
        {custOpen && (
          <div className="absolute left-0 top-full mt-1 z-[100] w-full min-w-[300px] rounded-md border border-gray-200 bg-white shadow-lg overflow-hidden">
            {!showAddForm ? (
              <>
                {/* Search */}
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
                        {r.isActive === false ? (
                          <span className="shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-500">
                            Disabled
                          </span>
                        ) : r.status ? (
                          <span className={`shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[r.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {r.status}
                          </span>
                        ) : null}
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
                <p className="text-xs font-semibold text-gray-600">New customer</p>
                {addError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{addError}</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <input autoFocus type="text" placeholder="First name *" value={addFirst} onChange={(e) => setAddFirst(e.target.value)} className={ic} />
                  <input type="text" placeholder="Last name *" value={addLast} onChange={(e) => setAddLast(e.target.value)} className={ic} />
                </div>
                <input type="text" placeholder="Company (optional)" value={addCompany} onChange={(e) => setAddCompany(e.target.value)} className={ic} />
                <div className="flex items-center justify-between pt-1">
                  <button type="button" onClick={() => setShowAddForm(false)} className="text-xs text-gray-500 hover:text-gray-700">
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
      </div>

      {/* ── Contact row ── */}
      {pending.customerId && (
        <div ref={contactDropRef} className="relative mt-2.5 pt-2.5 border-t border-gray-100">
          <div className="group flex items-center gap-2">
            {/* Avatar */}
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-50 border border-gray-200 text-xs font-medium text-gray-400 select-none">
              {pending.contactName ? pending.contactName[0]?.toUpperCase() : '—'}
            </span>

            {/* Contact name */}
            <div className="min-w-0 flex-1">
              {pending.contactName ? (
                <span className="text-sm text-gray-700 hover:underline cursor-default leading-snug">
                  {pending.contactName}
                </span>
              ) : (
                <span className="text-xs text-gray-400 italic">No contact assigned</span>
              )}
            </div>

            {/* Hover pencil — owner/admin */}
            {isOwnerOrAdmin && (
              <button
                type="button"
                onClick={() => { if (contactOpen) { setContactOpen(false) } else { openContactDrop() } }}
                title="Change contact"
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              >
                <PencilIcon />
              </button>
            )}
          </div>

          {/* Contact dropdown */}
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
        </div>
      )}
    </div>
  )
}
