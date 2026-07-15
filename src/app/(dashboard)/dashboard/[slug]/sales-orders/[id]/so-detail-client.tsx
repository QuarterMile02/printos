'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { SalesOrderStatus, JobStatus } from '@/types/database'
import { updateSalesOrderStatus } from '../actions'
import {
  formatSoNumber,
  formatCents,
  SO_STATUS_STYLES,
  SO_STATUS_LABELS,
} from '../format'
import SoCustomerPicker from './so-customer-picker'
import { saveShipment, deleteShipment } from './shipments/actions-sr'
import type { EasypostRate } from '@/lib/easypost'

const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  new: 'New',
  in_progress: 'In Progress',
  proof_review: 'Proof Review',
  ready_for_pickup: 'Ready for Pickup',
  completed: 'Completed',
}

const JOB_STATUS_STYLES: Record<JobStatus, string> = {
  new: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-50 text-blue-700',
  proof_review: 'bg-amber-50 text-amber-700',
  ready_for_pickup: 'bg-teal-50 text-teal-700',
  completed: 'bg-green-50 text-green-700',
}

type SalesOrder = {
  id: string
  so_number: number
  title: string
  status: SalesOrderStatus
  total: number
  notes: string | null
  created_at: string
  updated_at: string
  customer_id: string | null
  customer: {
    first_name: string
    last_name: string
    company_name: string | null
    email: string | null
    phone: string | null
    street: string | null
    city: string | null
    state: string | null
    zip: string | null
  } | null
}

type QuoteRef   = { id: string; quote_number: number; title: string; created_at: string }
type Job        = { id: string; job_number: number; title: string; status: JobStatus; due_date: string | null }
type Shipment   = {
  id: string; carrier: string | null; tracking_number: string | null
  shipped_date: string | null; estimated_delivery: string | null; notes: string | null
  status: string; created_at: string; shipping_method_id: string | null
  shipping_profile_id: string | null; weight_lbs: number | null
  length_in: number | null; width_in: number | null; height_in: number | null
  quoted_rate: number | null; actual_cost: number | null; label_url: string | null
}
type ShippingMethod  = { id: string; name: string; carrier: string | null; is_active: boolean }
type ShippingProfile = { id: string; name: string; length_in: number | null; width_in: number | null; height_in: number | null; max_weight_lbs: number | null; is_active: boolean }
type ShippingAddress = { id: string; label: string | null; street: string | null; city: string | null; state: string | null; zip: string | null; country: string; is_default: boolean }

const SHIP_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700', shipped: 'bg-blue-50 text-blue-700',
  delivered: 'bg-green-50 text-green-700', returned: 'bg-red-50 text-red-700',
}
const SHIP_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', shipped: 'Shipped', delivered: 'Delivered', returned: 'Returned',
}

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

function trackingUrl(carrier: string | null, tracking: string | null): string | null {
  if (!tracking || !carrier) return null
  const c = carrier.toLowerCase()
  if (c === 'ups')   return `https://www.ups.com/track?tracknum=${tracking}`
  if (c === 'fedex') return `https://www.fedex.com/fedextrack/?trknbr=${tracking}`
  if (c === 'usps')  return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking}`
  return null
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtAddrLine(street: string | null, city: string | null, state: string | null, zip: string | null): string {
  const parts = [street, city && state ? `${city}, ${state}` : city || state, zip].filter(Boolean)
  return parts.join(' · ') || ''
}

type Props = {
  orgId: string
  orgSlug: string
  salesOrder: SalesOrder
  parentQuote: QuoteRef | null
  jobs: Job[]
  canSeePricing: boolean
  initialContactId: string | null
  initialContactName: string | null
  canReassignCustomer: boolean
  shipments: Shipment[]
  shipmentSaved?: boolean
  shippingMethods: ShippingMethod[]
  shippingProfiles: ShippingProfile[]
  customerShippingAddresses: ShippingAddress[]
}

const MANUAL_STATUSES: { value: SalesOrderStatus; label: string }[] = [
  { value: 'completed', label: 'Mark Completed' },
  { value: 'hold', label: 'Hold' },
  { value: 'no_charge', label: 'No Charge' },
  { value: 'no_charge_approved', label: 'No Charge Approved' },
  { value: 'void', label: 'Void' },
]

function formatQuoteNumber(num: number, createdAtIso: string): string {
  const year = new Date(createdAtIso).getFullYear()
  return `Q-${year}-${String(num).padStart(4, '0')}`
}

type AddrMode = 'billing' | 'saved' | 'new'

export default function SoDetailClient({
  orgId, orgSlug, salesOrder, parentQuote, jobs, canSeePricing,
  initialContactId, initialContactName, canReassignCustomer,
  shipments, shipmentSaved, shippingMethods, shippingProfiles, customerShippingAddresses,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<SalesOrderStatus>(salesOrder.status)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [creatingInvoice, setCreatingInvoice] = useState(false)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)

  // Shipment panel state
  const [showShipForm, setShowShipForm] = useState(false)
  const [editShipmentId, setEditShipmentId] = useState<string | null>(null)

  // Controlled shipment form fields
  const [shipProfileId, setShipProfileId]   = useState('')
  const [shipDimL, setShipDimL]             = useState('')
  const [shipDimW, setShipDimW]             = useState('')
  const [shipDimH, setShipDimH]             = useState('')
  const [shipWeightLbs, setShipWeightLbs]   = useState('')
  const [shipStatus, setShipStatus]         = useState('pending')
  const [shipTracking, setShipTracking]     = useState('')
  const [shipActualCost, setShipActualCost] = useState('')
  const [shipLabelUrl, setShipLabelUrl]     = useState('')

  // Address mode + ship-to fields
  const [addrMode, setAddrMode]         = useState<AddrMode>('billing')
  const [savedAddrId, setSavedAddrId]   = useState('')
  const [shipToName, setShipToName]     = useState('')
  const [shipToStreet, setShipToStreet] = useState('')
  const [shipToCity, setShipToCity]     = useState('')
  const [shipToState, setShipToState]   = useState('')
  const [shipToZip, setShipToZip]       = useState('')

  // EasyPost live rates
  const [ratesLoading, setRatesLoading]             = useState(false)
  const [fetchedRates, setFetchedRates]             = useState<EasypostRate[]>([])
  const [ratesError, setRatesError]                 = useState<string | null>(null)
  const [selectedRateId, setSelectedRateId]         = useState<string | null>(null)
  const [easypostShipmentId, setEasypostShipmentId] = useState<string | null>(null)
  const [buyingLabel, setBuyingLabel]               = useState(false)

  useEffect(() => {
    if (shipmentSaved) flash('Shipment saved.', 'success')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (editShipmentId) {
      const s = shipments.find(s => s.id === editShipmentId)
      setShipProfileId(s?.shipping_profile_id ?? '')
      setShipDimL(s?.length_in != null ? String(s.length_in) : '')
      setShipDimW(s?.width_in != null ? String(s.width_in) : '')
      setShipDimH(s?.height_in != null ? String(s.height_in) : '')
      setShipWeightLbs(s?.weight_lbs != null ? String(s.weight_lbs) : '')
      setShipStatus(s?.status ?? 'pending')
      setShipTracking(s?.tracking_number ?? '')
      setShipActualCost(s?.actual_cost != null ? String(s.actual_cost) : '')
      setShipLabelUrl(s?.label_url ?? '')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editShipmentId])

  function closeShipForm() {
    setShowShipForm(false); setEditShipmentId(null)
    setShipProfileId(''); setShipDimL(''); setShipDimW(''); setShipDimH('')
    setShipWeightLbs(''); setShipStatus('pending'); setShipTracking('')
    setShipActualCost(''); setShipLabelUrl('')
    setAddrMode('billing'); setSavedAddrId('')
    setShipToName(''); setShipToStreet(''); setShipToCity(''); setShipToState(''); setShipToZip('')
    setFetchedRates([]); setRatesError(null); setSelectedRateId(null); setEasypostShipmentId(null)
  }

  function prefillBilling() {
    const c = salesOrder.customer
    if (!c) return
    setShipToName(c.company_name || `${c.first_name} ${c.last_name}`)
    setShipToStreet(c.street ?? ''); setShipToCity(c.city ?? '')
    setShipToState(c.state ?? ''); setShipToZip(c.zip ?? '')
  }

  function handleAddrMode(mode: AddrMode) {
    setAddrMode(mode)
    setFetchedRates([]); setRatesError(null); setSelectedRateId(null)
    if (mode === 'billing') { prefillBilling() }
    else if (mode === 'new') { setShipToName(''); setShipToStreet(''); setShipToCity(''); setShipToState(''); setShipToZip('') }
  }

  function handleSavedAddr(id: string) {
    setSavedAddrId(id)
    setFetchedRates([]); setRatesError(null); setSelectedRateId(null)
    const a = customerShippingAddresses.find(a => a.id === id)
    if (a) {
      setShipToName(a.label ?? ''); setShipToStreet(a.street ?? '')
      setShipToCity(a.city ?? ''); setShipToState(a.state ?? ''); setShipToZip(a.zip ?? '')
    }
  }

  function handleProfileSelect(profileId: string) {
    setShipProfileId(profileId)
    if (profileId) {
      const p = shippingProfiles.find(p => p.id === profileId)
      if (p) {
        setShipDimL(p.length_in != null ? String(p.length_in) : '')
        setShipDimW(p.width_in != null ? String(p.width_in) : '')
        setShipDimH(p.height_in != null ? String(p.height_in) : '')
      }
    }
  }

  function flash(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  async function handleGetRates() {
    if (!shipToZip) { setRatesError('Enter a destination ZIP code.'); return }
    const wLbs = parseFloat(shipWeightLbs)
    if (isNaN(wLbs) || wLbs <= 0) { setRatesError('Enter weight (lbs) in the Package section.'); return }
    const l = parseFloat(shipDimL), w = parseFloat(shipDimW), h = parseFloat(shipDimH)
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
          },
          parcel: { length: l, width: w, height: h, weight: wLbs * 16 },
        }),
      })
      const data = await res.json() as { shipmentId?: string; rates?: EasypostRate[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to fetch rates')
      setEasypostShipmentId(data.shipmentId ?? null)
      setFetchedRates(data.rates ?? [])
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

  async function handleCreateInvoice() {
    setCreatingInvoice(true); setInvoiceError(null)
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sales_order_id: salesOrder.id, org_slug: orgSlug }),
      })
      const data = await res.json() as { id?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to create invoice')
      router.push(`/dashboard/${orgSlug}/invoices/${data.id}`)
    } catch (err: unknown) {
      setInvoiceError(err instanceof Error ? err.message : 'Failed to create invoice')
    } finally { setCreatingInvoice(false) }
  }

  function handleStatusChange(next: SalesOrderStatus) {
    const prev = status; setStatus(next)
    startTransition(async () => {
      const res = await updateSalesOrderStatus(salesOrder.id, orgId, orgSlug, next)
      if (res.error) { setStatus(prev); flash(res.error, 'error') }
      else flash(`Status updated to ${SO_STATUS_LABELS[next]}`)
    })
  }

  const customerName = salesOrder.customer ? `${salesOrder.customer.first_name} ${salesOrder.customer.last_name}` : null
  const companyName  = salesOrder.customer?.company_name

  const inp    = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
  const lbl    = 'block text-xs font-medium text-gray-500'
  const secHdr = 'text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 mt-4 first:mt-0'

  return (
    <>
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg ${
          toast.type === 'success' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'
        }`}>{toast.message}</div>
      )}

      {/* Header card */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
              {formatSoNumber(salesOrder.so_number, salesOrder.created_at)}
            </p>
            <h1 className="mt-1 text-2xl font-extrabold text-gray-900">
              {salesOrder.title || 'Untitled Sales Order'}
            </h1>
            <SoCustomerPicker
              soId={salesOrder.id} orgId={orgId} orgSlug={orgSlug}
              initialCustomerId={salesOrder.customer_id}
              initialCustomerName={customerName}
              initialCompanyName={companyName ?? null}
              initialContactId={initialContactId}
              initialContactName={initialContactName}
              canReassign={canReassignCustomer}
            />
          </div>
          <div className="text-right">
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${SO_STATUS_STYLES[status]}`}>
              {SO_STATUS_LABELS[status]}
            </span>
            <p className="mt-2 text-xs text-gray-500">
              Created {new Date(salesOrder.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          {canSeePricing && (
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-gray-500">Total</span>
              <span className="mt-1 block text-lg font-extrabold tabular-nums text-gray-900">${formatCents(salesOrder.total)}</span>
            </div>
          )}
          {parentQuote && (
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-gray-500">From Quote</span>
              <Link href={`/dashboard/${orgSlug}/quotes/${parentQuote.id}`} className="mt-1 block text-sm font-semibold text-qm-fuchsia hover:underline">
                {formatQuoteNumber(parentQuote.quote_number, parentQuote.created_at)} &mdash; {parentQuote.title}
              </Link>
            </div>
          )}
          {salesOrder.customer?.email && (
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-gray-500">Email</span>
              <a href={`mailto:${salesOrder.customer.email}`} className="mt-1 block text-sm text-gray-700 hover:text-green-600 hover:underline">{salesOrder.customer.email}</a>
            </div>
          )}
          {salesOrder.customer?.phone && (
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-gray-500">Phone</span>
              <a href={`tel:${salesOrder.customer.phone}`} className="mt-1 block text-sm text-gray-700 hover:text-green-600 hover:underline">{salesOrder.customer.phone}</a>
            </div>
          )}
        </div>

        {salesOrder.notes && (
          <div className="mt-4">
            <span className="block text-xs font-bold uppercase tracking-wider text-gray-500">Notes</span>
            <p className="mt-1 text-sm text-gray-700">{salesOrder.notes}</p>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          {MANUAL_STATUSES.map((s) => (
            <button key={s.value} type="button" onClick={() => handleStatusChange(s.value)}
              disabled={isPending || status === s.value}
              className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                status === s.value ? 'border-gray-300 bg-gray-100 text-gray-500' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}>
              {s.label}
            </button>
          ))}
        </div>

        {status === 'completed' && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <button type="button" onClick={handleCreateInvoice} disabled={creatingInvoice}
              className="w-full rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2">
              {creatingInvoice ? 'Creating Invoice…' : '+ Create Invoice'}
            </button>
            {invoiceError && <p className="mt-2 text-sm text-red-600">{invoiceError}</p>}
          </div>
        )}
      </div>

      {/* ── Shipments ─────────────────────────────────────────────────────── */}
      {(() => {
        const editShip  = editShipmentId ? shipments.find(s => s.id === editShipmentId) ?? null : null
        const panelOpen = showShipForm || editShipmentId !== null

        const billingAddrLine = fmtAddrLine(
          salesOrder.customer?.street ?? null, salesOrder.customer?.city ?? null,
          salesOrder.customer?.state ?? null, salesOrder.customer?.zip ?? null,
        )

        return (
          <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                Shipments
                {shipments.length > 0 && (
                  <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">{shipments.length}</span>
                )}
              </h2>
              <div className="flex items-center gap-2">
                {!panelOpen && (
                  <button type="button"
                    onClick={() => {
                      setShowShipForm(true); setEditShipmentId(null)
                      setAddrMode('billing'); prefillBilling()
                    }}
                    className="rounded-md bg-qm-lime px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110">
                    + Add Shipment
                  </button>
                )}
                <Link href={`/dashboard/${orgSlug}/sales-orders/${salesOrder.id}/shipments`} className="text-sm text-gray-500 hover:text-gray-700">
                  View all →
                </Link>
              </div>
            </div>

            {panelOpen && (
              <div className="border-b border-gray-200 bg-gray-50 px-6 py-5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-4">
                  {editShip ? 'Edit Shipment' : 'New Shipment'}
                </h3>

                <form key={editShipmentId ?? 'new'} action={saveShipment} className="space-y-5">
                  {editShip && <input type="hidden" name="id" value={editShip.id} />}
                  <input type="hidden" name="orgId" value={orgId} />
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="soId" value={salesOrder.id} />
                  <input type="hidden" name="label_url" value={shipLabelUrl} />

                  {/* ── ADDRESS ─────────────────────────────────────────── */}
                  <div>
                    <p className={secHdr}>Ship To</p>
                    <div className="space-y-2">
                      {/* Billing */}
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input type="radio" checked={addrMode === 'billing'} onChange={() => handleAddrMode('billing')} className="mt-0.5 accent-indigo-600" />
                        <span className="text-sm text-gray-700">
                          Billing address
                          {billingAddrLine && <span className="ml-1.5 text-gray-400 text-xs">{billingAddrLine}</span>}
                        </span>
                      </label>

                      {/* Saved */}
                      {customerShippingAddresses.length > 0 && (
                        <div>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="radio" checked={addrMode === 'saved'} onChange={() => handleAddrMode('saved')} className="accent-indigo-600" />
                            <span className="text-sm text-gray-700">Saved shipping address</span>
                          </label>
                          {addrMode === 'saved' && (
                            <select value={savedAddrId} onChange={e => handleSavedAddr(e.target.value)}
                              className="mt-2 ml-6 block w-auto min-w-[260px] rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none">
                              <option value="">— Select saved address —</option>
                              {customerShippingAddresses.map(a => (
                                <option key={a.id} value={a.id}>
                                  {a.label ? `${a.label} · ` : ''}{a.street}, {a.city} {a.state} {a.zip}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}

                      {/* New */}
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" checked={addrMode === 'new'} onChange={() => handleAddrMode('new')} className="accent-indigo-600" />
                        <span className="text-sm text-gray-700">New address</span>
                      </label>
                      {addrMode === 'new' && (
                        <div className="ml-6 mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2">
                          <div className="sm:col-span-2">
                            <label className={lbl}>Recipient Name</label>
                            <input type="text" value={shipToName} onChange={e => setShipToName(e.target.value)} className={inp} />
                          </div>
                          <div className="sm:col-span-3">
                            <label className={lbl}>Street</label>
                            <input type="text" value={shipToStreet} onChange={e => setShipToStreet(e.target.value)} className={inp} />
                          </div>
                          <div className="sm:col-span-2">
                            <label className={lbl}>City</label>
                            <input type="text" value={shipToCity} onChange={e => setShipToCity(e.target.value)} className={inp} />
                          </div>
                          <div>
                            <label className={lbl}>State</label>
                            <input type="text" maxLength={2} value={shipToState} onChange={e => setShipToState(e.target.value.toUpperCase())} className={inp} />
                          </div>
                          <div>
                            <label className={lbl}>ZIP *</label>
                            <input type="text" value={shipToZip} onChange={e => setShipToZip(e.target.value)} className={inp} />
                          </div>
                        </div>
                      )}

                      {/* ZIP override for billing/saved modes */}
                      {addrMode !== 'new' && (
                        <div className="ml-6 mt-2 max-w-[180px]">
                          <label className={lbl}>Destination ZIP</label>
                          <input type="text" value={shipToZip} onChange={e => setShipToZip(e.target.value)} placeholder="78041" className={inp} />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── PACKAGE ─────────────────────────────────────────── */}
                  <div>
                    <p className={secHdr}>Package</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={lbl}>Shipping Method</label>
                        <select name="shipping_method_id" defaultValue={editShip?.shipping_method_id ?? ''} className={inp}>
                          <option value="">— Select method —</option>
                          {shippingMethods.filter(m => m.is_active).map(m => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={lbl}>Weight (lbs)</label>
                        <input type="number" step="0.01" min="0" name="weight_lbs" value={shipWeightLbs} onChange={e => setShipWeightLbs(e.target.value)} className={inp} />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={lbl}>Box Profile <span className="text-gray-400 font-normal">(auto-fills L×W×H)</span></label>
                        <select name="shipping_profile_id" value={shipProfileId} onChange={e => handleProfileSelect(e.target.value)} className={inp}>
                          <option value="">— Select profile —</option>
                          {shippingProfiles.filter(p => p.is_active).map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name}{p.length_in != null ? ` (${p.length_in}×${p.width_in}×${p.height_in}")` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-2 grid grid-cols-3 gap-3">
                        <div>
                          <label className={lbl}>Length (in)</label>
                          <input type="number" step="0.01" min="0" name="length_in" value={shipDimL} onChange={e => setShipDimL(e.target.value)} className={inp} />
                        </div>
                        <div>
                          <label className={lbl}>Width (in)</label>
                          <input type="number" step="0.01" min="0" name="width_in" value={shipDimW} onChange={e => setShipDimW(e.target.value)} className={inp} />
                        </div>
                        <div>
                          <label className={lbl}>Height (in)</label>
                          <input type="number" step="0.01" min="0" name="height_in" value={shipDimH} onChange={e => setShipDimH(e.target.value)} className={inp} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── STATUS & TRACKING ───────────────────────────────── */}
                  <div>
                    <p className={secHdr}>Status &amp; Tracking</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={lbl}>Status</label>
                        <select name="status" value={shipStatus} onChange={e => setShipStatus(e.target.value)} className={inp}>
                          <option value="pending">Pending</option>
                          <option value="shipped">Shipped</option>
                          <option value="delivered">Delivered</option>
                          <option value="returned">Returned</option>
                        </select>
                      </div>
                      <div>
                        <label className={lbl}>Tracking Number</label>
                        <input type="text" name="tracking_number" value={shipTracking} onChange={e => setShipTracking(e.target.value)} placeholder="1Z999AA10123456784" className={inp} />
                      </div>
                      <div>
                        <label className={lbl}>Shipped Date</label>
                        <input type="date" name="shipped_date" defaultValue={editShip?.shipped_date ?? ''} className={inp} />
                      </div>
                      <div>
                        <label className={lbl}>Est. Delivery</label>
                        <input type="date" name="estimated_delivery" defaultValue={editShip?.estimated_delivery ?? ''} className={inp} />
                      </div>
                      <div>
                        <label className={lbl}>Quoted Rate ($)</label>
                        <input type="number" step="0.01" min="0" name="quoted_rate" defaultValue={editShip?.quoted_rate ?? ''} className={inp} />
                      </div>
                      <div>
                        <label className={lbl}>Actual Cost ($)</label>
                        <input type="number" step="0.01" min="0" name="actual_cost" value={shipActualCost} onChange={e => setShipActualCost(e.target.value)} className={inp} />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={lbl}>Notes</label>
                        <textarea name="notes" rows={2} defaultValue={editShip?.notes ?? ''} className={inp + ' resize-y'} />
                      </div>
                    </div>
                  </div>

                  {/* ── LIVE RATES ──────────────────────────────────────── */}
                  <div>
                    <p className={secHdr}>Live Rates via EasyPost</p>
                    <button type="button" onClick={handleGetRates} disabled={ratesLoading}
                      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                      {ratesLoading ? 'Fetching rates…' : 'Get Live Rates'}
                    </button>

                    {ratesError && <p className="mt-2 text-sm text-red-600">{ratesError}</p>}

                    {fetchedRates.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {fetchedRates.map(r => (
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
                              <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-bold ${carrierBadgeStyle(r.carrier)}`}>
                                {r.carrier}
                              </span>
                              <span className="text-sm font-medium text-gray-800">{r.service}</span>
                              {r.delivery_days != null && (
                                <span className="text-xs text-gray-400">{r.delivery_days} day{r.delivery_days !== 1 ? 's' : ''}</span>
                              )}
                            </div>
                            <span className="text-sm font-bold tabular-nums text-gray-900">${parseFloat(r.rate).toFixed(2)}</span>
                          </label>
                        ))}

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
                        <a href={shipLabelUrl} target="_blank" rel="noopener noreferrer"
                          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                          Print Label ↗
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button type="submit" className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">Save</button>
                    <button type="button" onClick={closeShipForm} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                  </div>
                </form>
              </div>
            )}

            {shipments.length === 0 && !panelOpen ? (
              <div className="py-10 text-center text-sm text-gray-500">No shipments yet.</div>
            ) : shipments.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Method', 'Tracking', 'Weight', 'Shipped', 'Cost', 'Status', ''].map(h => (
                        <th key={h} className={`px-4 py-3 text-${h ? 'left' : 'right'} text-xs font-medium uppercase tracking-wide text-gray-500`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {shipments.map(s => {
                      const method  = shippingMethods.find(m => m.id === s.shipping_method_id)
                      const carrier = method?.carrier ?? s.carrier
                      const tUrl    = trackingUrl(carrier, s.tracking_number)
                      return (
                        <tr key={s.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-900 max-w-[150px]">
                            <span className="truncate block">{method?.name ?? s.carrier ?? <span className="text-gray-300">—</span>}</span>
                          </td>
                          <td className="px-4 py-3 text-sm font-mono">
                            {s.tracking_number
                              ? tUrl
                                ? <a href={tUrl} target="_blank" rel="noopener noreferrer" className="text-qm-fuchsia hover:underline">{s.tracking_number}</a>
                                : <span className="text-gray-700">{s.tracking_number}</span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                            {s.weight_lbs != null ? `${s.weight_lbs} lbs` : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{fmtDate(s.shipped_date)}</td>
                          <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                            {s.actual_cost != null
                              ? `$${Number(s.actual_cost).toFixed(2)}`
                              : s.quoted_rate != null
                                ? <span className="text-gray-400">${Number(s.quoted_rate).toFixed(2)} est.</span>
                                : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${SHIP_STATUS_STYLES[s.status] ?? 'bg-gray-100 text-gray-700'}`}>
                                {SHIP_STATUS_LABELS[s.status] ?? s.status}
                              </span>
                              {s.label_url && (
                                <a href={s.label_url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline">Label ↗</a>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <button type="button" onClick={() => { setEditShipmentId(s.id); setShowShipForm(false) }} className="text-sm text-qm-lime hover:underline mr-3">Edit</button>
                            <form action={deleteShipment} className="inline">
                              <input type="hidden" name="id" value={s.id} />
                              <input type="hidden" name="orgSlug" value={orgSlug} />
                              <input type="hidden" name="soId" value={salesOrder.id} />
                              <button type="submit" className="text-sm text-red-500 hover:underline">Delete</button>
                            </form>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        )
      })()}

      {/* Child jobs */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-bold text-gray-900">Jobs</h2>
        </div>
        {jobs.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            No jobs created yet. Jobs are created automatically when a quote is approved.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['#', 'Title', 'Status', 'Due Date'].map(h => (
                    <th key={h} className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium">
                      <Link href={`/dashboard/${orgSlug}/jobs/${job.id}`} className="text-qm-fuchsia hover:underline">
                        JOB-{String(job.job_number).padStart(4, '0')}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">{job.title}</td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${JOB_STATUS_STYLES[job.status]}`}>
                        {JOB_STATUS_LABELS[job.status]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {job.due_date
                        ? new Date(job.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : <span className="text-gray-300">&mdash;</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
