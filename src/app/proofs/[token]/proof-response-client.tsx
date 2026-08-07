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

function isPdf(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.pdf')
}

function ProofCard({ item, token, onResolved }: { item: ProofItem; token: string; onResolved: (id: string, status: 'approved' | 'rejected', feedback: string | null) => void }) {
  const [feedback, setFeedback] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showRejectBox, setShowRejectBox] = useState(false)

  function submit(decision: 'approved' | 'rejected') {
    setError(null)
    startTransition(async () => {
      const res = await respondToProof(token, item.id, decision, feedback.trim() || null)
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
              disabled={isPending}
              onClick={() => submit('approved')}
              className="flex-1 rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              {isPending ? 'Saving…' : 'Approve'}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => (showRejectBox ? submit('rejected') : setShowRejectBox(true))}
              className="flex-1 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {isPending ? 'Saving…' : showRejectBox ? 'Submit Rejection' : 'Reject'}
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
            From {orgName}. {pendingCount > 0 ? `${pendingCount} of ${items.length} still need your review.` : 'All proofs have been reviewed — thank you!'}
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
