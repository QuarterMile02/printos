'use client'

import React, { useState, useCallback } from 'react'
import Link from 'next/link'
import { formatPoNumber, PO_STATUS_STYLES, PO_STATUS_LABELS } from '../format'

type Vendor = { id: string; name: string; primary_contact: string | null; primary_email: string | null; primary_phone: string | null }
type SalesOrder = { id: string; so_number: number; title: string | null }
type Creator = { id: string; full_name: string }

type PoItem = {
  id: string
  description: string | null
  quantity: number
  unit_cost: number
  total_cost: number
  received_qty: number
  sort_order: number
}

type FullPo = {
  id: string
  po_number: number
  status: string
  title: string | null
  notes: string | null
  subtotal: number
  tax_total: number
  total: number
  expected_delivery_date: string | null
  received_date: string | null
  created_at: string
  updated_at: string
  vendor: Vendor | null
  sales_order: SalesOrder | null
  creator: Creator | null
  purchase_order_items: PoItem[]
}

type Props = {
  slug: string
  orgId: string
  orgName: string
  initialPo: FullPo
}

const STATUSES = ['draft', 'sent', 'partial', 'received', 'cancelled']

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

const fmtMoney = (n: number | string) =>
  Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export default function PurchaseOrderDetailClient({ slug, orgId, orgName, initialPo }: Props) {
  const [po, setPo] = useState<FullPo>(initialPo)
  const [items, setItems] = useState<PoItem[]>(
    [...initialPo.purchase_order_items].sort((a, b) => a.sort_order - b.sort_order),
  )
  const [status, setStatus] = useState(initialPo.status)
  const [savingStatus, setSavingStatus] = useState(false)

  const [editNotes, setEditNotes] = useState(false)
  const [notes, setNotes] = useState(initialPo.notes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)

  const [editTitle, setEditTitle] = useState(false)
  const [title, setTitle] = useState(initialPo.title ?? '')
  const [savingTitle, setSavingTitle] = useState(false)

  const [showAddItem, setShowAddItem] = useState(false)
  const [addDesc, setAddDesc] = useState('')
  const [addQty, setAddQty] = useState('1')
  const [addCost, setAddCost] = useState('')
  const [addingItem, setAddingItem] = useState(false)

  const [editItemId, setEditItemId] = useState<string | null>(null)
  const [editItemDesc, setEditItemDesc] = useState('')
  const [editItemQty, setEditItemQty] = useState('')
  const [editItemCost, setEditItemCost] = useState('')
  const [savingItem, setSavingItem] = useState(false)

  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const patchPo = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/purchase-orders/${po.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.ok
  }, [po.id])

  const handleStatusChange = async (newStatus: string) => {
    setSavingStatus(true)
    const ok = await patchPo({ status: newStatus })
    if (ok) setStatus(newStatus)
    else showToast('Failed to update status')
    setSavingStatus(false)
  }

  const handleSaveNotes = async () => {
    setSavingNotes(true)
    const ok = await patchPo({ notes })
    if (ok) { setPo((p) => ({ ...p, notes })); setEditNotes(false) }
    else showToast('Failed to save notes')
    setSavingNotes(false)
  }

  const handleSaveTitle = async () => {
    setSavingTitle(true)
    const ok = await patchPo({ title: title.trim() || null })
    if (ok) { setPo((p) => ({ ...p, title: title.trim() || null })); setEditTitle(false) }
    else showToast('Failed to save title')
    setSavingTitle(false)
  }

  const handleAddItem = async () => {
    if (!addDesc.trim()) return
    setAddingItem(true)
    const res = await fetch(`/api/purchase-orders/${po.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: addDesc.trim(),
        quantity: Number(addQty) || 1,
        unit_cost: Number(addCost) || 0,
        sort_order: items.length,
      }),
    })
    if (res.ok) {
      const newItem = await res.json()
      setItems((prev) => [...prev, newItem])
      const subtotal = [...items, newItem].reduce((s, i) => s + Number(i.total_cost), 0)
      setPo((p) => ({ ...p, subtotal, total: subtotal }))
      setAddDesc(''); setAddQty('1'); setAddCost('')
      setShowAddItem(false)
    } else {
      showToast('Failed to add item')
    }
    setAddingItem(false)
  }

  const startEditItem = (item: PoItem) => {
    setEditItemId(item.id)
    setEditItemDesc(item.description ?? '')
    setEditItemQty(String(item.quantity))
    setEditItemCost(String(item.unit_cost))
  }

  const handleSaveItem = async (itemId: string) => {
    setSavingItem(true)
    const res = await fetch(`/api/purchase-orders/${po.id}/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: editItemDesc.trim(),
        quantity: Number(editItemQty) || 1,
        unit_cost: Number(editItemCost) || 0,
      }),
    })
    if (res.ok) {
      const updated = await res.json()
      setItems((prev) => prev.map((i) => i.id === itemId ? updated : i))
      const subtotal = items.map((i) => i.id === itemId ? updated : i).reduce((s, i) => s + Number(i.total_cost), 0)
      setPo((p) => ({ ...p, subtotal, total: subtotal }))
      setEditItemId(null)
    } else {
      showToast('Failed to save item')
    }
    setSavingItem(false)
  }

  const handleDeleteItem = async (itemId: string) => {
    const res = await fetch(`/api/purchase-orders/${po.id}/items/${itemId}`, { method: 'DELETE' })
    if (res.ok) {
      const next = items.filter((i) => i.id !== itemId)
      setItems(next)
      const subtotal = next.reduce((s, i) => s + Number(i.total_cost), 0)
      setPo((p) => ({ ...p, subtotal, total: subtotal }))
    } else {
      showToast('Failed to delete item')
    }
  }

  const poLabel = formatPoNumber(po.po_number, po.created_at)

  return (
    <div className="p-6 max-w-5xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <span>{orgName}</span>
        <span>/</span>
        <Link href={`/dashboard/${slug}/purchase-orders`} className="hover:text-gray-900">Purchase Orders</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{poLabel}</span>
      </nav>

      {/* Header card */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6 mb-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Title */}
            {editTitle ? (
              <div className="flex items-center gap-2 mb-1">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') setEditTitle(false) }}
                  autoFocus
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-qm-lime"
                />
                <button onClick={handleSaveTitle} disabled={savingTitle} className="rounded-lg bg-qm-lime px-3 py-1.5 text-sm font-semibold text-qm-black disabled:opacity-50">
                  {savingTitle ? '…' : 'Save'}
                </button>
                <button onClick={() => setEditTitle(false)} className="text-gray-400 hover:text-gray-600 text-sm">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setEditTitle(true)} className="group flex items-center gap-1.5 text-left mb-1">
                <h1 className="text-2xl font-bold text-gray-900">{poLabel}</h1>
                {po.title && <span className="text-lg text-gray-600">— {po.title}</span>}
                <svg className="h-4 w-4 text-gray-300 group-hover:text-gray-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" />
                </svg>
              </button>
            )}
            <p className="text-sm text-gray-500">Created {fmtDate(po.created_at)}{po.creator ? ` by ${po.creator.full_name}` : ''}</p>
          </div>

          {/* Status selector */}
          <div className="shrink-0">
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={savingStatus}
              className={`rounded-full px-3 py-1 text-sm font-semibold border-0 outline-none cursor-pointer ${PO_STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'}`}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{PO_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Meta grid */}
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 text-sm">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">Vendor</p>
            <p className="text-gray-900 font-medium">{po.vendor?.name ?? <span className="text-gray-400">Not set</span>}</p>
            {po.vendor?.primary_email && <p className="text-gray-500 text-xs">{po.vendor.primary_email}</p>}
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">Linked SO</p>
            {po.sales_order ? (
              <Link href={`/dashboard/${slug}/sales-orders/${po.sales_order.id}`} className="text-blue-600 hover:underline font-medium">
                SO-{po.sales_order.so_number}
              </Link>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">Expected Delivery</p>
            <p className="text-gray-900">{fmtDate(po.expected_delivery_date)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">Received Date</p>
            <p className="text-gray-900">{fmtDate(po.received_date)}</p>
          </div>
        </div>
      </div>

      {/* Line Items */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm mb-5">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Line Items</h2>
          <button
            onClick={() => setShowAddItem(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-qm-lime hover:opacity-80"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Item
          </button>
        </div>

        {items.length === 0 && !showAddItem ? (
          <div className="px-6 py-8 text-center text-gray-400 text-sm">
            No items yet.{' '}
            <button onClick={() => setShowAddItem(true)} className="text-qm-lime hover:underline">Add the first item.</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Description</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700 w-24">Qty</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700 w-28">Unit Cost</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700 w-28">Total</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700 w-28">Received</th>
                  <th className="px-4 py-3 w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item) => (
                  editItemId === item.id ? (
                    <tr key={item.id} className="bg-amber-50">
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={editItemDesc}
                          onChange={(e) => setEditItemDesc(e.target.value)}
                          autoFocus
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-qm-lime"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          value={editItemQty}
                          onChange={(e) => setEditItemQty(e.target.value)}
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-qm-lime"
                          min="0" step="0.001"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          value={editItemCost}
                          onChange={(e) => setEditItemCost(e.target.value)}
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-qm-lime"
                          min="0" step="0.01"
                        />
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500">
                        {fmtMoney((Number(editItemQty) || 0) * (Number(editItemCost) || 0))}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-400">—</td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => handleSaveItem(item.id)} disabled={savingItem} className="text-xs font-semibold text-qm-lime hover:opacity-80 disabled:opacity-50">Save</button>
                          <button onClick={() => setEditItemId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700">{item.description ?? <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{Number(item.quantity)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{fmtMoney(item.unit_cost)}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{fmtMoney(item.total_cost)}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{Number(item.received_qty) > 0 ? Number(item.received_qty) : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => startEditItem(item)} className="text-gray-400 hover:text-gray-700">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" />
                            </svg>
                          </button>
                          <button onClick={() => handleDeleteItem(item.id)} className="text-gray-300 hover:text-red-500">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                ))}

                {/* Add item row */}
                {showAddItem && (
                  <tr className="bg-green-50">
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={addDesc}
                        onChange={(e) => setAddDesc(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddItem() }}
                        autoFocus
                        placeholder="Description"
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-qm-lime"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        value={addQty}
                        onChange={(e) => setAddQty(e.target.value)}
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-qm-lime"
                        min="0" step="0.001"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        value={addCost}
                        onChange={(e) => setAddCost(e.target.value)}
                        placeholder="0.00"
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-qm-lime"
                        min="0" step="0.01"
                      />
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500">
                      {fmtMoney((Number(addQty) || 0) * (Number(addCost) || 0))}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-400">—</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={handleAddItem} disabled={addingItem || !addDesc.trim()} className="text-xs font-semibold text-qm-lime hover:opacity-80 disabled:opacity-50">
                          {addingItem ? '…' : 'Add'}
                        </button>
                        <button onClick={() => { setShowAddItem(false); setAddDesc(''); setAddQty('1'); setAddCost('') }} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Totals */}
        {items.length > 0 && (
          <div className="border-t border-gray-100 px-6 py-4">
            <div className="ml-auto max-w-xs space-y-1 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>{fmtMoney(Number(po.subtotal))}</span>
              </div>
              <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1 mt-1">
                <span>Total</span>
                <span>{fmtMoney(Number(po.total))}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">Notes</h2>
          {!editNotes && (
            <button onClick={() => setEditNotes(true)} className="text-sm text-gray-500 hover:text-gray-900">
              Edit
            </button>
          )}
        </div>
        {editNotes ? (
          <div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              autoFocus
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime resize-y"
              placeholder="Add any notes or instructions for this PO…"
            />
            <div className="flex gap-2 mt-2">
              <button onClick={handleSaveNotes} disabled={savingNotes} className="rounded-lg bg-qm-lime px-3 py-1.5 text-sm font-semibold text-qm-black disabled:opacity-50">
                {savingNotes ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => { setEditNotes(false); setNotes(po.notes ?? '') }} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          </div>
        ) : (
          <p className={`text-sm ${po.notes ? 'text-gray-700 whitespace-pre-wrap' : 'text-gray-400 italic'}`}>
            {po.notes || 'No notes yet.'}
          </p>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-gray-900 px-4 py-3 text-sm text-white shadow-xl">
          {toast}
        </div>
      )}
    </div>
  )
}
