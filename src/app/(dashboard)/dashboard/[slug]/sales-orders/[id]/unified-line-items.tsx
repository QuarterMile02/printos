'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { formatCents } from '../format'
import ProofUploadRow, { UploadProofButton } from './proof-upload-row'
import { computeProofStatus, formatElapsedDays, PROOF_STATUS_LABELS, PROOF_STATUS_STYLES, type ProofStatusKey } from '@/lib/proofs/proof-status'

const JOB_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  in_progress: 'In Progress',
  proof_review: 'Proof Review',
  ready_for_pickup: 'Ready for Pickup',
  completed: 'Completed',
  on_hold: 'On Hold',
  pending_approval: 'Pending Approval',
}

const JOB_STATUS_STYLES: Record<string, string> = {
  new: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-50 text-blue-700',
  proof_review: 'bg-amber-50 text-amber-700',
  ready_for_pickup: 'bg-teal-50 text-teal-700',
  completed: 'bg-green-50 text-green-700',
  on_hold: 'bg-gray-200 text-gray-700',
  pending_approval: 'bg-amber-50 text-amber-700',
}

function fmtSentAt(iso: string): string {
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const diffHrs = diffMs / 3_600_000
  if (diffHrs < 1) return 'just now'
  if (diffHrs < 24) return `${Math.round(diffHrs)}h ago`
  const diffDays = Math.round(diffHrs / 24)
  if (diffDays < 14) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtDueDate(iso: string | null) {
  if (!iso) return null
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export type LineItem = {
  id: string
  description: string
  quantity: number
  unit_price: number
  total_price: number
  discount_percent: number | null
  taxable: boolean | null
  sort_order: number | null
}

export type JobSummary = { id: string; job_number: number; title: string; status: string; due_date: string | null }
export type ReadyProof     = { id: string; quoteLineItemId: string; fileName: string; versionNumber: number; lastSentAt: string | null }
export type RespondedProof = { id: string; quoteLineItemId: string; fileName: string; versionNumber: number; status: 'approved' | 'rejected'; customerFeedback: string | null; customerMarkupFileUrl: string | null; customerRespondedAt: string | null }

type Props = {
  soId: string
  orgId: string
  orgSlug: string
  lineItems: LineItem[]
  canSeePricing: boolean
  jobByLineItemId: Record<string, JobSummary>
  jobPanelsByJobId: Record<string, ReactNode>
  readyProofs: ReadyProof[]
  respondedProofs: RespondedProof[]
  selectedProofIds: Set<string>
  toggleProof: (id: string) => void
  sendingProofs: boolean
  readyCount: number
  onSendProofs: () => void
  onProofUploaded: (message: string) => void
}

// Item: SO detail page restructuring — replaces the old three separate
// sections (Line Items table, Proofs section, Jobs table) with one row
// per line item. Each row always shows description/qty (+ pricing behind
// canSeePricing, unchanged gating). Expanding a row reveals the job/work-
// order detail (JobDetailPanel, pre-rendered server-side and handed down
// via jobPanelsByJobId) plus the proof upload/ready/responded controls,
// relocated as-is from the old Proofs section — no logic changes there,
// just moved. The ready-proof checkbox stays visible in the COLLAPSED row
// (not behind the expand) so the bulk "Send Proofs" flow above this list
// is unaffected by the restructuring, per instruction.
export default function UnifiedLineItems({
  soId, orgId, orgSlug, lineItems, canSeePricing, jobByLineItemId, jobPanelsByJobId,
  readyProofs, respondedProofs, selectedProofIds, toggleProof, sendingProofs, readyCount,
  onSendProofs, onProofUploaded,
}: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Per-line-item proof status (Not Started / Ready to Send / In Review /
  // Approved / Redesign), computed once and reused for both the row-level
  // pills and the header's aggregate counts, so the two can't disagree.
  // Deliberately excludes line items with no job at all ("No job yet") --
  // that's a distinct, structural gap (nothing to even track a proof
  // status against), not a proof-workflow state, so it's kept out of both
  // the 5-state count and the row pill; those rows keep their existing
  // plain "No job yet" text.
  const statusByLineItemId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeProofStatus>>()
    for (const li of lineItems) {
      if (!jobByLineItemId[li.id]) continue
      const ready = readyProofs.find((p) => p.quoteLineItemId === li.id)
      const responded = respondedProofs.find((p) => p.quoteLineItemId === li.id)
      map.set(li.id, computeProofStatus({
        proofStatus: responded ? responded.status : (ready ? 'pending' : null),
        sentAt: ready ? ready.lastSentAt : null,
        respondedAt: responded ? responded.customerRespondedAt : null,
      }))
    }
    return map
  }, [lineItems, jobByLineItemId, readyProofs, respondedProofs])

  const statusCounts = useMemo(() => {
    const counts: Record<ProofStatusKey, number> = { not_started: 0, ready_to_send: 0, in_review: 0, approved: 0, redesign: 0 }
    for (const s of statusByLineItemId.values()) counts[s.key]++
    return counts
  }, [statusByLineItemId])

  if (lineItems.length === 0) return null

  return (
    <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2 flex-wrap">
          Line Items
          {(Object.keys(PROOF_STATUS_LABELS) as ProofStatusKey[]).map((key) => {
            const count = statusCounts[key]
            if (count === 0) return null
            return (
              <span key={key} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold normal-case tracking-normal ${PROOF_STATUS_STYLES[key]}`}>
                {count} {PROOF_STATUS_LABELS[key]}
              </span>
            )
          })}
        </h2>
        {/* Item: Send Proofs button fix — enabled whenever a ready proof
            exists, regardless of checkbox state (was previously disabled
            until something was checked, which was wrong: the original
            spec is "select checkboxes... and click to send all selected
            or just send proofs and all proofs that are uploaded will be
            sent"). Nothing checked -> sends every ready proof; checking
            specific boxes narrows the send to just those (see
            handleSendProofs in so-detail-client.tsx). */}
        {readyCount > 0 && (
          <button
            type="button"
            onClick={onSendProofs}
            disabled={sendingProofs}
            className="rounded-md bg-qm-lime px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {sendingProofs ? 'Sending…' : `Send Proofs (${selectedProofIds.size || readyCount})`}
          </button>
        )}
      </div>

      <div className="hidden md:flex items-center gap-3 border-b border-gray-100 bg-gray-50 px-6 py-2 text-xs font-medium uppercase tracking-wide text-gray-500">
        <span className="w-4 shrink-0" />
        <span className="flex-1">Description</span>
        <span className="w-16 shrink-0 text-right">Qty</span>
        {canSeePricing && (
          <>
            <span className="w-24 shrink-0 text-right">Unit Price</span>
            <span className="w-16 shrink-0 text-right">Disc%</span>
            <span className="w-24 shrink-0 text-right">Total</span>
          </>
        )}
        <span className="w-56 shrink-0 text-right">Status</span>
        <span className="w-28 shrink-0 text-right">Due Date</span>
      </div>

      <div className="divide-y divide-gray-100">
        {lineItems.map((li, i) => {
          const job = jobByLineItemId[li.id]
          const panel = job ? jobPanelsByJobId[job.id] : null
          const ready = readyProofs.find((p) => p.quoteLineItemId === li.id)
          const responded = respondedProofs.find((p) => p.quoteLineItemId === li.id)
          const expanded = expandedIds.has(li.id)
          const canExpand = Boolean(job)

          return (
            <div key={li.id} className={i % 2 === 1 ? 'bg-gray-50/50' : ''}>
              <div
                className={`flex items-center gap-3 px-6 py-3 ${canExpand ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                onClick={canExpand ? () => toggleExpanded(li.id) : undefined}
              >
                {canExpand ? (
                  <svg
                    className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                ) : (
                  <span className="w-4 shrink-0" />
                )}

                {ready && (
                  <input
                    type="checkbox"
                    checked={selectedProofIds.has(ready.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleProof(ready.id)}
                    className="h-4 w-4 shrink-0 rounded border-gray-300 text-qm-lime focus:ring-qm-lime"
                  />
                )}

                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 truncate">{li.description}</p>
                  {ready && (
                    <p className="text-xs text-gray-500 truncate">
                      {ready.fileName} · v{ready.versionNumber}
                      {ready.lastSentAt && <span className="ml-1">· Sent {fmtSentAt(ready.lastSentAt)} — resend?</span>}
                    </p>
                  )}
                </div>

                <span className="w-16 shrink-0 text-right text-sm tabular-nums text-gray-900">{li.quantity}</span>

                {canSeePricing && (
                  <>
                    <span className="w-24 shrink-0 text-right text-sm tabular-nums text-gray-900">${formatCents(li.unit_price)}</span>
                    <span className="w-16 shrink-0 text-right text-sm tabular-nums text-gray-500">{li.discount_percent ? `${li.discount_percent}%` : '—'}</span>
                    <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900">${formatCents(li.total_price)}</span>
                  </>
                )}

                <div className="w-56 shrink-0 flex flex-wrap items-center justify-end gap-1.5">
                  {job ? (
                    <>
                      {(() => {
                        const proofStatus = statusByLineItemId.get(li.id)
                        if (!proofStatus) return null
                        const days = formatElapsedDays(proofStatus.elapsedDays)
                        return (
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${PROOF_STATUS_STYLES[proofStatus.key]}`}>
                            {proofStatus.label}{days ? ` · ${days}` : ''}
                          </span>
                        )
                      })()}
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${JOB_STATUS_STYLES[job.status] ?? 'bg-gray-100 text-gray-700'}`}>
                        {JOB_STATUS_LABELS[job.status] ?? job.status}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-gray-300">No job yet</span>
                  )}
                </div>

                <span className="w-28 shrink-0 text-right text-xs text-gray-400">
                  {job?.due_date ? fmtDueDate(job.due_date) : ''}
                </span>
              </div>

              {expanded && job && (
                <div className="border-t border-gray-100 bg-gray-50 px-6 py-5">
                  {panel}

                  <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">Proof</h3>
                    {responded ? (
                      <div>
                        {responded.customerFeedback && (
                          <p className="mb-2 text-sm italic text-gray-600">&ldquo;{responded.customerFeedback}&rdquo;</p>
                        )}
                        {responded.customerMarkupFileUrl && (
                          <a
                            href={responded.customerMarkupFileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mb-3 inline-block text-xs font-semibold text-qm-lime underline"
                          >
                            View customer&apos;s marked-up file
                          </a>
                        )}
                        <div>
                          <UploadProofButton
                            soId={soId}
                            orgId={orgId}
                            orgSlug={orgSlug}
                            lineItemId={li.id}
                            buttonLabel="Upload New Version"
                            onUploaded={() => onProofUploaded('New version uploaded.')}
                          />
                        </div>
                      </div>
                    ) : ready ? (
                      <p className="text-sm text-gray-500">
                        {ready.fileName} · v{ready.versionNumber} — checked above and ready to send.
                      </p>
                    ) : (
                      <ProofUploadRow
                        soId={soId}
                        orgId={orgId}
                        orgSlug={orgSlug}
                        lineItemId={li.id}
                        lineItemLabel={li.description}
                        onUploaded={() => onProofUploaded('Proof uploaded.')}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
