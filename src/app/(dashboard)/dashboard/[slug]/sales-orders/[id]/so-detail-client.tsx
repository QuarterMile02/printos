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
import { deleteShipment } from '../../shipping/actions'

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
    shipping_method: string | null
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

const SHIP_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700', shipped: 'bg-blue-50 text-blue-700',
  delivered: 'bg-green-50 text-green-700', returned: 'bg-red-50 text-red-700',
}
const SHIP_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', shipped: 'Shipped', delivered: 'Delivered', returned: 'Returned',
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

type SoLineItem = {
  id: string
  description: string
  quantity: number
  unit_price: number
  total_price: number
  discount_percent: number | null
  taxable: boolean | null
  sort_order: number | null
}

type Props = {
  orgId: string
  orgSlug: string
  salesOrder: SalesOrder
  parentQuote: QuoteRef | null
  jobs: Job[]
  lineItems: SoLineItem[]
  canSeePricing: boolean
  canExportPdf: boolean
  initialContactId: string | null
  initialContactName: string | null
  initialContactEmail?: string | null
  initialContactPhone?: string | null
  canReassignCustomer: boolean
  shipments: Shipment[]
  shipmentSaved?: boolean
  shipmentError?: string
  warning?: string
  shippingMethods: ShippingMethod[]
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

export default function SoDetailClient({
  orgId, orgSlug, salesOrder, parentQuote, jobs, lineItems, canSeePricing, canExportPdf,
  initialContactId, initialContactName, initialContactEmail, initialContactPhone, canReassignCustomer,
  shipments, shipmentSaved, shipmentError, warning, shippingMethods,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<SalesOrderStatus>(salesOrder.status)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [creatingInvoice, setCreatingInvoice] = useState(false)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)

  useEffect(() => {
    if (shipmentError) flash(shipmentError, 'error')
    else if (shipmentSaved) flash('Shipment saved.', 'success')
    if (warning) flash(warning, 'error')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function flash(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
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
            {(initialContactPhone || initialContactEmail || salesOrder.customer?.phone || salesOrder.customer?.email) && (
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
                {(initialContactPhone || salesOrder.customer?.phone) && (
                  <a href={`tel:${initialContactPhone || salesOrder.customer?.phone}`} className="hover:text-qm-lime hover:underline">
                    📞 {initialContactPhone || salesOrder.customer?.phone}
                  </a>
                )}
                {(initialContactEmail || salesOrder.customer?.email) && (
                  <a href={`mailto:${initialContactEmail || salesOrder.customer?.email}`} className="hover:text-qm-lime hover:underline">
                    ✉ {initialContactEmail || salesOrder.customer?.email}
                  </a>
                )}
              </div>
            )}
          </div>
          <div className="text-right">
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${SO_STATUS_STYLES[status]}`}>
              {SO_STATUS_LABELS[status]}
            </span>
            <p className="mt-2 text-xs text-gray-500">
              Created {new Date(salesOrder.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
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
          {canExportPdf && (
            <a
              href={`/api/sales-orders/${salesOrder.id}/pdf`}
              download
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Download PDF
            </a>
          )}
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

      {/* ── Line Items ────────────────────────────────────────────────────── */}
      {lineItems.length > 0 && (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Line Items</h2>
          </div>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 w-10">#</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Product / Description</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500 w-16">Qty</th>
                {canSeePricing && (
                  <>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500 w-28">Unit Price</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500 w-20">Disc%</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500 w-28">Total</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lineItems.map((li, i) => (
                <tr key={li.id} className={i % 2 === 1 ? 'bg-gray-50' : ''}>
                  <td className="px-4 py-3 text-sm text-gray-500 tabular-nums">{i + 1}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">{li.description}</td>
                  <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">{li.quantity}</td>
                  {canSeePricing && (
                    <>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">${formatCents(li.unit_price)}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 text-right tabular-nums">
                        {li.discount_percent ? `${li.discount_percent}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right tabular-nums">${formatCents(li.total_price)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Shipments ─────────────────────────────────────────────────────── */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            Shipments
            {shipments.length > 0 && (
              <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">{shipments.length}</span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <Link href={`/dashboard/${orgSlug}/shipping/new?so=${salesOrder.id}`}
              className="rounded-md bg-qm-lime px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110">
              + Add Shipment
            </Link>
            <Link href={`/dashboard/${orgSlug}/shipping`} className="text-sm text-gray-500 hover:text-gray-700">
              View all shipments →
            </Link>
          </div>
        </div>

        {shipments.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-500">No shipments yet.</div>
        ) : (
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
                        <Link href={`/dashboard/${orgSlug}/shipping/${s.id}`} className="text-sm text-qm-lime hover:underline mr-3">Edit</Link>
                        <form action={deleteShipment} className="inline">
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="orgId" value={orgId} />
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
        )}
      </div>

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
                        ? new Date(job.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
