'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createShipment, updateShipment, getCustomerShippingInfo, type CustomerShippingInfo } from './actions'
import { searchSalesOrders, type SoSearchRow } from '../sales-orders/actions'
import { searchCustomers } from '../customers/actions'
import { formatSoNumber } from '../sales-orders/format'
import { selectShippingRate, type RateOption } from '@/lib/shipping-rate-selection'
import { SHIP_STATUS_OPTIONS } from './format'
import type { EasypostRate } from '@/lib/easypost'
import PhoneInput from '@/components/ui/PhoneInput'

type ShippingMethod = { id: string; name: string; carrier: string | null; is_active: boolean }
type ShippingProfile = { id: string; name: string; length_in: number | null; width_in: number | null; height_in: number | null; max_weight_lbs: number | null; is_active: boolean }
type CustomerResult = { id: string; name: string; company: string | null }
type TeamMember = { id: string; full_name: string | null }

const LOCAL_CARRIERS = ['local', 'pickup']

type LinkMode = 'none' | 'so' | 'customer'

const inp = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
const lbl = 'block text-xs font-medium text-gray-500'
const secHdr = 'text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 mt-5 first:mt-0'

function carrierCardStyle(carrier: string): string {
  const c = carrier.toUpperCase()
  if (c.includes('UPS'))   return 'border-amber-200  bg-amber-50/60'
  if (c.includes('FEDEX')) return 'border-purple-200 bg-purple-50/60'
  if (c.includes('USPS'))  return 'border-blue-200   bg-blue-50/60'
  if (c.includes('DHL'))   return 'border-yellow-200 bg-yellow-50/60'
  return 'border-gray-200 bg-white'
}
function carrierBadgeStyle(carrier: string): string {
  const c = carrier.toUpperCase()
  if (c.includes('UPS'))   return 'bg-amber-100  text-amber-800'
  if (c.includes('FEDEX')) return 'bg-purple-100 text-purple-800'
  if (c.includes('USPS'))  return 'bg-blue-100   text-blue-800'
  if (c.includes('DHL'))   return 'bg-yellow-100 text-yellow-800'
  return 'bg-gray-100 text-gray-700'
}

export type ShipmentFormInitial = {
  linkMode: LinkMode
  selectedSo: SoSearchRow | null
  resolvedCustomer: CustomerShippingInfo | null
  shipToName: string
  shipToStreet: string
  shipToCity: string
  shipToState: string
  shipToZip: string
  shipToPhone: string
  shippingMethodId: string
  profileId: string
  weightLbs: string
  dimL: string
  dimW: string
  dimH: string
  deliveryNotes: string
  taskAssignedTo: string
}

type Props = {
  orgId: string
  orgSlug: string
  shippingMethods: ShippingMethod[]
  shippingProfiles: ShippingProfile[]
  teamMembers: TeamMember[]
  initialError?: string
  // When set, the form edits an existing shipment instead of creating one.
  shipmentId?: string
  initial?: ShipmentFormInitial
}

export default function ShipmentFormClient({ orgId, orgSlug, shippingMethods, shippingProfiles, teamMembers, initialError, shipmentId, initial }: Props) {
  const router = useRouter()
  const isEdit = !!shipmentId
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  function flash(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4500)
  }

  useEffect(() => {
    if (initialError) flash(initialError, 'error')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Link (SO / Customer / none) ──────────────────────────────────────────
  const [linkMode, setLinkMode] = useState<LinkMode>(initial?.linkMode ?? 'none')

  const [soSearch, setSoSearch] = useState('')
  const [soResults, setSoResults] = useState<SoSearchRow[]>([])
  const [soSearching, setSoSearching] = useState(false)
  const [selectedSo, setSelectedSo] = useState<SoSearchRow | null>(initial?.selectedSo ?? null)
  const soDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [custSearch, setCustSearch] = useState('')
  const [custResults, setCustResults] = useState<CustomerResult[]>([])
  const [custSearching, setCustSearching] = useState(false)
  const custDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The resolved customer info (address + preferred method), whether reached
  // via a direct customer pick or via a linked Sales Order's customer_id.
  const [resolvedCustomer, setResolvedCustomer] = useState<CustomerShippingInfo | null>(initial?.resolvedCustomer ?? null)
  const [loadingCustomerInfo, setLoadingCustomerInfo] = useState(false)

  function handleSoSearch(val: string) {
    setSoSearch(val)
    if (soDebounce.current) clearTimeout(soDebounce.current)
    if (val.trim().length < 2) { setSoResults([]); setSoSearching(false); return }
    setSoSearching(true)
    soDebounce.current = setTimeout(async () => {
      const rows = await searchSalesOrders(orgId, val.trim())
      setSoResults(rows)
      setSoSearching(false)
    }, 300)
  }

  function handleCustSearch(val: string) {
    setCustSearch(val)
    if (custDebounce.current) clearTimeout(custDebounce.current)
    if (val.trim().length < 2) { setCustResults([]); setCustSearching(false); return }
    setCustSearching(true)
    custDebounce.current = setTimeout(async () => {
      const rows = await searchCustomers(orgId, val.trim(), {})
      setCustResults(rows.map((r) => ({ id: r.id, name: `${r.first_name} ${r.last_name}`, company: r.company_name })))
      setCustSearching(false)
    }, 300)
  }

  async function selectSo(so: SoSearchRow) {
    setSelectedSo(so)
    setSoSearch(''); setSoResults([])
    setResolvedCustomer(null)
    if (so.customer_id) {
      setLoadingCustomerInfo(true)
      const info = await getCustomerShippingInfo(orgId, so.customer_id)
      setResolvedCustomer(info)
      setLoadingCustomerInfo(false)
      if (info) applyCustomerAddress(info)
    }
  }

  async function selectCustomer(id: string) {
    setCustSearch(''); setCustResults([])
    setLoadingCustomerInfo(true)
    const info = await getCustomerShippingInfo(orgId, id)
    setResolvedCustomer(info)
    setLoadingCustomerInfo(false)
    if (info) applyCustomerAddress(info)
  }

  function changeLinkMode(mode: LinkMode) {
    setLinkMode(mode)
    setSelectedSo(null); setResolvedCustomer(null)
    setSoSearch(''); setSoResults([]); setCustSearch(''); setCustResults([])
    setFetchedRates([]); setSelectedRateId(null); setEasypostShipmentId(null); setRatesError(null)
  }

  // ── Destination ───────────────────────────────────────────────────────────
  const [shipToName, setShipToName]     = useState(initial?.shipToName ?? '')
  const [shipToStreet, setShipToStreet] = useState(initial?.shipToStreet ?? '')
  const [shipToCity, setShipToCity]     = useState(initial?.shipToCity ?? '')
  const [shipToState, setShipToState]   = useState(initial?.shipToState ?? '')
  const [shipToZip, setShipToZip]       = useState(initial?.shipToZip ?? '')
  const [shipToPhone, setShipToPhone]   = useState(initial?.shipToPhone ?? '')

  function applyCustomerAddress(info: CustomerShippingInfo) {
    setShipToName(info.company_name || info.name)
    setShipToStreet(info.street ?? '')
    setShipToCity(info.city ?? '')
    setShipToState(info.state ?? '')
    setShipToZip(info.zip ?? '')
    setShipToPhone(info.phone ?? '')
  }

  // ── Package ───────────────────────────────────────────────────────────────
  const [shippingMethodId, setShippingMethodId] = useState(initial?.shippingMethodId ?? '')
  const [profileId, setProfileId]   = useState(initial?.profileId ?? '')
  const [weightLbs, setWeightLbs]   = useState(initial?.weightLbs ?? '')
  const [dimL, setDimL]             = useState(initial?.dimL ?? '')
  const [dimW, setDimW]             = useState(initial?.dimW ?? '')
  const [dimH, setDimH]             = useState(initial?.dimH ?? '')

  function handleProfileSelect(id: string) {
    setProfileId(id)
    const p = shippingProfiles.find((p) => p.id === id)
    if (p) {
      setDimL(p.length_in != null ? String(p.length_in) : '')
      setDimW(p.width_in != null ? String(p.width_in) : '')
      setDimH(p.height_in != null ? String(p.height_in) : '')
    }
  }

  const selectedMethod = shippingMethods.find((m) => m.id === shippingMethodId)
  const isLocalOrPickup = !!selectedMethod && LOCAL_CARRIERS.includes(selectedMethod.carrier ?? '')

  // ── Delivery / Pickup (local methods skip rate-shopping) ─────────────────
  const [deliveryNotes, setDeliveryNotes]     = useState(initial?.deliveryNotes ?? '')
  const [taskAssignedTo, setTaskAssignedTo]   = useState(initial?.taskAssignedTo ?? '')

  // ── Live rates ────────────────────────────────────────────────────────────
  const [ratesLoading, setRatesLoading]             = useState(false)
  const [fetchedRates, setFetchedRates]             = useState<EasypostRate[]>([])
  const [ratesError, setRatesError]                 = useState<string | null>(null)
  const [selectedRateId, setSelectedRateId]         = useState<string | null>(null)
  const [easypostShipmentId, setEasypostShipmentId] = useState<string | null>(null)
  const [buyingLabel, setBuyingLabel]               = useState(false)

  const [shipStatus, setShipStatus]         = useState('pending')
  const [shipTracking, setShipTracking]     = useState('')
  const [shipActualCost, setShipActualCost] = useState('')
  const [shipLabelUrl, setShipLabelUrl]     = useState('')

  const rateRecommendation = useMemo(
    () => selectShippingRate(resolvedCustomer?.shipping_method ?? null, fetchedRates as RateOption[]),
    [fetchedRates, resolvedCustomer?.shipping_method],
  )

  async function handleGetRates() {
    if (!shipToZip) { setRatesError('Enter a destination ZIP code.'); return }
    const wLbs = parseFloat(weightLbs)
    if (isNaN(wLbs) || wLbs <= 0) { setRatesError('Enter weight (lbs) in the Package section.'); return }
    const l = parseFloat(dimL), w = parseFloat(dimW), h = parseFloat(dimH)
    if (isNaN(l) || isNaN(w) || isNaN(h)) { setRatesError('Enter box dimensions (L×W×H) in the Package section.'); return }

    setRatesLoading(true); setRatesError(null); setFetchedRates([]); setSelectedRateId(null); setEasypostShipmentId(null)

    try {
      const res = await fetch('/api/shipping/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_address: {
            name: shipToName || 'Customer',
            street1: shipToStreet || '1 Main St',
            city: shipToCity || shipToZip,
            state: shipToState || 'TX',
            zip: shipToZip,
            country: 'US',
            ...(shipToPhone ? { phone: shipToPhone } : {}),
          },
          parcel: { length: l, width: w, height: h, weight: wLbs * 16 },
        }),
      })
      const data = await res.json() as { shipmentId?: string; rates?: EasypostRate[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to fetch rates')
      setEasypostShipmentId(data.shipmentId ?? null)
      const rates = data.rates ?? []
      setFetchedRates(rates)
      const rec = selectShippingRate(resolvedCustomer?.shipping_method ?? null, rates as RateOption[])
      setSelectedRateId(rec.selectedRate?.id ?? null)
    } catch (err: unknown) {
      setRatesError(err instanceof Error ? err.message : 'Failed to fetch rates')
    } finally { setRatesLoading(false) }
  }

  async function handleBuyLabel() {
    if (!easypostShipmentId || !selectedRateId) return
    setBuyingLabel(true)
    try {
      const res = await fetch('/api/shipping/buy-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ easypostShipmentId, rateId: selectedRateId }),
      })
      const data = await res.json() as { trackingCode?: string; labelUrl?: string; actualCost?: number; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to purchase label')
      setShipTracking(data.trackingCode ?? '')
      setShipLabelUrl(data.labelUrl ?? '')
      setShipActualCost(data.actualCost != null ? String(data.actualCost) : '')
      setShipStatus('shipped')
      flash('Label purchased! Click Save to record this shipment.', 'success')
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : 'Failed to purchase label', 'error')
    } finally { setBuyingLabel(false) }
  }

  const selectedRate = fetchedRates.find((r) => r.id === selectedRateId) ?? null
  const quotedRate = selectedRate ? selectedRate.rate : ''

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg ${
          toast.type === 'success' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'
        }`}>{toast.message}</div>
      )}

      <form action={isEdit ? updateShipment : createShipment} className="space-y-6">
        {isEdit && <input type="hidden" name="id" value={shipmentId} />}
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="sales_order_id" value={selectedSo?.id ?? ''} />
        <input type="hidden" name="customer_id" value={resolvedCustomer?.id ?? ''} />
        <input type="hidden" name="ship_to_name" value={shipToName} />
        <input type="hidden" name="ship_to_street" value={shipToStreet} />
        <input type="hidden" name="ship_to_city" value={shipToCity} />
        <input type="hidden" name="ship_to_state" value={shipToState} />
        <input type="hidden" name="ship_to_zip" value={shipToZip} />
        <input type="hidden" name="ship_to_phone" value={shipToPhone} />
        <input type="hidden" name="status" value={shipStatus} />
        <input type="hidden" name="tracking_number" value={shipTracking} />
        <input type="hidden" name="carrier" value={selectedRate?.carrier ?? ''} />
        <input type="hidden" name="quoted_rate" value={quotedRate} />
        <input type="hidden" name="actual_cost" value={shipActualCost} />
        <input type="hidden" name="label_url" value={shipLabelUrl} />
        <input type="hidden" name="easypost_shipment_id" value={easypostShipmentId ?? ''} />
        <input type="hidden" name="delivery_notes" value={deliveryNotes} />
        <input type="hidden" name="task_assigned_to" value={taskAssignedTo} />

        {/* ── LINK ──────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className={secHdr}>Link (optional)</p>
          <div className="flex flex-wrap gap-2">
            {([
              { value: 'none', label: 'Standalone / Office' },
              { value: 'so', label: 'Sales Order' },
              { value: 'customer', label: 'Customer' },
            ] as { value: LinkMode; label: string }[]).map((opt) => (
              <button key={opt.value} type="button" onClick={() => changeLinkMode(opt.value)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                  linkMode === opt.value ? 'border-qm-lime bg-qm-lime-light text-qm-lime-dark' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>

          {linkMode === 'so' && (
            <div className="mt-3">
              {selectedSo ? (
                <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{formatSoNumber(selectedSo.so_number, selectedSo.created_at)} — {selectedSo.title || 'Untitled'}</p>
                    {selectedSo.customers && (
                      <p className="text-xs text-gray-500">
                        {selectedSo.customers.company_name || `${selectedSo.customers.first_name} ${selectedSo.customers.last_name}`}
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={() => { setSelectedSo(null); setResolvedCustomer(null) }} className="text-xs text-gray-500 hover:text-red-600">Change</button>
                </div>
              ) : (
                <div className="relative">
                  <input type="text" value={soSearch} onChange={(e) => handleSoSearch(e.target.value)}
                    placeholder="Search sales orders by number, title, or customer..." className={inp} />
                  {soSearching && <p className="mt-1 text-xs text-gray-400">Searching…</p>}
                  {soResults.length > 0 && (
                    <div className="mt-1 max-h-56 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                      {soResults.map((so) => (
                        <button key={so.id} type="button" onClick={() => selectSo(so)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-qm-lime-light transition-colors">
                          <span className="font-medium text-gray-900">{formatSoNumber(so.so_number, so.created_at)}</span>
                          {so.title && <span className="text-gray-500"> — {so.title}</span>}
                          {so.customers && (
                            <span className="block text-xs text-gray-400">
                              {so.customers.company_name || `${so.customers.first_name} ${so.customers.last_name}`}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {linkMode === 'customer' && (
            <div className="mt-3">
              {resolvedCustomer ? (
                <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-sm font-semibold text-gray-900">{resolvedCustomer.company_name || resolvedCustomer.name}</p>
                  <button type="button" onClick={() => setResolvedCustomer(null)} className="text-xs text-gray-500 hover:text-red-600">Change</button>
                </div>
              ) : (
                <div className="relative">
                  <input type="text" value={custSearch} onChange={(e) => handleCustSearch(e.target.value)}
                    placeholder="Search customers..." className={inp} />
                  {custSearching && <p className="mt-1 text-xs text-gray-400">Searching…</p>}
                  {custResults.length > 0 && (
                    <div className="mt-1 max-h-56 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                      {custResults.map((c) => (
                        <button key={c.id} type="button" onClick={() => selectCustomer(c.id)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-qm-lime-light transition-colors">
                          {c.company && <span className="block font-medium text-gray-900">{c.company}</span>}
                          <span className={c.company ? 'text-xs text-gray-500' : 'font-medium text-gray-900'}>{c.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {loadingCustomerInfo && <p className="mt-2 text-xs text-gray-400">Loading customer info…</p>}
          {resolvedCustomer && (
            <p className="mt-2 text-xs text-gray-500">
              Preferred shipping method: {resolvedCustomer.shipping_method
                ? <span className="font-medium text-gray-700">{resolvedCustomer.shipping_method}</span>
                : <span className="italic text-gray-400">none set</span>}
            </p>
          )}
        </div>

        {/* ── DESTINATION ───────────────────────────────────────────────── */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className={secHdr}>Destination</p>
          {resolvedCustomer && (
            <button type="button" onClick={() => applyCustomerAddress(resolvedCustomer)}
              className="mb-3 text-xs font-medium text-qm-lime hover:underline">
              Use {resolvedCustomer.company_name || resolvedCustomer.name}&apos;s address
            </button>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="sm:col-span-2">
              <label className={lbl}>Recipient Name</label>
              <input type="text" value={shipToName} onChange={(e) => setShipToName(e.target.value)} className={inp} />
            </div>
            <div className="sm:col-span-3">
              <label className={lbl}>Street</label>
              <input type="text" value={shipToStreet} onChange={(e) => setShipToStreet(e.target.value)} className={inp} />
            </div>
            <div className="sm:col-span-2">
              <label className={lbl}>City</label>
              <input type="text" value={shipToCity} onChange={(e) => setShipToCity(e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>State</label>
              <input type="text" maxLength={2} value={shipToState} onChange={(e) => setShipToState(e.target.value.toUpperCase())} className={inp} />
            </div>
            <div>
              <label className={lbl}>ZIP *</label>
              <input type="text" value={shipToZip} onChange={(e) => setShipToZip(e.target.value)} className={inp} />
            </div>
            <div className="sm:col-span-2">
              <label className={lbl}>Phone <span className="text-gray-400 font-normal">(required by some carriers, e.g. FedEx)</span></label>
              <PhoneInput value={shipToPhone} onChange={setShipToPhone} className="mt-1" />
            </div>
          </div>
        </div>

        {/* ── PACKAGE ───────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className={secHdr}>Package</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Shipping Method <span className="text-gray-400 font-normal">(our catalog, optional)</span></label>
              <select name="shipping_method_id" value={shippingMethodId} onChange={(e) => setShippingMethodId(e.target.value)} className={inp}>
                <option value="">— Select method —</option>
                {shippingMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Weight (lbs) *</label>
              <input type="number" step="0.01" min="0" value={weightLbs} onChange={(e) => setWeightLbs(e.target.value)} className={inp} />
            </div>
            <div className="sm:col-span-2">
              <label className={lbl}>Box Profile <span className="text-gray-400 font-normal">(auto-fills L×W×H)</span></label>
              <select value={profileId} onChange={(e) => handleProfileSelect(e.target.value)} className={inp}>
                <option value="">— Select profile —</option>
                {shippingProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.length_in != null ? ` (${p.length_in}×${p.width_in}×${p.height_in}")` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2 grid grid-cols-3 gap-3">
              <div>
                <label className={lbl}>Length (in) *</label>
                <input type="number" step="0.01" min="0" value={dimL} onChange={(e) => setDimL(e.target.value)} className={inp} />
              </div>
              <div>
                <label className={lbl}>Width (in) *</label>
                <input type="number" step="0.01" min="0" value={dimW} onChange={(e) => setDimW(e.target.value)} className={inp} />
              </div>
              <div>
                <label className={lbl}>Height (in) *</label>
                <input type="number" step="0.01" min="0" value={dimH} onChange={(e) => setDimH(e.target.value)} className={inp} />
              </div>
            </div>
          </div>
          <input type="hidden" name="shipping_profile_id" value={profileId} />
          <input type="hidden" name="weight_lbs" value={weightLbs} />
          <input type="hidden" name="length_in" value={dimL} />
          <input type="hidden" name="width_in" value={dimW} />
          <input type="hidden" name="height_in" value={dimH} />
        </div>

        {/* ── DELIVERY / PICKUP (local methods skip rate-shopping) ────────── */}
        {isLocalOrPickup ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className={secHdr}>Delivery / Pickup</p>
            <p className="mb-3 text-xs text-gray-500">
              &quot;{selectedMethod?.name}&quot; doesn&apos;t use a carrier, so there&apos;s nothing to rate-shop. Describe what&apos;s needed and assign it to someone.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className={lbl}>Instructions</label>
                <textarea value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} rows={3}
                  placeholder="What needs to be delivered, any special instructions..." className={inp} />
              </div>
              <div>
                <label className={lbl}>Assign To</label>
                <select value={taskAssignedTo} onChange={(e) => setTaskAssignedTo(e.target.value)} className={inp}>
                  <option value="">Unassigned</option>
                  {teamMembers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Status</label>
                <select value={shipStatus} onChange={(e) => setShipStatus(e.target.value)} className={inp}>
                  {SHIP_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
          </div>
        ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className={secHdr}>Get Rates</p>
          <button type="button" onClick={handleGetRates} disabled={ratesLoading}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {ratesLoading ? 'Fetching rates…' : 'Get Rates'}
          </button>

          {ratesError && <p className="mt-2 text-sm text-red-600">{ratesError}</p>}

          {fetchedRates.length > 0 && (
            <div className="mt-3 space-y-2">
              {rateRecommendation.isFlagged && rateRecommendation.flagMessage && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  ⚠ {rateRecommendation.flagMessage}
                </div>
              )}
              {fetchedRates.map((r) => {
                const isRecommended = rateRecommendation.selectedRate?.id === r.id
                return (
                  <label key={r.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                      selectedRateId === r.id
                        ? `${carrierCardStyle(r.carrier)} ring-2 ring-indigo-400`
                        : `${carrierCardStyle(r.carrier)} hover:ring-1 hover:ring-indigo-200`
                    }`}>
                    <input type="radio" name="ep_rate" value={r.id}
                      checked={selectedRateId === r.id}
                      onChange={() => setSelectedRateId(r.id)}
                      className="accent-indigo-600" />
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-bold ${carrierBadgeStyle(r.carrier)}`}>{r.carrier}</span>
                      <span className="text-sm font-medium text-gray-800">{r.service}</span>
                      {r.delivery_days != null && (
                        <span className="text-xs text-gray-400">{r.delivery_days} day{r.delivery_days !== 1 ? 's' : ''}</span>
                      )}
                      {isRecommended && (
                        <span className="inline-flex items-center rounded-full bg-qm-lime-light px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-qm-lime-dark">
                          {rateRecommendation.matchedPreference ? "Customer's preference" : 'Best available'}
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-bold tabular-nums text-gray-900">${parseFloat(r.rate).toFixed(2)}</span>
                  </label>
                )
              })}

              {selectedRateId && !shipLabelUrl && (
                <button type="button" onClick={handleBuyLabel} disabled={buyingLabel}
                  className="mt-1 rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
                  {buyingLabel ? 'Purchasing…' : 'Buy Label'}
                </button>
              )}
            </div>
          )}

          {shipLabelUrl && (
            <div className="mt-3 flex items-center gap-3">
              <span className="text-sm text-green-700 font-medium">✓ Label purchased</span>
              {shipTracking && <span className="text-sm font-mono text-gray-700">{shipTracking}</span>}
              <a href={shipLabelUrl} target="_blank" rel="noopener noreferrer"
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Print Label ↗
              </a>
            </div>
          )}
        </div>
        )}

        <div className="flex gap-2">
          <button type="submit" className="rounded-md bg-qm-lime px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110">
            {isEdit ? 'Update Shipment' : 'Save Shipment'}
          </button>
          <button type="button" onClick={() => router.back()} className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
