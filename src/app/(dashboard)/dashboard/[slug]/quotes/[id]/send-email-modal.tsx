'use client'

import { useEffect, useState } from 'react'
import { renderTemplate } from '@/app/actions/get-email-template'
import type { EmailTemplate } from '../actions'
import { sendQuoteEmailCustom } from '../actions'

type Quote = {
  id: string
  quote_number: number
  title: string
  total: number
  customer: {
    first_name: string
    last_name: string
    company_name: string | null
    email: string | null
  } | null
}

type Props = {
  open: boolean
  onClose: () => void
  onSent: () => void
  orgId: string
  orgSlug: string
  quote: Quote
  templates: EmailTemplate[]
}

const PDF_TYPE_OPTIONS = [
  { value: 'quote', label: 'Quote PDF' },
  { value: 'no_total', label: 'No-Total PDF' },
]

export default function SendEmailModal({
  open, onClose, onSent, orgId, orgSlug, quote, templates,
}: Props) {
  const customerEmail = quote.customer?.email ?? ''
  const customerName = quote.customer
    ? `${quote.customer.first_name} ${quote.customer.last_name}`
    : ''

  // Filter templates relevant to quotes (quote_sent, quote_revised, manual, etc.)
  const quoteTemplates = templates.filter((t) =>
    ['quote_sent', 'quote_revised', 'quote_reminder', 'manual'].includes(t.trigger_event),
  )

  const [to, setTo] = useState(customerEmail)
  const [cc, setCc] = useState('')
  const [pdfType, setPdfType] = useState('quote')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  // Template variables for rendering
  const templateVars: Record<string, string> = {
    contact_name: customerName,
    txn_number: `Q-${String(quote.quote_number).padStart(4, '0')}`,
    total: `$${(quote.total / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    txn_name: quote.title,
  }

  // Reset state when modal opens
  useEffect(() => {
    if (!open) return
    setTo(customerEmail)
    setCc('')
    setPdfType('quote')
    setError(null)
    setShowPreview(false)
    setIsSending(false)

    // Auto-select the first quote_sent template
    const defaultTemplate = quoteTemplates.find((t) => t.trigger_event === 'quote_sent')
    if (defaultTemplate) {
      setSelectedTemplateId(defaultTemplate.id)
      applyTemplate(defaultTemplate)
    } else if (quoteTemplates.length > 0) {
      setSelectedTemplateId(quoteTemplates[0].id)
      applyTemplate(quoteTemplates[0])
    } else {
      setSelectedTemplateId('')
      setSubject(`Quote #${quote.quote_number} — ${quote.title}`)
      setBody(`Hi ${customerName},\n\nPlease find your quote attached.\n\nThank you!`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function applyTemplate(template: EmailTemplate) {
    const renderedSubject = await renderTemplate(template.subject, templateVars)
    const renderedBody = await renderTemplate(template.body, templateVars)
    setSubject(renderedSubject)
    setBody(renderedBody)
  }

  async function handleTemplateChange(templateId: string) {
    setSelectedTemplateId(templateId)
    const template = quoteTemplates.find((t) => t.id === templateId)
    if (template) {
      await applyTemplate(template)
    }
  }

  async function handleSend() {
    if (!to.trim()) {
      setError('Recipient email is required.')
      return
    }
    setError(null)
    setIsSending(true)
    try {
      const templateName = quoteTemplates.find((t) => t.id === selectedTemplateId)?.name ?? 'Custom'
      const result = await sendQuoteEmailCustom(quote.id, orgId, orgSlug, {
        to: to.trim(),
        cc: cc.trim(),
        pdfType,
        subject,
        body,
        templateName,
      })
      if (result.error) {
        setError(result.error)
      } else {
        onSent()
      }
    } catch (err) {
      setError(`Send failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsSending(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => !isSending && onClose()}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">Send Quote Email</h2>
        <p className="mt-1 text-sm text-gray-500">
          Q-{String(quote.quote_number).padStart(4, '0')} &mdash; {quote.title}
        </p>

        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-4">
          {/* To */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              To <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
          </div>

          {/* CC */}
          <div>
            <label className="block text-sm font-medium text-gray-700">CC</label>
            <input
              type="text"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="cc1@example.com, cc2@example.com"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
            <p className="mt-1 text-xs text-gray-400">Comma-separated for multiple</p>
          </div>

          {/* PDF Type + Template row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">PDF Type</label>
              <select
                value={pdfType}
                onChange={(e) => setPdfType(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              >
                {PDF_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Template</label>
              <select
                value={selectedTemplateId}
                onChange={(e) => handleTemplateChange(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              >
                {quoteTemplates.length === 0 && (
                  <option value="">No templates available</option>
                )}
                {quoteTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
          </div>

          {/* Body */}
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">Body</label>
              <button
                type="button"
                onClick={() => setShowPreview((p) => !p)}
                className="text-xs font-medium text-qm-fuchsia hover:underline"
              >
                {showPreview ? 'Edit' : 'Preview'}
              </button>
            </div>
            {showPreview ? (
              <div
                className="mt-1 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800 whitespace-pre-wrap min-h-[160px]"
              >
                {body}
              </div>
            ) : (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSending}
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={isSending || !to.trim()}
            className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {isSending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
