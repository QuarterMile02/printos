'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { unpostInvoice, repostInvoice, updateInvoiceDetails } from './actions'

type Props = {
  invoiceId: string
  orgId: string
  orgSlug: string
  isPosted: boolean
  canEdit: boolean // owner/admin — matches assertInvoiceEditor
  editedSinceUnpost: boolean
  initial: {
    title: string | null
    notes: string | null
    install_address: string | null
    billing_company_name: string | null
    billing_street: string | null
    billing_street2: string | null
    billing_city: string | null
    billing_state: string | null
    billing_zip: string | null
    shipping_name: string | null
    shipping_street: string | null
    shipping_street2: string | null
    shipping_city: string | null
    shipping_state: string | null
    shipping_zip: string | null
  }
}

const inputCls = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
const labelCls = 'block text-xs font-medium text-gray-500'

export default function InvoiceEditPanel({ invoiceId, orgId, orgSlug, isPosted, canEdit, editedSinceUnpost, initial }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [fields, setFields] = useState(initial)

  // Re-sync when the server-derived `initial` actually changes content —
  // e.g. after InvoiceCustomerPicker's cascade save calls router.refresh(),
  // this component isn't remounted, so useState(initial)'s seed value goes
  // stale without this. Guarded on serialized content (not just object
  // identity, which changes on every server re-render) so it doesn't clobber
  // in-progress typing on unrelated refreshes.
  const initialKey = JSON.stringify(initial)
  useEffect(() => {
    setFields(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey])

  function flash(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  function set<K extends keyof typeof fields>(key: K, value: string) {
    setFields((f) => ({ ...f, [key]: value }))
  }

  function handleUnpost() {
    if (!window.confirm(
      'Unpost this invoice? This reopens it for editing. QuickBooks is not affected — any correction there has to be made separately.'
    )) return
    startTransition(async () => {
      const res = await unpostInvoice(invoiceId, orgId, orgSlug)
      if (res.error) { flash(res.error, false); return }
      flash('Invoice unposted — now editable.', true)
      router.refresh()
    })
  }

  function handleRepost() {
    startTransition(async () => {
      const res = await repostInvoice(invoiceId, orgId, orgSlug)
      if (res.error) { flash(res.error, false); return }
      flash('Invoice reposted.', true)
      router.refresh()
    })
  }

  function handleSave() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('invoiceId', invoiceId)
      fd.set('orgId', orgId)
      fd.set('orgSlug', orgSlug)
      for (const [k, v] of Object.entries(fields)) {
        if (k === 'billing_company_name') continue // cascade-only, not submitted
        fd.set(k, v ?? '')
      }
      const res = await updateInvoiceDetails(fd)
      if (res.error) { flash(res.error, false); return }
      flash('Invoice updated.', true)
      router.refresh()
    })
  }

  if (isPosted) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Invoice Details</h2>
            <p className="mt-1 text-xs text-gray-400">Posted invoices are read-only. Unpost to edit customer, contact, addresses, title, or notes.</p>
          </div>
          {canEdit && (
            <button
              type="button"
              disabled={pending}
              onClick={handleUnpost}
              className="shrink-0 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {pending ? 'Unposting…' : 'Unpost'}
            </button>
          )}
        </div>
        {toast && (
          <p className={`mt-3 text-xs font-medium ${toast.ok ? 'text-green-600' : 'text-red-600'}`}>{toast.msg}</p>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Invoice Details</h2>
          <p className="mt-1 text-xs text-amber-600 font-medium">Unposted — editable. Repost when done.</p>
        </div>
        <div className="flex items-center gap-2">
          {toast && (
            <span className={`text-xs font-medium ${toast.ok ? 'text-green-600' : 'text-red-600'}`}>{toast.msg}</span>
          )}
          {canEdit && (
            <button
              type="button"
              disabled={pending}
              onClick={handleSave}
              className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50 transition-all"
            >
              {pending ? 'Saving…' : 'Save Changes'}
            </button>
          )}
          {canEdit && editedSinceUnpost && (
            <button
              type="button"
              disabled={pending}
              onClick={handleRepost}
              className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50 transition-all"
            >
              {pending ? 'Reposting…' : 'Repost'}
            </button>
          )}
        </div>
      </div>

      <fieldset disabled={!canEdit || pending} className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Title</label>
            <input type="text" value={fields.title ?? ''} onChange={(e) => set('title', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Install Address</label>
            <input
              type="text" value={fields.install_address ?? ''} onChange={(e) => set('install_address', e.target.value)}
              placeholder="Independent of billing/shipping — only if this job installs somewhere else"
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>Notes</label>
          <textarea value={fields.notes ?? ''} onChange={(e) => set('notes', e.target.value)} rows={3} className={inputCls} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2 border-t border-gray-100">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Billing Address</p>
            <p className="text-xs text-gray-500 mb-2">
              {fields.billing_company_name ?? <span className="italic text-gray-400">No company — set via Customer above</span>}
            </p>
            <div className="space-y-2">
              <input type="text" placeholder="Street" value={fields.billing_street ?? ''} onChange={(e) => set('billing_street', e.target.value)} className={inputCls} />
              <input type="text" placeholder="Street 2" value={fields.billing_street2 ?? ''} onChange={(e) => set('billing_street2', e.target.value)} className={inputCls} />
              <div className="grid grid-cols-3 gap-2">
                <input type="text" placeholder="City" value={fields.billing_city ?? ''} onChange={(e) => set('billing_city', e.target.value)} className={inputCls} />
                <input type="text" placeholder="State" value={fields.billing_state ?? ''} onChange={(e) => set('billing_state', e.target.value)} className={inputCls} />
                <input type="text" placeholder="ZIP" value={fields.billing_zip ?? ''} onChange={(e) => set('billing_zip', e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Shipping Address</p>
            <div className="space-y-2">
              <input type="text" placeholder="Recipient / Company" value={fields.shipping_name ?? ''} onChange={(e) => set('shipping_name', e.target.value)} className={inputCls} />
              <input type="text" placeholder="Street" value={fields.shipping_street ?? ''} onChange={(e) => set('shipping_street', e.target.value)} className={inputCls} />
              <input type="text" placeholder="Street 2" value={fields.shipping_street2 ?? ''} onChange={(e) => set('shipping_street2', e.target.value)} className={inputCls} />
              <div className="grid grid-cols-3 gap-2">
                <input type="text" placeholder="City" value={fields.shipping_city ?? ''} onChange={(e) => set('shipping_city', e.target.value)} className={inputCls} />
                <input type="text" placeholder="State" value={fields.shipping_state ?? ''} onChange={(e) => set('shipping_state', e.target.value)} className={inputCls} />
                <input type="text" placeholder="ZIP" value={fields.shipping_zip ?? ''} onChange={(e) => set('shipping_zip', e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>
        </div>
      </fieldset>
    </div>
  )
}
