'use client'

import { useState, useTransition, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createQuote } from '../actions'
import { searchCustomers, createCustomer, saveContact } from '@/app/(dashboard)/dashboard/[slug]/customers/actions'
import {
  fetchContactsForCustomer,
  type ContactOption,
} from '@/app/(dashboard)/dashboard/[slug]/assign-actions'

type CustomerResult = {
  id: string
  name: string
  company: string | null
  status: string | null
}

type TeamMember = { id: string; name: string }

type Props = {
  orgId: string
  orgSlug: string
  teamMembers: TeamMember[]
  currentUserId: string | null
}

const inp = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
const inpSm = 'block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
const errBorder = 'border-red-400 focus:border-red-400 focus:ring-red-400'

export default function NewQuoteForm({ orgId, orgSlug, teamMembers, currentUserId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string>>({})

  // ── Customer search ──────────────────────────────────────────────────────
  const [customerId, setCustomerId]           = useState('')
  const [customerDisplay, setCustomerDisplay] = useState('')
  const [custSearch, setCustSearch]           = useState('')
  const [custOpen, setCustOpen]               = useState(false)
  const [custResults, setCustResults]         = useState<CustomerResult[]>([])
  const [isSearching, setIsSearching]         = useState(false)
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeqRef = useRef(0)
  const custDropRef  = useRef<HTMLDivElement>(null)

  // ── Inline new customer ──────────────────────────────────────────────────
  const [showNewCust, setShowNewCust]         = useState(false)
  const [newCustCompany, setNewCustCompany]   = useState('')
  const [newCustFirst, setNewCustFirst]       = useState('')
  const [newCustLast, setNewCustLast]         = useState('')
  const [newCustEmail, setNewCustEmail]       = useState('')
  const [newCustPhone, setNewCustPhone]       = useState('')
  const [newCustSaving, setNewCustSaving]     = useState(false)
  const [newCustError, setNewCustError]       = useState('')

  // ── Inline new contact ───────────────────────────────────────────────────
  const [showNewContact, setShowNewContact]       = useState(false)
  const [newContactName, setNewContactName]       = useState('')
  const [newContactEmail, setNewContactEmail]     = useState('')
  const [newContactPhone, setNewContactPhone]     = useState('')
  const [newContactSaving, setNewContactSaving]   = useState(false)
  const [newContactError, setNewContactError]     = useState('')

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (custDropRef.current && !custDropRef.current.contains(e.target as Node)) {
        setCustOpen(false)
        if (!showNewCust) return
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showNewCust])

  function handleCustSearchChange(val: string) {
    setCustSearch(val)
    setCustomerId('')
    setCustomerDisplay('')
    setShowNewCust(false)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const term = val.trim()
    if (term.length < 2) { setCustResults([]); setIsSearching(false); return }
    setIsSearching(true)
    const seq = ++searchSeqRef.current
    debounceRef.current = setTimeout(async () => {
      const rows = await searchCustomers(orgId, term, {})
      if (searchSeqRef.current !== seq) return
      setCustResults(rows.map(r => ({ id: r.id, name: `${r.first_name} ${r.last_name}`, company: r.company_name, status: r.status })))
      setIsSearching(false)
    }, 300)
  }

  function selectCustomer(id: string, name: string, company: string | null) {
    setCustomerId(id)
    setCustomerDisplay(company ? `${company} – ${name}` : name)
    setCustSearch('')
    setCustOpen(false)
    setCustResults([])
    setShowNewCust(false)
    setContactId('')
    setContactInputValue('')
    setContactOptions([])
    setShowNewContact(false)
    loadContacts(id)
    setErrors(e => ({ ...e, customerId: '' }))
  }

  function clearCustomer() {
    setCustomerId(''); setCustomerDisplay(''); setCustSearch('')
    setContactId(''); setContactInputValue(''); setContactOptions([])
    setShowNewCust(false); setShowNewContact(false)
    setNewCustCompany(''); setNewCustFirst(''); setNewCustLast('')
    setNewCustEmail(''); setNewCustPhone(''); setNewCustError('')
  }

  async function handleCreateCustomer() {
    if (!newCustFirst.trim()) { setNewCustError('First name is required.'); return }
    if (!newCustLast.trim())  { setNewCustError('Last name is required.');  return }
    setNewCustError('')
    setNewCustSaving(true)
    const fd = new FormData()
    fd.set('first_name', newCustFirst.trim())
    fd.set('last_name',  newCustLast.trim())
    if (newCustCompany.trim()) fd.set('company_name', newCustCompany.trim())
    if (newCustEmail.trim())   fd.set('email', newCustEmail.trim())
    if (newCustPhone.trim())   fd.set('phone', newCustPhone.trim())
    fd.set('status', 'lead')
    const result = await createCustomer(orgId, orgSlug, fd)
    if (result.error) { setNewCustError(result.error); setNewCustSaving(false); return }
    // Find the newly created customer
    const term = newCustCompany.trim() || `${newCustFirst.trim()} ${newCustLast.trim()}`
    const rows = await searchCustomers(orgId, term, {})
    const match = rows.find(r => r.first_name === newCustFirst.trim() && r.last_name === newCustLast.trim())
    if (match) selectCustomer(match.id, `${match.first_name} ${match.last_name}`, match.company_name)
    setNewCustSaving(false)
    setShowNewCust(false)
    setNewCustCompany(''); setNewCustFirst(''); setNewCustLast('')
    setNewCustEmail(''); setNewCustPhone('')
  }

  // ── Contact ──────────────────────────────────────────────────────────────
  const [contactId, setContactId]                 = useState('')
  const [contactInputValue, setContactInputValue] = useState('')
  const [contactOptions, setContactOptions]       = useState<ContactOption[]>([])
  const [contactOpen, setContactOpen]             = useState(false)
  const [isLoadingContacts, setIsLoadingContacts] = useState(false)
  const contactDropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (contactDropRef.current && !contactDropRef.current.contains(e.target as Node)) {
        setContactOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  async function loadContacts(custId: string) {
    setIsLoadingContacts(true)
    const opts = await fetchContactsForCustomer(custId, orgId)
    setContactOptions(opts)
    setIsLoadingContacts(false)
  }

  const filteredContacts = useMemo(() => {
    const q = contactInputValue.trim().toLowerCase()
    if (!q) return contactOptions
    return contactOptions.filter(c => c.full_name.toLowerCase().includes(q))
  }, [contactOptions, contactInputValue])

  async function handleCreateContact() {
    if (!newContactName.trim()) { setNewContactError('Full name is required.'); return }
    setNewContactError('')
    setNewContactSaving(true)
    const result = await saveContact(customerId, orgId, orgSlug, {
      full_name: newContactName.trim(),
      email: newContactEmail.trim() || null,
      phone: newContactPhone.trim() || null,
      is_primary: contactOptions.length === 0,
      is_ap_contact: false,
    })
    if (result.error) { setNewContactError(result.error); setNewContactSaving(false); return }
    const opts = await fetchContactsForCustomer(customerId, orgId)
    setContactOptions(opts)
    const newOpt = opts.find(c => c.id === result.id)
    if (newOpt) {
      setContactId(newOpt.id)
      setContactInputValue(newOpt.full_name)
    } else {
      setContactInputValue(newContactName.trim())
    }
    setNewContactSaving(false)
    setShowNewContact(false)
    setContactOpen(false)
    setNewContactName(''); setNewContactEmail(''); setNewContactPhone('')
  }

  // ── Form fields ──────────────────────────────────────────────────────────
  const [title, setTitle]               = useState('')
  const defaultRepId = teamMembers.some(m => m.id === currentUserId) ? (currentUserId ?? '') : ''
  const [salesRepId, setSalesRepId]     = useState(defaultRepId)
  const [dueDate, setDueDate]           = useState('')
  const [poNumber, setPoNumber]         = useState('')
  const [installAddress, setInstallAddress]       = useState('')
  const [specialOrderNotes, setSpecialOrderNotes] = useState('')

  // ── Voice-to-text ────────────────────────────────────────────────────────
  const [isListening, setIsListening] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  function toggleListening() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (typeof window !== 'undefined') && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    if (!SR) { alert('Speech recognition is not supported in this browser.'); return }
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return }
    const r = new SR()
    r.continuous = true; r.interimResults = false; r.lang = 'en-US'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (e: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = Array.from(e.results as any[]).slice(e.resultIndex).map((res: any) => res[0].transcript as string).join(' ')
      setSpecialOrderNotes(prev => prev ? `${prev} ${t}` : t)
    }
    r.onend = () => setIsListening(false)
    r.onerror = () => setIsListening(false)
    r.start(); recognitionRef.current = r; setIsListening(true)
  }

  // ── Submit ───────────────────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const newErrors: Record<string, string> = {}
    if (!customerId)               newErrors.customerId = 'Customer is required.'
    if (!contactInputValue.trim()) newErrors.contact    = 'Contact is required.'
    if (!title.trim())             newErrors.title      = 'Title is required.'
    if (!salesRepId || !teamMembers.some(m => m.id === salesRepId)) newErrors.salesRepId = 'Sales Rep is required.'
    if (Object.keys(newErrors).length) { setErrors(newErrors); return }
    setErrors({})
    startTransition(async () => {
      const result = await createQuote(orgId, orgSlug, {
        title,
        customerId: customerId || null,
        contactId: contactId || null,
        contactName: !contactId && contactInputValue.trim() ? contactInputValue.trim() : null,
        description: null, expiresAt: null, terms: null, notes: null,
        dueDate: dueDate || null,
        salesRepId: salesRepId || null,
        poNumber: poNumber || null,
        installAddress: installAddress || null,
        productionNotes: specialOrderNotes || null,
        lineItems: [],
      })
      if (result.error) setErrors({ submit: result.error })
      else if (result.quoteId) router.push(`/dashboard/${orgSlug}/quotes/${result.quoteId}`)
    })
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-6">
      {errors.submit && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">{errors.submit}</div>
      )}

      {/* ── Customer ── */}
      <div ref={custDropRef} className="relative">
        <label className="block text-sm font-medium text-gray-700">
          Customer <span className="text-red-500">*</span>
        </label>

        {customerId ? (
          <div className="mt-1 flex items-center gap-2 rounded-md border border-gray-300 bg-gray-50 px-3 py-2">
            <span className="flex-1 text-sm font-medium text-gray-900">{customerDisplay}</span>
            <button type="button" onClick={clearCustomer} className="shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="relative mt-1">
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
              type="text"
              value={custSearch}
              onChange={e => { handleCustSearchChange(e.target.value); setCustOpen(true) }}
              onFocus={() => setCustOpen(true)}
              placeholder="Search customers…"
              className={`${inp} pl-9${errors.customerId ? ' ' + errBorder : ''}`}
            />
          </div>
        )}
        {errors.customerId && <p className="mt-1 text-xs text-red-500">{errors.customerId}</p>}

        {/* Search dropdown */}
        {custOpen && !customerId && !showNewCust && (
          <div className="absolute z-20 left-0 top-full mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg overflow-hidden">
            <div className="max-h-52 overflow-y-auto">
              {custResults.length > 0 ? (
                custResults.map(r => (
                  <button key={r.id} type="button"
                    onClick={() => selectCustomer(r.id, r.name, r.company)}
                    className="w-full flex items-start justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors">
                    <div className="min-w-0">
                      {r.company && <p className="font-semibold text-gray-900 truncate">{r.company}</p>}
                      <p className={`truncate ${r.company ? 'text-xs text-gray-500' : 'font-medium text-gray-900'}`}>{r.name}</p>
                    </div>
                    {r.status && <span className="shrink-0 text-xs text-gray-400 capitalize mt-0.5">{r.status}</span>}
                  </button>
                ))
              ) : custSearch.trim().length >= 2 && !isSearching ? (
                <p className="px-3 py-2.5 text-xs text-gray-400 text-center">No customers found</p>
              ) : (
                <p className="px-3 py-2.5 text-xs text-gray-400 text-center">Type at least 2 characters to search</p>
              )}
            </div>
            {/* Add New Customer — pinned at bottom, matches PhoneLookup style */}
            <div className="border-t border-gray-100">
              <button
                type="button"
                onClick={() => { setShowNewCust(true); setCustOpen(false) }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-qm-lime hover:bg-qm-lime-light transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add New Customer
              </button>
            </div>
          </div>
        )}

        {/* Inline new customer form */}
        {showNewCust && !customerId && (
          <div className="mt-2 rounded-md border border-qm-lime/40 bg-green-50 p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-700">New Customer</p>
            <input type="text" placeholder="Company name (optional)" value={newCustCompany}
              onChange={e => setNewCustCompany(e.target.value)} className={inpSm} autoFocus />
            <div className="grid grid-cols-2 gap-2">
              <input type="text" placeholder="First name *" value={newCustFirst}
                onChange={e => setNewCustFirst(e.target.value)} className={inpSm} />
              <input type="text" placeholder="Last name *" value={newCustLast}
                onChange={e => setNewCustLast(e.target.value)} className={inpSm} />
            </div>
            <input type="text" placeholder="Email" value={newCustEmail}
              onChange={e => setNewCustEmail(e.target.value)} className={inpSm} />
            <input type="text" placeholder="Phone" value={newCustPhone}
              onChange={e => setNewCustPhone(e.target.value)} className={inpSm} />
            {newCustError && <p className="text-xs text-red-500">{newCustError}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={handleCreateCustomer} disabled={newCustSaving}
                className="rounded-md bg-qm-fuchsia px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50">
                {newCustSaving ? 'Saving…' : 'Create & Select'}
              </button>
              <button type="button" onClick={() => { setShowNewCust(false); setNewCustError('') }}
                className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Contact ── */}
      <div ref={contactDropRef} className="relative">
        <label className="block text-sm font-medium text-gray-700">
          Contact <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={contactInputValue}
          onChange={e => {
            setContactInputValue(e.target.value)
            setContactId('')
            if (customerId) setContactOpen(true)
            if (errors.contact) setErrors(er => ({ ...er, contact: '' }))
          }}
          onFocus={() => {
            if (customerId) {
              setContactOpen(true)
              if (contactOptions.length === 0 && !isLoadingContacts) loadContacts(customerId)
            }
          }}
          placeholder={customerId ? 'Search contacts or type a name…' : 'Contact name'}
          className={`${inp}${errors.contact ? ' ' + errBorder : ''}`}
          autoComplete="off"
        />
        {errors.contact && <p className="mt-1 text-xs text-red-500">{errors.contact}</p>}

        {/* Contact dropdown */}
        {customerId && contactOpen && !showNewContact && (
          <div className="absolute z-20 left-0 top-full mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg overflow-hidden">
            {isLoadingContacts ? (
              <p className="px-3 py-3 text-sm text-gray-400">Loading contacts…</p>
            ) : (
              <>
                {filteredContacts.length > 0 ? (
                  <div className="max-h-48 overflow-y-auto">
                    {filteredContacts.map(c => (
                      <button key={c.id} type="button"
                        onMouseDown={e => {
                          e.preventDefault()
                          setContactId(c.id)
                          setContactInputValue(c.full_name)
                          setContactOpen(false)
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors ${c.id === contactId ? 'bg-gray-50 font-medium' : ''}`}>
                        <span className="text-gray-900 truncate">{c.full_name}</span>
                        <span className="shrink-0 flex items-center gap-1.5">
                          {c.title && <span className="text-xs text-gray-500">{c.title}</span>}
                          {c.is_primary && <span className="rounded-full bg-green-50 px-1.5 py-0.5 text-xs font-semibold text-qm-lime">Primary</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : contactOptions.length === 0 ? (
                  <p className="px-3 py-2.5 text-sm italic text-gray-400">No contacts on file.</p>
                ) : (
                  <p className="px-3 py-2.5 text-sm italic text-gray-400">No matches – text will be saved as entered.</p>
                )}
                {/* Add Contact — pinned at bottom, matches PhoneLookup style */}
                <div className="border-t border-gray-100">
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); setShowNewContact(true); setContactOpen(false) }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-qm-lime hover:bg-qm-lime-light transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Add New Contact
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Inline new contact form */}
        {showNewContact && customerId && (
          <div className="mt-2 rounded-md border border-qm-lime/40 bg-green-50 p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-700">New Contact</p>
            <input type="text" placeholder="Full name *" value={newContactName}
              onChange={e => setNewContactName(e.target.value)} className={inpSm} autoFocus />
            <input type="text" placeholder="Email" value={newContactEmail}
              onChange={e => setNewContactEmail(e.target.value)} className={inpSm} />
            <input type="text" placeholder="Phone" value={newContactPhone}
              onChange={e => setNewContactPhone(e.target.value)} className={inpSm} />
            {newContactError && <p className="text-xs text-red-500">{newContactError}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={handleCreateContact} disabled={newContactSaving}
                className="rounded-md bg-qm-fuchsia px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50">
                {newContactSaving ? 'Saving…' : 'Create & Select'}
              </button>
              <button type="button" onClick={() => { setShowNewContact(false); setNewContactError('') }}
                className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Title ── */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Title <span className="text-red-500">*</span>
        </label>
        <input type="text" maxLength={200} value={title}
          onChange={e => { setTitle(e.target.value); if (errors.title) setErrors(er => ({ ...er, title: '' })) }}
          placeholder="Vehicle wrap – Fleet of 10"
          className={`${inp}${errors.title ? ' ' + errBorder : ''}`} />
        {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title}</p>}
      </div>

      {/* ── Due Date + Sales Rep ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Due Date</label>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inp} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Sales Rep <span className="text-red-500">*</span>
          </label>
          <select value={salesRepId}
            onChange={e => { setSalesRepId(e.target.value); if (errors.salesRepId) setErrors(er => ({ ...er, salesRepId: '' })) }}
            className={`${inp}${errors.salesRepId ? ' ' + errBorder : ''}`}>
            <option value="">– Select sales rep –</option>
            {teamMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          {errors.salesRepId && <p className="mt-1 text-xs text-red-500">{errors.salesRepId}</p>}
        </div>
      </div>

      {/* ── PO Number + Install Address ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">PO Number</label>
          <input type="text" value={poNumber} onChange={e => setPoNumber(e.target.value)}
            placeholder="Customer PO #" className={inp} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Install Address</label>
          <input type="text" value={installAddress} onChange={e => setInstallAddress(e.target.value)}
            placeholder="Job installation location" className={inp} />
        </div>
      </div>

      {/* ── Special Order Notes + Voice ── */}
      <div>
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700">
            Special Order Notes
            <span className="ml-2 text-xs font-normal text-gray-400">Internal – not shown on PDF</span>
          </label>
          <button type="button" onClick={toggleListening}
            title={isListening ? 'Stop recording' : 'Voice to text'}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              isListening ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'text-gray-500 hover:bg-gray-100'
            }`}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
            </svg>
            {isListening ? 'Stop' : 'Dictate'}
          </button>
        </div>
        <textarea rows={3} value={specialOrderNotes} onChange={e => setSpecialOrderNotes(e.target.value)}
          placeholder="Special instructions for production staff..."
          className={`${inp} resize-y${isListening ? ' border-red-300 ring-1 ring-red-300' : ''}`} />
        {isListening && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-red-600">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            Recording… speak now
          </p>
        )}
      </div>

      {/* ── Actions ── */}
      <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
        <button type="button" onClick={() => router.push(`/dashboard/${orgSlug}/quotes`)} disabled={isPending}
          className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">
          Cancel
        </button>
        <button type="submit" disabled={isPending}
          className="rounded-md bg-qm-fuchsia px-5 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
          {isPending ? 'Creating…' : 'Create Quote'}
        </button>
      </div>
    </form>
  )
}
