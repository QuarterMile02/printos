'use client'

import { useState, useTransition } from 'react'
import { respondToProof } from './actions'

export type ProofItem = {
  id: string
  label: string
  fileUrl: string
  fileName: string
  versionNumber: number
  status: 'pending' | 'approved' | 'rejected'
  customerFeedback: string | null
  customerRespondedAt: string | null
}

type Props = {
  token: string
  orgName: string
  soLabel: string | null
  initialItems: ProofItem[]
}

const STATUS_STYLES: Record<ProofItem['status'], string> = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-green-50 text-green-700',
  rejected: 'bg-red-50 text-red-700',
}

// Item 3 — required review checkboxes, exact wording per Ruben's real
// ShopVOX documentation (not placeholder text). All 6 are required to
// enable Approve; this is per-proof, not page-level, since approval is
// per proof_version. The server independently re-checks that all 6 were
// acknowledged (respond-to-proof-core.ts) — this list existing here is
// what the customer sees and what computes the client-side disabled
// state, not the actual security gate.
const REQUIRED_CHECKS = [
  { key: 'colors', label: 'Colors' },
  { key: 'text', label: 'Text' },
  { key: 'spelling', label: 'Spelling' },
  { key: 'logos', label: 'Logos' },
  { key: 'finishes', label: 'Finishes: Round / Square Corners, Cut Shape' },
  {
    key: 'colorVariance',
    label: "Due to inconsistencies in monitors and production variations, we cannot guarantee that the color you see on your screen accurately portrays the true color of the product. The finished product's color may vary from the preview.",
  },
] as const

type CheckKey = typeof REQUIRED_CHECKS[number]['key']

function isPdf(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.pdf')
}

function ProofCard({ item, token, onResolved }: { item: ProofItem; token: string; onResolved: (id: string, status: 'approved' | 'rejected', feedback: string | null) => void }) {
  const [feedback, setFeedback] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showRejectBox, setShowRejectBox] = useState(false)
  const [checks, setChecks] = useState<Record<CheckKey, boolean>>({
    colors: false, text: false, spelling: false, logos: false, finishes: false, colorVariance: false,
  })
  const allChecked = REQUIRED_CHECKS.every((c) => checks[c.key])

  function toggleCheck(key: CheckKey) {
    setChecks((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function submit(decision: 'approved' | 'rejected') {
    setError(null)
    startTransition(async () => {
      const res = await respondToProof(token, item.id, decision, feedback.trim() || null, decision === 'approved' && allChecked)
      if (!res.ok) {
        setError(res.error)
      } else {
        onResolved(item.id, decision, feedback.trim() || null)
      }
    })
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">{item.label}</p>
          <p className="text-xs text-gray-500">{item.fileName} · v{item.versionNumber}</p>
        </div>
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLES[item.status]}`}>
          {item.status}
        </span>
      </div>

      <div className="bg-gray-50 p-4">
        {isPdf(item.fileName) ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <a href={item.fileUrl} target="_blank" rel="noopener noreferrer" className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
              Open PDF
            </a>
          </div>
        ) : (
          <a href={item.fileUrl} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.fileUrl} alt={item.label} className="mx-auto max-h-[480px] w-auto rounded-md border border-gray-200 object-contain" />
          </a>
        )}
      </div>

      {item.status === 'pending' ? (
        <div className="p-4">
          <p className="mb-2 text-sm font-semibold text-gray-900">
            If everything looks right - check the boxes below to indicate your approval:
          </p>
          <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            Please carefully review and approve your design proof. We&apos;re not responsible for errors caused by
            misspelled words or typos. Any additional costs to fix errors are your responsibility and won&apos;t be
            eligible for a free reprint. Please confirm the following before approving design:
          </p>
          <div className="mb-3 space-y-2">
            {REQUIRED_CHECKS.map((c) => (
              <label key={c.key} className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checks[c.key]}
                  onChange={() => toggleCheck(c.key)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-qm-lime focus:ring-qm-lime"
                />
                <span>{c.label}</span>
              </label>
            ))}
          </div>

          {showRejectBox && (
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What needs to change? (optional, but helpful)"
              rows={3}
              className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
          )}
          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending || !allChecked}
              onClick={() => submit('approved')}
              title={!allChecked ? 'Check all boxes above to enable Approve' : undefined}
              className="flex-1 rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100"
            >
              {isPending ? 'Saving…' : 'Approve'}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => (showRejectBox ? submit('rejected') : setShowRejectBox(true))}
              className="flex-1 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {isPending ? 'Saving…' : showRejectBox ? 'Submit Request' : 'Request Changes'}
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 text-sm text-gray-600">
          {item.customerFeedback && <p className="italic">“{item.customerFeedback}”</p>}
          {item.customerRespondedAt && (
            <p className="mt-1 text-xs text-gray-400">
              Responded {new Date(item.customerRespondedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function ProofResponseClient({ token, orgName, soLabel, initialItems }: Props) {
  const [items, setItems] = useState(initialItems)

  function handleResolved(id: string, status: 'approved' | 'rejected', feedback: string | null) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status, customerFeedback: feedback, customerRespondedAt: new Date().toISOString() } : it)))
  }

  const pendingCount = items.filter((i) => i.status === 'pending').length

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-gray-900">Proof Review{soLabel ? ` — ${soLabel}` : ''}</h1>
          <p className="mt-1 text-sm text-gray-500">
            From {orgName} — {pendingCount > 0 ? `${pendingCount} of ${items.length} still need your review.` : 'all proofs have been reviewed — thank you!'}
          </p>
        </div>
        <div className="space-y-4">
          {items.map((item) => (
            <ProofCard key={item.id} item={item} token={token} onResolved={handleResolved} />
          ))}
        </div>
      </div>
    </div>
  )
}
