'use client'

import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { searchCustomers } from '@/app/(dashboard)/dashboard/[slug]/customers/actions'
import {
  assignCustomerToQuote, assignContactToQuote,
  assignCustomerToSalesOrder, assignContactToSalesOrder,
  assignContactToJob,
  fetchContactsForCustomer,
  type ContactOption,
} from '@/app/(dashboard)/dashboard/[slug]/assign-actions'

type RecordType = 'quote' | 'sales_order' | 'job'

type CustomerResult = {
  id: string
  name: string
  company: string | null
  city: string | null
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

function PencilIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
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

  const [customerId, setCustomerId] = useState(initialCustomerId)
  const [customerName, setCustomerName] = useState(initialCustomerName)
  const [companyName, setCompanyName] = useState(initialCompanyName)
  const [contactId, setContactId] = useState(initialContactId)
  const [contactName, setContactName] = useState(initialContactName)

  const [mode, setMode] = useState<'view' | 'edit-customer' | 'edit-contact'>('view')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<CustomerResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [contactOptions, setContactOptions] = useState<ContactOption[]>([])
  const [isLoadingContacts, setIsLoadingContacts] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [saving, startSave] = useTransition()

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeqRef = useRef(0)

  function flash(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Customer search ────────────────────────────────────────────────────────

  function handleSearchChange(val: string) {
    setSearch(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const term = val.trim()
    if (term.length < 2) { setResults([]); setIsSearching(false); return }
    setIsSearching(true)
    const seq = ++searchSeqRef.current
    debounceRef.current = setTimeout(async () => {
      const rows = await searchCustomers(orgId, term, {})
      if (searchSeqRef.current !== seq) return
      setResults(rows.map((r) => ({
        id: r.id,
        name: `${r.first_name} ${r.last_name}`,
        company: r.company_name,
        city: r.city,
      })))
      setIsSearching(false)
    }, 300)
  }

  function handleSelectCustomer(id: string, name: string, company: string | null) {
    startSave(async () => {
      const action = recordType === 'quote'
        ? assignCustomerToQuote
        : assignCustomerToSalesOrder
      const res = await action(recordId, orgId, orgSlug, id)
      if (res.error) { flash(res.error, false); return }
      setCustomerId(id)
      setCustomerName(name)
      setCompanyName(company)
      setContactId(null)
      setContactName(null)
      setMode('view')
      setSearch('')
      setResults([])
      flash('Customer updated', true)
      router.refresh()
    })
  }

  // ── Contact picker ─────────────────────────────────────────────────────────

  async function openContactEditor() {
    if (!customerId) return
    setMode('edit-contact')
    setIsLoadingContacts(true)
    const opts = await fetchContactsForCustomer(customerId, orgId)
    setContactOptions(opts)
    setIsLoadingContacts(false)
  }

  function handleSelectContact(id: string | null, name: string | null) {
    startSave(async () => {
      const action = recordType === 'quote'
        ? assignContactToQuote
        : recordType === 'sales_order'
          ? assignContactToSalesOrder
          : assignContactToJob
      const res = await action(recordId, orgId, orgSlug, id)
      if (res.error) { flash(res.error, false); return }
      setContactId(id)
      setContactName(name)
      setMode('view')
      flash('Contact updated', true)
      router.refresh()
    })
  }

  function cancel() {
    setMode('view')
    setSearch('')
    setResults([])
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">Customer</h2>
        {toast && (
          <span className={`text-xs font-medium ${toast.ok ? 'text-green-600' : 'text-red-600'}`}>
            {toast.msg}
          </span>
        )}
      </div>

      {/* ── View mode ── */}
      {mode === 'view' && (
        <div className="space-y-2">
          {/* Customer row */}
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              {customerName ? (
                <>
                  {companyName && <p className="font-semibold text-gray-900">{companyName}</p>}
                  <p className={companyName ? 'text-sm text-gray-600' : 'font-semibold text-gray-900'}>{customerName}</p>
                </>
              ) : (
                <p className="text-sm text-gray-400 italic">No customer assigned</p>
              )}
            </div>
            {isOwnerOrAdmin && allowCustomerChange && (
              <button
                onClick={() => setMode('edit-customer')}
                title="Change customer"
                className="mt-0.5 shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                <PencilIcon />
              </button>
            )}
          </div>

          {/* Contact row */}
          {isOwnerOrAdmin && customerId && (
            <div className="flex items-center gap-2 border-t border-gray-100 pt-2 mt-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500">
                  Contact: {contactName
                    ? <span className="font-medium text-gray-700">{contactName}</span>
                    : <span className="italic text-gray-400">none assigned</span>}
                </p>
              </div>
              <button
                onClick={openContactEditor}
                title="Change contact"
                className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                <PencilIcon />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Edit customer mode ── */}
      {mode === 'edit-customer' && (
        <div>
          <div className="relative">
            {isSearching ? (
              <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-qm-lime animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            ) : (
              <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            )}
            <input
              autoFocus
              type="text"
              placeholder="Search customers…"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="block w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
          </div>

          {results.length > 0 && (
            <div className="mt-1 rounded-md border border-gray-200 bg-white shadow-md max-h-52 overflow-y-auto">
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  disabled={saving}
                  onClick={() => handleSelectCustomer(r.id, r.name, r.company)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-qm-lime-light transition-colors disabled:opacity-50"
                >
                  <div className="min-w-0">
                    {r.company && <p className="font-medium text-gray-900 truncate">{r.company}</p>}
                    <p className={r.company ? 'text-xs text-gray-500 truncate' : 'font-medium text-gray-900 truncate'}>{r.name}</p>
                    {r.city && <p className="text-xs text-gray-400">{r.city}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {search.trim().length >= 2 && !isSearching && results.length === 0 && (
            <p className="mt-2 text-xs text-gray-400 text-center">No customers found</p>
          )}

          <button onClick={cancel} className="mt-2 text-xs text-gray-500 hover:text-gray-700">
            Cancel
          </button>
        </div>
      )}

      {/* ── Edit contact mode ── */}
      {mode === 'edit-contact' && (
        <div>
          {isLoadingContacts ? (
            <p className="text-sm text-gray-400 py-2">Loading contacts…</p>
          ) : contactOptions.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">No contacts on file for this customer.</p>
          ) : (
            <div className="rounded-md border border-gray-200 overflow-hidden">
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSelectContact(null, null)}
                className="w-full px-3 py-2.5 text-left text-sm text-gray-400 italic hover:bg-gray-50 border-b border-gray-100 disabled:opacity-50 transition-colors"
              >
                Clear / No contact
              </button>
              {contactOptions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={saving}
                  onClick={() => handleSelectContact(c.id, c.full_name)}
                  className={`w-full px-3 py-2.5 text-left text-sm hover:bg-qm-lime-light transition-colors disabled:opacity-50 ${c.id === contactId ? 'bg-qm-lime-light font-medium' : ''}`}
                >
                  <span className="text-gray-900">{c.full_name}</span>
                  {c.title && <span className="ml-2 text-xs text-gray-500">{c.title}</span>}
                  {c.is_primary && <span className="ml-2 text-xs text-qm-lime-dark font-semibold">Primary</span>}
                </button>
              ))}
            </div>
          )}
          <button onClick={cancel} className="mt-2 text-xs text-gray-500 hover:text-gray-700">
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
