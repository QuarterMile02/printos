'use client'

import { useState, useTransition } from 'react'
import { toggleWorkflowStep } from '../actions'

export type WorkflowStep = {
  id: string | null      // product_default_items.id
  name: string
  sortOrder: number
}

export type WorkflowProgress = {
  stepName: string
  checkedByName: string | null
  checkedAt: string | null
}

type Props = {
  jobId: string
  orgId: string
  steps: WorkflowStep[]
  progress: WorkflowProgress[]
}

function fmtTs(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function WorkflowChecklist({ jobId, orgId, steps, progress }: Props) {
  // Map stepName → progress entry for O(1) lookup
  const [progressMap, setProgressMap] = useState<Map<string, WorkflowProgress>>(
    () => new Map(progress.map((p) => [p.stepName, p])),
  )
  const [pending, startTransition] = useTransition()
  const [pendingStep, setPendingStep] = useState<string | null>(null)

  function handleToggle(step: WorkflowStep) {
    const isChecked = !progressMap.has(step.name)
    setPendingStep(step.name)

    // Optimistic update
    setProgressMap((prev) => {
      const next = new Map(prev)
      if (isChecked) {
        next.set(step.name, { stepName: step.name, checkedByName: 'You', checkedAt: new Date().toISOString() })
      } else {
        next.delete(step.name)
      }
      return next
    })

    startTransition(async () => {
      const result = await toggleWorkflowStep(jobId, orgId, step.id, step.name, step.sortOrder, isChecked)
      if (result.error) {
        // Revert on error
        setProgressMap((prev) => {
          const next = new Map(prev)
          if (isChecked) next.delete(step.name)
          else next.set(step.name, progress.find((p) => p.stepName === step.name) ?? { stepName: step.name, checkedByName: null, checkedAt: null })
          return next
        })
      }
      setPendingStep(null)
    })
  }

  const done = steps.filter((s) => progressMap.has(s.name)).length

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Workflow Steps</h2>
        <span className="text-xs text-gray-400">{done} / {steps.length} complete</span>
      </div>

      {/* Progress bar */}
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-qm-lime transition-all"
          style={{ width: steps.length ? `${(done / steps.length) * 100}%` : '0%' }}
        />
      </div>

      <div className="space-y-2">
        {steps.map((step) => {
          const p = progressMap.get(step.name)
          const isChecked = !!p
          const isPendingThis = pendingStep === step.name && pending

          return (
            <label
              key={step.name}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition
                ${isChecked ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white hover:bg-gray-50'}
                ${isPendingThis ? 'opacity-60' : ''}`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                disabled={isPendingThis}
                onChange={() => handleToggle(step)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-qm-lime"
              />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${isChecked ? 'text-green-800 line-through decoration-green-400' : 'text-gray-900'}`}>
                  {step.name}
                </p>
                {p?.checkedAt && (
                  <p className="mt-0.5 text-[10px] text-gray-400">
                    {p.checkedByName ? `${p.checkedByName} · ` : ''}{fmtTs(p.checkedAt)}
                  </p>
                )}
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}
