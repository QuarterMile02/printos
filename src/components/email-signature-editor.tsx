'use client'

import { useRef, useState, useTransition } from 'react'
import { saveEmailSignature } from '@/app/actions/email-signature'

type Props = {
  orgId: string
  initialBody: string
}

export default function EmailSignatureEditor({ orgId, initialBody }: Props) {
  const [body, setBody] = useState(initialBody)
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  function flash(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveEmailSignature(orgId, body)
      if (result.error) {
        flash(result.error, 'error')
      } else {
        flash('Signature saved')
      }
    })
  }

  function handleReset() {
    setBody('')
  }

  // Write HTML into the iframe for sandboxed preview
  function updatePreview(iframe: HTMLIFrameElement | null) {
    if (!iframe) return
    const doc = iframe.contentDocument
    if (!doc) return
    doc.open()
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:8px;font-family:sans-serif;">${body}</body></html>`)
    doc.close()
  }

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
        {/* Editor */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Signature HTML
          </label>
          <p className="text-xs text-gray-400 mb-2">HTML supported — paste your full signature markup including inline styles.</p>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={18}
            spellCheck={false}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>

        {/* Live preview */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Preview
          </label>
          <p className="text-xs text-gray-400 mb-2">How your signature will appear in emails.</p>
          <div className="rounded-md border border-gray-200 bg-white overflow-hidden" style={{ minHeight: 300 }}>
            <iframe
              ref={(el) => {
                iframeRef.current = el
                updatePreview(el)
              }}
              key={body}
              title="Signature preview"
              sandbox="allow-same-origin"
              className="w-full border-0"
              style={{ minHeight: 300 }}
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
        <button
          type="button"
          onClick={handleReset}
          disabled={isPending}
          className="text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          Reset to Default
        </button>
      </div>
    </>
  )
}
