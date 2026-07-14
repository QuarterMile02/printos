import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { saveShipment, deleteShipment } from './actions-sr'
import { formatSoNumber } from '../../format'

export const dynamic = 'force-dynamic'

const SHIP_STATUS_STYLES: Record<string, string> = {
  pending:   'bg-gray-100  text-gray-700',
  shipped:   'bg-blue-50   text-blue-700',
  delivered: 'bg-green-50  text-green-700',
  returned:  'bg-red-50    text-red-700',
}
const SHIP_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', shipped: 'Shipped', delivered: 'Delivered', returned: 'Returned',
}

function trackingUrl(carrier: string | null, tracking: string | null): string | null {
  if (!tracking) return null
  if (carrier === 'UPS')   return `https://www.ups.com/track?tracknum=${tracking}`
  if (carrier === 'FedEx') return `https://www.fedex.com/fedextrack/?trknbr=${tracking}`
  if (carrier === 'USPS')  return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking}`
  return null
}

type Shipment = {
  id: string
  carrier: string | null
  tracking_number: string | null
  shipped_date: string | null
  estimated_delivery: string | null
  notes: string | null
  status: string
  created_at: string
}

type PageProps = {
  params: Promise<{ slug: string; id: string }>
  searchParams: Promise<{ add?: string; edit?: string; saved?: string }>
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function ShipmentsPage({ params, searchParams }: PageProps) {
  const { slug, id: soId } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) notFound()

  const { data: soRow } = await supabase
    .from('sales_orders')
    .select('id, so_number, title, created_at')
    .eq('id', soId)
    .eq('organization_id', org.id)
    .maybeSingle() as { data: { id: string; so_number: number; title: string | null; created_at: string } | null; error: unknown }
  if (!soRow) notFound()

  const { data: shipData } = await supabase
    .from('shipments')
    .select('id, carrier, tracking_number, shipped_date, estimated_delivery, notes, status, created_at')
    .eq('sales_order_id', soId)
    .order('created_at', { ascending: false })
  const shipments = (shipData ?? []) as Shipment[]

  const editId = sp.edit
  const showAdd = sp.add === '1'
  const editShip = editId ? shipments.find(s => s.id === editId) ?? null : null
  const isPanelOpen = Boolean(showAdd || editShip)

  const inp = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

  return (
    <div className="p-8 max-w-5xl">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/sales-orders`} className="hover:text-gray-700">Sales Orders</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/sales-orders/${soId}`} className="hover:text-gray-700">
          {formatSoNumber(soRow.so_number, soRow.created_at)}
        </Link>
        <span>/</span>
        <span className="text-gray-700">Shipments</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Shipments <span className="text-sm font-normal text-gray-400">({shipments.length})</span>
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/${slug}/sales-orders/${soId}`}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ← Back to SO
          </Link>
          {!isPanelOpen && (
            <Link
              href={`/dashboard/${slug}/sales-orders/${soId}/shipments?add=1`}
              className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
            >
              + Add Shipment
            </Link>
          )}
        </div>
      </div>

      {/* Add/Edit panel */}
      {isPanelOpen && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {sp.saved === '1' && (
            <div className="mb-4 rounded-md border border-qm-lime/30 bg-qm-lime/10 px-3 py-2 text-sm font-medium text-qm-lime-dark">
              Shipment saved.
            </div>
          )}
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">
            {editShip ? 'Edit Shipment' : 'New Shipment'}
          </h2>
          <form action={saveShipment} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {editShip && <input type="hidden" name="id" value={editShip.id} />}
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="orgSlug" value={slug} />
            <input type="hidden" name="soId" value={soId} />

            <div>
              <label className="block text-xs font-medium text-gray-500">Carrier</label>
              <select name="carrier" defaultValue={editShip?.carrier ?? ''} className={inp}>
                <option value="">— Select carrier —</option>
                <option value="UPS">UPS</option>
                <option value="FedEx">FedEx</option>
                <option value="USPS">USPS</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500">Tracking Number</label>
              <input type="text" name="tracking_number" defaultValue={editShip?.tracking_number ?? ''} placeholder="1Z999AA10123456784" className={inp} />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500">Shipped Date</label>
              <input type="date" name="shipped_date" defaultValue={editShip?.shipped_date ?? ''} className={inp} />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500">Est. Delivery</label>
              <input type="date" name="estimated_delivery" defaultValue={editShip?.estimated_delivery ?? ''} className={inp} />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500">Status</label>
              <select name="status" defaultValue={editShip?.status ?? 'pending'} className={inp}>
                <option value="pending">Pending</option>
                <option value="shipped">Shipped</option>
                <option value="delivered">Delivered</option>
                <option value="returned">Returned</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500">Notes</label>
              <textarea name="notes" rows={3} defaultValue={editShip?.notes ?? ''} className={inp + ' resize-y'} />
            </div>

            <div className="sm:col-span-2 flex gap-2 pt-1">
              <button type="submit" className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
                Save
              </button>
              <Link
                href={`/dashboard/${slug}/sales-orders/${soId}/shipments`}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </Link>
            </div>
          </form>
        </div>
      )}

      {/* List */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Carrier</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Tracking</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Shipped</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Est. Delivery</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
              <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shipments.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-sm text-gray-400">No shipments yet.</td>
              </tr>
            ) : shipments.map(s => {
              const tUrl = trackingUrl(s.carrier, s.tracking_number)
              return (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 text-sm text-gray-900">{s.carrier ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-5 py-3 text-sm font-mono">
                    {s.tracking_number
                      ? tUrl
                        ? <a href={tUrl} target="_blank" rel="noopener noreferrer" className="text-qm-fuchsia hover:underline">{s.tracking_number}</a>
                        : <span className="text-gray-700">{s.tracking_number}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-500 whitespace-nowrap">{fmt(s.shipped_date)}</td>
                  <td className="px-5 py-3 text-sm text-gray-500 whitespace-nowrap">{fmt(s.estimated_delivery)}</td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${SHIP_STATUS_STYLES[s.status] ?? 'bg-gray-100 text-gray-700'}`}>
                      {SHIP_STATUS_LABELS[s.status] ?? s.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <Link
                      href={`/dashboard/${slug}/sales-orders/${soId}/shipments?edit=${s.id}`}
                      className="text-sm text-qm-lime hover:underline mr-3"
                    >
                      Edit
                    </Link>
                    <form action={deleteShipment} className="inline">
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="orgSlug" value={slug} />
                      <input type="hidden" name="soId" value={soId} />
                      <button type="submit" className="text-sm text-red-500 hover:underline">Delete</button>
                    </form>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
