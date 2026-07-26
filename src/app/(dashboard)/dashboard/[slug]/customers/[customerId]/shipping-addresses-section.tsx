'use client'

import { useState } from 'react'
import { saveShippingAddress, deleteShippingAddress, setDefaultShippingAddress } from './shipping-addresses/actions-sr'

export type ShippingAddress = {
  id: string
  label: string | null
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string
  is_default: boolean
}

type Props = {
  customerId: string
  orgId: string
  orgSlug: string
  initialAddresses: ShippingAddress[]
  inTab?: boolean
}

function fmtAddr(a: ShippingAddress) {
  const parts = [a.street, a.city, a.state && a.zip ? `${a.state} ${a.zip}` : (a.state || a.zip)].filter(Boolean)
  return parts.join(', ') || '—'
}

export default function ShippingAddressesSection({ customerId, orgId, orgSlug, initialAddresses, inTab }: Props) {
  const [addresses, setAddresses] = useState<ShippingAddress[]>(initialAddresses)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const editAddr = editId ? addresses.find(a => a.id === editId) ?? null : null
  const panelOpen = showForm || editId !== null

  const inp = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
  const lbl = 'block text-xs font-medium text-gray-500'

  function openAdd() { setEditId(null); setShowForm(true) }
  function openEdit(id: string) { setEditId(id); setShowForm(false) }
  function closePanel() { setShowForm(false); setEditId(null) }

  async function handleSave(formData: FormData) {
    setSaving(true)
    try {
      await saveShippingAddress(formData)
      // Optimistic update not needed — revalidatePath triggers server refresh.
      closePanel()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={inTab ? '' : 'mt-6 rounded-xl border border-gray-200 bg-white shadow-sm'}>
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
          Shipping Addresses
          {addresses.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
              {addresses.length}
            </span>
          )}
        </h2>
        {!panelOpen && (
          <button type="button" onClick={openAdd} className="rounded-md bg-qm-lime px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110">
            + Add Address
          </button>
        )}
      </div>

      {panelOpen && (
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-5">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">
            {editAddr ? 'Edit Address' : 'New Shipping Address'}
          </h3>
          <form key={editId ?? 'new'} action={handleSave} className="space-y-3">
            {editAddr && <input type="hidden" name="id" value={editAddr.id} />}
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <input type="hidden" name="customerId" value={customerId} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className={lbl}>Label <span className="text-gray-400 font-normal">(e.g. "Main Office", "Job Site")</span></label>
                <input type="text" name="label" defaultValue={editAddr?.label ?? ''} placeholder="Main Office" className={inp} />
              </div>
              <div className="sm:col-span-2">
                <label className={lbl}>Street</label>
                <input type="text" name="street" defaultValue={editAddr?.street ?? ''} className={inp} />
              </div>
              <div>
                <label className={lbl}>City</label>
                <input type="text" name="city" defaultValue={editAddr?.city ?? ''} className={inp} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={lbl}>State</label>
                  <input type="text" name="state" maxLength={2} defaultValue={editAddr?.state ?? ''} placeholder="TX" className={inp} />
                </div>
                <div>
                  <label className={lbl}>ZIP</label>
                  <input type="text" name="zip" defaultValue={editAddr?.zip ?? ''} className={inp} />
                </div>
              </div>
              <div>
                <label className={lbl}>Country</label>
                <input type="text" name="country" defaultValue={editAddr?.country ?? 'US'} className={inp} />
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="is_default" defaultChecked={editAddr?.is_default ?? addresses.length === 0} className="h-4 w-4 accent-qm-lime" />
              <span className="text-sm text-gray-700">Set as default shipping address</span>
            </label>

            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saving} className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={closePanel} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {addresses.length === 0 && !panelOpen ? (
        <div className="py-10 text-center text-sm text-gray-400">No saved shipping addresses yet.</div>
      ) : addresses.length > 0 ? (
        <ul className="divide-y divide-gray-100">
          {addresses.map(a => (
            <li key={a.id} className="flex items-center justify-between gap-4 px-6 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {a.label && <span className="text-sm font-semibold text-gray-900">{a.label}</span>}
                  {a.is_default && (
                    <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">Default</span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-0.5">{fmtAddr(a)}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {!a.is_default && (
                  <form action={setDefaultShippingAddress}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="orgId" value={orgId} />
                    <input type="hidden" name="orgSlug" value={orgSlug} />
                    <input type="hidden" name="customerId" value={customerId} />
                    <button type="submit" className="text-xs text-indigo-600 hover:underline">Set Default</button>
                  </form>
                )}
                <button type="button" onClick={() => openEdit(a.id)} className="text-sm text-qm-lime hover:underline">Edit</button>
                <form action={deleteShippingAddress} className="inline">
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="customerId" value={customerId} />
                  <button type="submit" className="text-sm text-red-500 hover:underline">Delete</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
