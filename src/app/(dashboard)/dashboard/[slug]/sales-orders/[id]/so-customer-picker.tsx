'use client'

import { useState, useRef, useEffect, useTransition, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { searchCustomers } from '@/app/(dashboard)/dashboard/[slug]/customers/actions'
import {
  assignCustomerToSalesOrder,
  assignContactToSalesOrder,
  fetchContactsForCustomer,
  type ContactOption,
} from '@/app/(dashboard)/dashboard/[slug]/assign-actions'
import CreateCustomerForm from '@/app/(dashboard)/dashboard/[slug]/customers/create-customer-form'
import CreateContactModal from '@/app/(dashboard)/dashboard/[slug]/customers/create-contact-modal'
import { getCustomerById } from '@/app/(dashboard)/dashboard/[slug]/customers/actions'

type CustomerResult = { id: string; name: string; company: string | null; status: string | null; isActive: boolean | null }

type Props = {
  soId: string
  orgId: string
  orgSlug: string
  initialCustomerId: string | null
  initialCustomerName: string | null
  initialCompanyName: string | null
  initialContactId: string | null
  initialContactName: string | null
  canReassign: boolean
}

const STATUS_BADGE: Record<string, string> = {
  lead: 'bg-gray-100 text-gray-700',
  prospect: 'bg-yellow-50 text-yellow-700',
  closable: 'bg-blue-50 text-blue-700',
  sold: 'bg-green-50 text-green-700',
}

function PencilIcon() {
  return (
    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" />
    </svg>
  )
}

export default function SoCustomerPicker({
  soId, orgId, orgSlug,
  initialCustomerId, initialCustomerName, initialCompanyName,
  initialContactId, initialContactName,
  canReassign,
}: Props) {
  const router = useRouter()

  const [customerId, setCustomerId]     = useState(initialCustomerId)
  const [customerName, setCustomerName] = useState(initialCustomerName)
  const [companyName, setCompanyName]   = useState(initialCompanyName)
  const [contactId, setContactId]       = useState(initialContactId)
  const [contactName, setContactName]   = useState(initialContactName)

  const [pendingCustId, setPendingCustId]           = useState<string | null>(null)
  const [pendingCustName, setPendingCustName]       = useState<string | null>(null)
  const [pendingCustCo, setPendingCustCo]           = useState<string | null>(null)
  const [pendingContactId, setPendingContactId]     = useState<string | null | undefined>(undefined)
  const [pendingContactName, setPendingContactName] = useState<string | null | undefined>(undefined)

  const [open, setOpen]               = useState(false)
  const [search, setSearch]           = useState('')
  const [results, setResults]         = useState<CustomerResult[]>([])
  const [isSearching, setIsSearching] = useState(false)

  const [contactOpts, setContactOpts]           = useState<ContactOption[]>([])
  const [contactDropOpen, setContactDropOpen]   = useState(false)
  const [loadingContacts, setLoadingContacts]   = useState(false)

  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [saving, startSave] = useTransition()

  const dropRef      = useRef<HTMLDivElement>(null)
  const contactRef   = useRef<HTMLDivElement>(null)
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seqRef       = useRef(0)
  const toastTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasPending = pendingCustId !== null || pendingContactId !== undefined
  const [showCustModal, setShowCustModal] = useState(false)
  const [showContactModal, setShowContactModal] = useState(false)

  function flash(msg: string, ok: boolean) {
    setToast({ msg, ok })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }

  const closeDropdown = useCallback(() => {
    setOpen(false)
    setSearch('')
    setResults([])
    setIsSearching(false)
  }, [])

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) closeDropdown()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open, closeDropdown])

  useEffect(() => {
    if (!contactDropOpen) return
    function handle(e: MouseEvent) {
      if (contactRef.current && !contactRef.current.contains(e.target as Node)) setContactDropOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [contactDropOpen])

  function handleSearchChange(val: string) {
    setSearch(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const term = val.trim()
    if (term.length < 2) { setResults([]); setIsSearching(false); return }
    setIsSearching(true)
    const seq = ++seqRef.current
    debounceRef.current = setTimeout(async () => {
      const rows = await searchCustomers(orgId, term, {})
      if (seqRef.current !== seq) return
      setResults(rows.map((r) => ({
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
    setPendingCustId(id)
    setPendingCustName(name)
    setPendingCustCo(company)
    setPendingContactId(null)
    setPendingContactName(null)
    setContactOpts([])
    closeDropdown()
  }

  async function openContactDrop() {
    const cid = pendingCustId ?? customerId
    if (!cid) return
    setContactDropOpen(true)
    if (contactOpts.length === 0) {
      setLoadingContacts(true)
      const opts = await fetchContactsForCustomer(cid, orgId)
      setContactOpts(opts)
      setLoadingContacts(false)
    }
  }

  function selectContact(id: string | null, name: string | null) {
    setPendingContactId(id)
    setPendingContactName(name)
    setContactDropOpen(false)
  }

  function handleCancel() {
    setPendingCustId(null); setPendingCustName(null); setPendingCustCo(null)
    setPendingContactId(undefined); setPendingContactName(undefined)
    setContactOpts([])
    setContactDropOpen(false)
  }

  function handleSave() {
    startSave(async () => {
      if (pendingCustId && pendingCustId !== customerId) {
        const res = await assignCustomerToSalesOrder(soId, orgId, orgSlug, pendingCustId)
        if (res.error) { flash(res.error, false); return }
        setCustomerId(pendingCustId)
        setCustomerName(pendingCustName)
        setCompanyName(pendingCustCo)
        setContactId(null); setContactName(null)
      }

      if (pendingContactId !== undefined && pendingContactId !== contactId) {
        const res = await assignContactToSalesOrder(soId, orgId, orgSlug, pendingContactId)
        if (res.error) { flash(res.error, false); return }
        setContactId(pendingContactId ?? null)
        setContactName(pendingContactName ?? null)
      }

      handleCancel()
      flash('Customer updated', true)
      router.refresh()
    })
  }

  const displayName    = hasPending ? pendingCustName    : customerName
  const displayCompany = hasPending ? pendingCustCo      : companyName
  const displayContact = pendingContactId !== undefined ? pendingContactName : contactName

  return (
    <div className="mt-1">
      {toast && (
        <p className={`text-xs font-medium mb-1 ${toast.ok ? 'text-green-600' : 'text-red-600'}`}>
          {toast.msg}
        </p>
      )}

      <div ref={dropRef} className="relative">
        <div className="group flex items-start gap-1.5">
          <div>
            {displayCompany ? (
              <>
                <p className="text-sm font-semibold text-gray-900">{displayCompany}</p>
                {displayName && <p className="text-xs text-gray-500">{displayName}</p>}
              </>
            ) : (
              <p className="text-sm text-gray-600">
                {displayName ?? <span className="text-gray-400 italic">No customer assigned</span>}
              </p>
            )}
          </div>

          {canReassign && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              title="Reassign customer"
            >
              <PencilIcon />
            </button>
          )}
        </div>

        {open && (
          <div className="absolute left-0 top-full mt-1 z-[200] w-72 rounded-lg border border-gray-200 bg-white shadow-xl overflow-hidden">
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
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="block w-full rounded border border-gray-200 py-1.5 pl-7 pr-3 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                />
              </div>
            </div>

            <div className="max-h-52 overflow-y-auto">
              {results.length > 0 ? (
                results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => selectCustomer(r.id, r.name, r.company)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-qm-lime-light transition-colors"
                  >
                    <div className="min-w-0">
                      {r.company && <p className="font-medium text-gray-900 truncate">{r.company}</p>}
                      <p className={r.company ? 'text-xs text-gray-500 truncate' : 'font-medium text-gray-900 truncate'}>{r.name}</p>
                    </div>
                    {r.isActive === false ? (
                      <span className="shrink-0 text-xs font-medium rounded-full px-1.5 py-0.5 bg-gray-100 text-gray-500">
                        Disabled
                      </span>
                    ) : r.status ? (
                      <span className={`shrink-0 text-xs font-medium rounded-full px-1.5 py-0.5 capitalize ${STATUS_BADGE[r.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {r.status}
                      </span>
                    ) : null}
                  </button>
                ))
              ) : search.trim().length >= 2 && !isSearching ? (
                <p className="px-3 py-3 text-xs text-gray-400 text-center">No customers found</p>
              ) : null}
            </div>

            <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-between">
              <button
                type="button"
                onClick={closeDropdown}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); setShowCustModal(true); closeDropdown() }}
                className="flex items-center gap-1 text-xs font-semibold text-qm-lime hover:underline"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add New Customer
              </button>
            </div>
          </div>
        )}
      </div>

      {canReassign && (
        <div ref={contactRef} className="relative mt-1">
          <div className="group flex items-center gap-1.5">
            <span className="text-xs text-gray-500">
              Contact:{' '}
              <span className={displayContact ? 'text-gray-700 font-medium' : 'text-gray-400 italic'}>
                {displayContact ?? 'none'}
              </span>
            </span>
            <button
              type="button"
              onClick={() => { if (contactDropOpen) setContactDropOpen(false); else openContactDrop() }}
              className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              title="Set contact"
            >
              <PencilIcon />
            </button>
          </div>

          {contactDropOpen && (
            <div className="absolute left-0 top-full mt-1 z-[200] w-60 rounded-lg border border-gray-200 bg-white shadow-xl overflow-hidden">
              {loadingContacts ? (
                <p className="px-3 py-3 text-xs text-gray-400">Loading…</p>
              ) : contactOpts.length === 0 ? (
                <p className="px-3 py-3 text-xs text-gray-400 italic">No contacts on file.</p>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => selectContact(null, null)}
                    className="w-full px-3 py-2 text-left text-xs text-gray-400 italic hover:bg-gray-50 border-b border-gray-100"
                  >
                    No contact
                  </button>
                  <div className="max-h-40 overflow-y-auto">
                    {contactOpts.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectContact(c.id, c.full_name)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-qm-lime-light transition-colors"
                      >
                        <span className="text-gray-900 truncate">{c.full_name}</span>
                        {c.is_primary && (
                          <span className="text-xs font-semibold text-qm-lime-dark bg-qm-lime-light rounded-full px-1.5 py-0.5 shrink-0">
                            Primary
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-gray-100 px-3 py-2">
                    <button
                      type="button"
                      onMouseDown={e => { e.preventDefault(); setShowContactModal(true); setContactDropOpen(false) }}
                      className="flex items-center gap-1 text-xs font-semibold text-qm-lime hover:underline"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      Add New Contact
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {hasPending && (
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="rounded-md bg-qm-lime px-3 py-1 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50 transition-all"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleCancel}
            className="rounded-md px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      )}
      {showCustModal && (
        <CreateCustomerForm
          orgId={orgId}
          orgSlug={orgSlug}
          salesReps={[]}
          initialOpen={true}
          onSuccess={async (newCustomerId?: string) => {
            setShowCustModal(false)
            if (newCustomerId) {
              const c = await getCustomerById(orgId, newCustomerId)
              if (c) {
                selectCustomer(c.id, `${c.first_name} ${c.last_name}`.trim(), c.company_name)
              }
            }
          }}
        />
      )}
      {showContactModal && (pendingCustId ?? customerId) && (
        <CreateContactModal
          customerId={pendingCustId ?? customerId ?? ''}
          orgId={orgId}
          orgSlug={orgSlug}
          onClose={() => setShowContactModal(false)}
          onSuccess={(newContactId, contactName) => {
            setShowContactModal(false)
            if (newContactId && contactName) {
              setContactOpts(prev => [{ id: newContactId, full_name: contactName, title: null, phone: null, is_primary: false }, ...prev])
              selectContact(newContactId, contactName)
            }
          }}
        />
      )}
    </div>
  )
}
