'use client'

import { useRef, useState, useTransition } from 'react'
import { saveEmailSignatureFields } from '@/app/actions/email-signature'
import type { SignatureFields } from '@/app/actions/email-signature'

type Props = {
  orgId: string
  initialFields: SignatureFields
  initialBody: string
}

export default function EmailSignatureEditor({ orgId, initialFields, initialBody }: Props) {
  const [fullName, setFullName] = useState(initialFields.sig_full_name)
  const [title, setTitle] = useState(initialFields.sig_title)
  const [phone, setPhone] = useState(initialFields.sig_phone)
  const [mobile, setMobile] = useState(initialFields.sig_mobile)
  const [address, setAddress] = useState(initialFields.sig_address)
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  function flash(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveEmailSignatureFields(orgId, {
        sig_full_name: fullName,
        sig_title: title,
        sig_phone: phone,
        sig_mobile: mobile,
        sig_address: address,
      })
      if (result.error) {
        flash(result.error, 'error')
      } else {
        flash('Signature saved')
      }
    })
  }

  // Build a preview HTML by substituting contact fields into the existing body
  function getPreviewHtml(): string {
    const phoneLine = [
      phone ? `P: ${phone}` : '',
      mobile ? `M: ${mobile}` : '',
    ].filter(Boolean).join(' &nbsp;·&nbsp; ')

    const contactBlock = `<div style="flex:1;">
      <p class="sn">${esc(fullName)}</p>
      <p class="st">${esc(title)}</p>
      <div class="sd"></div>
      ${phoneLine ? `<p class="sc">${phoneLine}</p>` : ''}
      ${address ? `<p class="sc">${esc(address)}</p>` : ''}
      <p class="sc"><a href="https://www.QuarterMileInc.com">www.QuarterMileInc.com</a></p>
    </div>`

    const regex = /<div style="flex:1;">[\s\S]*?<\/div>\s*<\/div>\s*<div class="sf">/
    if (regex.test(initialBody)) {
      return initialBody.replace(regex, `${contactBlock}\n  </div>\n  <div class="sf">`)
    }
    return initialBody
  }

  function updatePreview(iframe: HTMLIFrameElement | null) {
    if (!iframe) return
    const doc = iframe.contentDocument
    if (!doc) return
    doc.open()
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:8px;font-family:sans-serif;">${getPreviewHtml()}</body></html>`)
    doc.close()
  }

  // Trigger preview re-render on field changes
  const previewKey = `${fullName}|${title}|${phone}|${mobile}|${address}`

  return (
    <>
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg ${
          toast.type === 'success'
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          {toast.message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Fields */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ruben Reyes"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="President"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(956) 722-7690"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Mobile</label>
              <input
                type="tel"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="(956) 236-4367"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Address</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="6420 Polaris Dr. Ste 4, Laredo, Texas 78041"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
          </div>
        </div>

        {/* Live preview */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Preview
          </label>
          <p className="text-xs text-gray-400 mb-2">Updates as you type. The design template is locked.</p>
          <div className="rounded-md border border-gray-200 bg-white overflow-hidden" style={{ minHeight: 260 }}>
            <iframe
              ref={(el) => {
                iframeRef.current = el
                updatePreview(el)
              }}
              key={previewKey}
              title="Signature preview"
              sandbox="allow-same-origin"
              className="w-full border-0"
              style={{ minHeight: 260 }}
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
        >
          {isPending ? 'Saving...' : 'Save Signature'}
        </button>
      </div>
    </>
  )
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
