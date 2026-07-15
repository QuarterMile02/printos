'use client'

import { useState, useTransition, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createQuote } from '../actions'
import { searchCustomers } from '@/app/(dashboard)/dashboard/[slug]/customers/actions'
import {
  fetchContactsForCustomer,
  type ContactOption,
} from '@/app/(dashboard)/dashboard/[slug]/assign-actions'
import { productUsesDimensions, formatCents, TAX_RATE } from '../format'

type CustomerResult = {
  id: string
  name: string
  company: string | null
  status: string | null
}

type ProductOption = { id: string; name: string; formula: string | null }
type TeamMember    = { id: string; name: string }

type DraftLineItem = {
  _key: number
  product_id: string | null
  description: string
  width: number | null
  height: number | null
  quantity: number
  unit_price: number   // cents
  taxable: boolean
}

type Props = {
  orgId: string
  orgSlug: string
  teamMembers: TeamMember[]
  currentUserId: string | null
  products: ProductOption[]
}

function dollarsToCents(s: string): number {
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ''))
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100)
}

const inp = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
const errBorder = 'border-red-400 focus:border-red-400 focus:ring-red-400'

export default function NewQuoteForm({ orgId, orgSlug, teamMembers, currentUserId, products }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string>>({})

  // ── Customer search ────────────────────────────────────────────────────────
  const [customerId, setCustomerId]       = useState('')
  const [customerDisplay, setCustomerDisplay] = useState('')
  const [custSearch, setCustSearch]       = useState('')
  const [custOpen, setCustOpen]           = useState(false)
  const [custResults, setCustResults]     = useState<CustomerResult[]>([])
  const [isSearching, setIsSearching]     = useState(false)
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeqRef = useRef(0)
  const custDropRef  = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (custDropRef.current && !custDropRef.current.contains(e.target as Node)) setCustOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  function handleCustSearchChange(val: string) {
    setCustSearch(val)
    setCustomerId('')
    setCustomerDisplay('')
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
    setCustomerDisplay(company ? `${company} — ${name}` : name)
    setCustSearch('')
    setCustOpen(false)
    setCustResults([])
    setContactId(''); setContactName(''); setContactOptions([])
    setErrors(e => ({ ...e, customerId: '' }))
  }

  function clearCustomer() {
    setCustomerId(''); setCustomerDisplay(''); setCustSearch('')
    setContactId(''); setContactName(''); setContactOptions([])
  }

  // ── Contact picker ─────────────────────────────────────────────────────────
  const [contactId, setContactId]             = useState('')
  const [contactName, setContactName]         = useState('')
  const [contactOptions, setContactOptions]   = useState<ContactOption[]>([])
  const [contactOpen, setContactOpen]         = useState(false)
  const [isLoadingContacts, setIsLoadingContacts] = useState(false)
  const contactDropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (contactDropRef.current && !contactDropRef.current.contains(e.target as Node)) setContactOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  async function openContactDrop() {
    if (!customerId) return
    setContactOpen(true)
    if (contactOptions.length === 0) {
      setIsLoadingContacts(true)
      const opts = await fetchContactsForCustomer(customerId, orgId)
      setContactOptions(opts)
      setIsLoadingContacts(false)
    }
  }

  function selectContact(id: string | null, name: string | null) {
    setContactId(id ?? ''); setContactName(name ?? ''); setContactOpen(false)
  }

  // ── Form fields ────────────────────────────────────────────────────────────
  const [title, setTitle]                 = useState('')
  const [salesRepId, setSalesRepId]       = useState(currentUserId ?? '')
  const [dueDate, setDueDate]             = useState('')
  const [poNumber, setPoNumber]           = useState('')
  const [installAddress, setInstallAddress] = useState('')
  const [specialOrderNotes, setSpecialOrderNotes] = useState('')

  // ── Voice-to-text ─────────────────────────────────────────────────────────
  const [isListening, setIsListening] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  function toggleListening() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (typeof window !== 'undefined') && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    if (!SR) { alert('Speech recognition is not supported in this browser.'); return }
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return }
    const r = new SR()
    r.continuous = true
    r.interimResults = false
    r.lang = 'en-US'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (e: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = Array.from(e.results as any[]).slice(e.resultIndex).map((r: any) => r[0].transcript as string).join(' ')
      setSpecialOrderNotes(prev => prev ? `${prev} ${t}` : t)
    }
    r.onend = () => setIsListening(false)
    r.onerror = () => setIsListening(false)
    r.start()
    recognitionRef.current = r
    setIsListening(true)
  }

  // ── Line items ─────────────────────────────────────────────────────────────
  const [lineItems, setLineItems]   = useState<DraftLineItem[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [nextKey, setNextKey]       = useState(0)

  // New line item draft
  const [newProductId, setNewProductId]           = useState('')
  const [productQuery, setProductQuery]           = useState('')
  const [productDropdownOpen, setProductDropdownOpen] = useState(false)
  const [newDescription, setNewDescription]       = useState('')
  const [newWidth, setNewWidth]                   = useState('')
  const [newHeight, setNewHeight]                 = useState('')
  const [newQty, setNewQty]                       = useState('1')
  const [newUnitPrice, setNewUnitPrice]           = useState('')
  const [newTaxable, setNewTaxable]               = useState(true)
  const [isPricingLoading, setIsPricingLoading]   = useState(false)

  const productMap = useMemo(() => {
    const m = new Map<string, ProductOption>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase()
    return (q ? products.filter(p => p.name.toLowerCase().includes(q)) : products).slice(0, 50)
  }, [products, productQuery])

  const newSelectedProduct  = newProductId ? productMap.get(newProductId) : null
  const newProductUsesDims  = newSelectedProduct ? productUsesDimensions(newSelectedProduct.formula) : false
  const newLineTotalCents   = Math.round(dollarsToCents(newUnitPrice) * (parseInt(newQty, 10) || 1))

  // Pricing auto-calc
  useEffect(() => {
    if (!newProductId) return
    const w = Number(newWidth) || 0
    const h = Number(newHeight) || 0
    const q = Number(newQty) || 1
    const product = productMap.get(newProductId)
    if (productUsesDimensions(product?.formula) && w <= 0 && h <= 0) return
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      setIsPricingLoading(true)
      fetch('/api/pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: newProductId, width_inches: w, height_inches: h, quantity: q, selected_modifiers: {} }),
      })
        .then(r => r.json())
        .then((data: { unit_price_cents?: number }) => { if (!cancelled && data.unit_price_cents) setNewUnitPrice((data.unit_price_cents / 100).toFixed(2)) })
        .catch(() => {})
        .finally(() => { if (!cancelled) setIsPricingLoading(false) })
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [newProductId, newWidth, newHeight, newQty, productMap])

  function resetAddForm() {
    setNewProductId(''); setProductQuery(''); setNewDescription('')
    setNewWidth(''); setNewHeight(''); setNewQty('1'); setNewUnitPrice(''); setNewTaxable(true)
    setProductDropdownOpen(false)
  }

  function handleAddItem() {
    const qty  = Math.max(1, parseInt(newQty, 10) || 1)
    const desc = newDescription.trim() || (newProductId ? productMap.get(newProductId)?.name ?? 'Custom Item' : 'Custom Item')
    setLineItems(cur => [...cur, {
      _key: nextKey,
      product_id: newProductId || null,
      description: desc,
      width: newWidth ? Number(newWidth) : null,
      height: newHeight ? Number(newHeight) : null,
      quantity: qty,
      unit_price: dollarsToCents(newUnitPrice),
      taxable: newTaxable,
    }])
    setNextKey(k => k + 1)
    setShowAddForm(false)
    resetAddForm()
  }

  // Totals preview
  const subtotalCents = useMemo(() => lineItems.reduce((s, li) => s + Math.round(li.quantity * li.unit_price), 0), [lineItems])
  const taxableCents  = useMemo(() => lineItems.filter(li => li.taxable).reduce((s, li) => s + Math.round(li.quantity * li.unit_price), 0), [lineItems])
  const taxCents      = Math.round(taxableCents * TAX_RATE)
  const totalCents    = subtotalCents + taxCents

  // ── Submit ─────────────────────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const newErrors: Record<string, string> = {}
    if (!customerId)     newErrors.customerId  = 'Customer is required.'
    if (!title.trim())   newErrors.title       = 'Title is required.'
    if (!salesRepId)     newErrors.salesRepId  = 'Sales Rep is required.'
    if (Object.keys(newErrors).length) { setErrors(newErrors); return }
    setErrors({})

    startTransition(async () => {
      const result = await createQuote(orgId, orgSlug, {
        title,
        customerId: customerId || null,
        contactId: contactId || null,
        description: null,
        expiresAt: null,
        terms: null,
        notes: null,
        dueDate: dueDate || null,
        salesRepId: salesRepId || null,
        poNumber: poNumber || null,
        installAddress: installAddress || null,
        productionNotes: specialOrderNotes || null,
        lineItems: lineItems.map(li => ({
          product_id: li.product_id,
          description: li.description,
          width: li.width,
          height: li.height,
          quantity: li.quantity,
          unit_price: li.unit_price,
          discount_percent: 0,
          taxable: li.taxable,
        })),
      })
      if (result.error) setErrors({ submit: result.error })
      else if (result.quoteId) router.push(`/dashboard/${orgSlug}/quotes/${result.quoteId}`)
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-6">
      {errors.submit && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">{errors.submit}</div>
      )}

      {/* Customer — server-side fuzzy search */}
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

        {custOpen && !customerId && (
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
                <p className="px-3 py-3 text-xs text-gray-400 text-center">No customers found</p>
              ) : (
                <p className="px-3 py-3 text-xs text-gray-400 text-center">Type at least 2 characters to search</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Contact — appears after customer selected */}
      {customerId && (
        <div ref={contactDropRef} className="relative">
          <label className="block text-sm font-medium text-gray-700">
            Contact <span className="text-xs font-normal text-gray-400">(optional)</span>
          </label>
          <button type="button"
            onClick={() => contactOpen ? setContactOpen(false) : openContactDrop()}
            className="mt-1 flex w-full items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:border-gray-400 focus:outline-none focus:ring-1 focus:ring-qm-lime">
            <span className={contactName ? 'text-gray-900' : 'text-gray-400 italic'}>
              {contactName || 'Select contact…'}
            </span>
            <svg className="h-4 w-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          {contactOpen && (
            <div className="absolute z-20 left-0 top-full mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg overflow-hidden">
              {isLoadingContacts ? (
                <p className="px-3 py-3 text-sm text-gray-400">Loading contacts…</p>
              ) : contactOptions.length === 0 ? (
                <p className="px-3 py-3 text-sm italic text-gray-400">No contacts on file.</p>
              ) : (
                <>
                  <button type="button" onClick={() => selectContact(null, null)}
                    className="w-full px-3 py-2 text-left text-sm italic text-gray-400 hover:bg-gray-50 border-b border-gray-100">
                    — None —
                  </button>
                  <div className="max-h-48 overflow-y-auto">
                    {contactOptions.map(c => (
                      <button key={c.id} type="button" onClick={() => selectContact(c.id, c.full_name)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors ${c.id === contactId ? 'bg-gray-50 font-medium' : ''}`}>
                        <span className="text-gray-900 truncate">{c.full_name}</span>
                        <span className="shrink-0 flex items-center gap-1.5">
                          {c.title && <span className="text-xs text-gray-500">{c.title}</span>}
                          {c.is_primary && <span className="text-xs font-semibold text-qm-lime bg-green-50 rounded-full px-1.5 py-0.5">Primary</span>}
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

      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Title <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          maxLength={200}
          value={title}
          onChange={e => { setTitle(e.target.value); if (errors.title) setErrors(er => ({ ...er, title: '' })) }}
          placeholder="Vehicle wrap — Fleet of 10"
          className={`${inp}${errors.title ? ' ' + errBorder : ''}`}
        />
        {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title}</p>}
      </div>

      {/* Due Date + Sales Rep */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Due Date</label>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inp} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Sales Rep <span className="text-red-500">*</span>
          </label>
          <select
            value={salesRepId}
            onChange={e => { setSalesRepId(e.target.value); if (errors.salesRepId) setErrors(er => ({ ...er, salesRepId: '' })) }}
            className={`${inp}${errors.salesRepId ? ' ' + errBorder : ''}`}
          >
            <option value="">— Select sales rep —</option>
            {teamMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          {errors.salesRepId && <p className="mt-1 text-xs text-red-500">{errors.salesRepId}</p>}
        </div>
      </div>

      {/* PO Number + Install Address */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">PO Number</label>
          <input type="text" value={poNumber} onChange={e => setPoNumber(e.target.value)} placeholder="Customer PO #" className={inp} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Install Address</label>
          <input type="text" value={installAddress} onChange={e => setInstallAddress(e.target.value)} placeholder="Job installation location" className={inp} />
        </div>
      </div>

      {/* Special Order Notes + Voice Mic */}
      <div>
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700">
            Special Order Notes
            <span className="ml-2 text-xs font-normal text-gray-400">Internal — not shown on PDF</span>
          </label>
          <button
            type="button"
            onClick={toggleListening}
            title={isListening ? 'Stop recording' : 'Voice to text'}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              isListening ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
            </svg>
            {isListening ? 'Stop' : 'Dictate'}
          </button>
        </div>
        <textarea
          rows={3}
          value={specialOrderNotes}
          onChange={e => setSpecialOrderNotes(e.target.value)}
          placeholder="Special instructions for production staff..."
          className={`${inp} resize-y${isListening ? ' border-red-300 ring-1 ring-red-300' : ''}`}
        />
        {isListening && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-red-600">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            Recording… speak now
          </p>
        )}
      </div>

      {/* Line Items */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-bold text-gray-900">
            Line Items
            {lineItems.length > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-qm-lime/10 px-2 py-0.5 text-xs font-semibold text-qm-lime">{lineItems.length}</span>
            )}
          </h2>
          {!showAddForm && (
            <button type="button" onClick={() => setShowAddForm(true)}
              className="rounded-md bg-qm-lime px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110">
              + Add Line Item
            </button>
          )}
        </div>

        {/* Add item form */}
        {showAddForm && (
          <div className="border-b border-gray-100 bg-gray-50 px-4 py-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {/* Product search */}
              <div className="col-span-2 sm:col-span-3 lg:col-span-2 relative">
                <label className="block text-xs font-medium text-gray-500">Product</label>
                <input
                  type="text"
                  value={productQuery}
                  onChange={e => { setProductQuery(e.target.value); if (newProductId) setNewProductId(''); setProductDropdownOpen(true) }}
                  onFocus={() => setProductDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setProductDropdownOpen(false), 150)}
                  placeholder="Search product…"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                />
                {productDropdownOpen && (
                  <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                    {filteredProducts.length === 0 ? (
                      <li className="px-3 py-2 text-sm text-gray-500">No products match</li>
                    ) : filteredProducts.map(p => (
                      <li key={p.id}>
                        <button type="button"
                          onMouseDown={e => { e.preventDefault(); setNewProductId(p.id); setProductQuery(p.name); setNewDescription(p.name); setProductDropdownOpen(false) }}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100">
                          {p.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Width / Height for dimensional products */}
              {newProductUsesDims && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-500">Width (in)</label>
                    <input type="number" min={0} step="0.01" value={newWidth} onChange={e => setNewWidth(e.target.value)}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500">Height (in)</label>
                    <input type="number" min={0} step="0.01" value={newHeight} onChange={e => setNewHeight(e.target.value)}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
                  </div>
                </>
              )}

              {/* Qty */}
              <div>
                <label className="block text-xs font-medium text-gray-500">Qty</label>
                <input type="number" min={1} value={newQty} onChange={e => setNewQty(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
              </div>

              {/* Unit Price */}
              <div>
                <label className="block text-xs font-medium text-gray-500">Unit Price ($)</label>
                <div className="relative mt-1">
                  <input type="number" min={0} step="0.01" value={newUnitPrice} onChange={e => setNewUnitPrice(e.target.value)} placeholder="0.00"
                    className="block w-full rounded-md border border-gray-300 px-2 py-1.5 pr-7 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
                  {isPricingLoading && (
                    <svg className="pointer-events-none absolute inset-y-0 right-2 my-auto h-4 w-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  )}
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-500">Description</label>
              <input type="text" value={newDescription} onChange={e => setNewDescription(e.target.value)} placeholder="Item description"
                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
            </div>

            {/* Taxable + total + actions */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" checked={newTaxable} onChange={e => setNewTaxable(e.target.checked)} className="h-4 w-4 accent-qm-lime" />
                <span className="text-gray-700">Taxable</span>
              </label>
              <div className="flex items-center gap-3">
                {newUnitPrice && (
                  <span className="text-xs text-gray-500 tabular-nums">
                    Total: ${formatCents(newLineTotalCents)}
                  </span>
                )}
                <button type="button" onClick={handleAddItem}
                  className="rounded-md bg-qm-lime px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110">
                  Add
                </button>
                <button type="button" onClick={() => { setShowAddForm(false); resetAddForm() }}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {lineItems.length === 0 && !showAddForm ? (
          <div className="py-10 text-center text-sm text-gray-400">
            No line items yet. Click <span className="font-semibold text-gray-600">+ Add Line Item</span> to start.
          </div>
        ) : lineItems.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {['Description', 'Dims', 'Qty', 'Unit Price', 'Total', ''].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lineItems.map(li => (
                  <tr key={li._key} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5 text-sm text-gray-900">{li.description}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-500 whitespace-nowrap">
                      {li.width != null && li.height != null ? `${li.width}"×${li.height}"` : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-gray-900 tabular-nums">{li.quantity}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-900 tabular-nums">${formatCents(li.unit_price)}</td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-gray-900 tabular-nums">${formatCents(li.quantity * li.unit_price)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button type="button" onClick={() => setLineItems(cur => cur.filter(x => x._key !== li._key))}
                        className="rounded p-1 text-gray-400 hover:text-red-500">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-right text-xs font-bold uppercase tracking-wider text-gray-500">Subtotal</td>
                  <td className="px-3 py-2 text-sm tabular-nums text-gray-900">${formatCents(subtotalCents)}</td>
                  <td />
                </tr>
                {taxCents > 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-right text-xs font-bold uppercase tracking-wider text-gray-500">Tax ({(TAX_RATE * 100).toFixed(2)}%)</td>
                    <td className="px-3 py-2 text-sm tabular-nums text-gray-900">${formatCents(taxCents)}</td>
                    <td />
                  </tr>
                )}
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-right text-sm font-bold text-gray-900">Total</td>
                  <td className="px-3 py-2 text-base font-extrabold tabular-nums text-gray-900">${formatCents(totalCents)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
      </div>

      {/* Actions */}
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
