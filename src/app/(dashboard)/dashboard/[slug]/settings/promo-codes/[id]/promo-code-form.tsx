'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { savePromoCode, deletePromoCode, regeneratePromoCode } from '../actions-sr'
import { PROMO_CODE_TYPES } from '../constants'

export type PromoCodeFormData = {
  id: string | null
  name: string
  code: string
  discount_type: string
  value: number
  minimum_requirement: number | null
  limit_of_using: number
  valid_from: string | null
  valid_to: string | null
  is_active: boolean
}

type Props = {
  orgId: string
  orgSlug: string
  isNew: boolean
  initialData: PromoCodeFormData
  canDelete: boolean
  deleteBlockedReason: string
}

const ic = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
const lbl = 'block text-xs font-medium text-gray-500'

export default function PromoCodeForm({ orgId, orgSlug, isNew, initialData, canDelete, deleteBlockedReason }: Props) {
  const [code, setCode] = useState(initialData.code)
  const [regenPending, startRegen] = useTransition()

  function handleRegenerate() {
    startRegen(async () => {
      const next = await regeneratePromoCode()
      setCode(next)
    })
  }

  return (
    <form action={savePromoCode} className="space-y-4">
      {initialData.id && <input type="hidden" name="id" value={initialData.id} />}
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />

      <div>
        <label className={lbl}>Name *</label>
        <input type="text" name="name" required defaultValue={initialData.name} placeholder="e.g. Summer Sale" className={ic} />
      </div>

      <div>
        <label className={lbl}>Code</label>
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            name="code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={regenPending}
            className="shrink-0 rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {regenPending ? 'Generating…' : 'Regenerate'}
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-400">Auto-generated — edit if you want a custom code.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Type</label>
          <select name="discount_type" defaultValue={initialData.discount_type} className={ic}>
            {PROMO_CODE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Value (%)</label>
          <input type="number" name="value" step="0.01" min="0" defaultValue={initialData.value} className={ic} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Minimum Requirement ($)</label>
          <input
            type="number"
            name="minimum_requirement"
            step="0.01"
            min="0"
            defaultValue={initialData.minimum_requirement ?? ''}
            placeholder="No minimum"
            className={ic}
          />
        </div>
        <div>
          <label className={lbl}>Limit Of Using</label>
          <input
            type="number"
            name="limit_of_using"
            step="1"
            min="0"
            defaultValue={initialData.limit_of_using}
            className={ic}
          />
          <p className="mt-1 text-xs text-gray-400">0 = unlimited</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Valid From</label>
          <input type="date" name="valid_from" defaultValue={initialData.valid_from ?? ''} className={ic} />
        </div>
        <div>
          <label className={lbl}>Valid To</label>
          <input type="date" name="valid_to" defaultValue={initialData.valid_to ?? ''} className={ic} />
          <p className="mt-1 text-xs text-gray-400">Leave either blank for open-ended</p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" name="is_active" defaultChecked={initialData.is_active} className="h-4 w-4 rounded border-gray-300 accent-qm-lime" />
        Active
      </label>

      <div className="flex gap-3 pt-2">
        <button type="submit" className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">Save</button>
        <Link href={`/dashboard/${orgSlug}/settings/promo-codes`} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</Link>
        {!isNew && (
          canDelete ? (
            <form action={deletePromoCode} className="inline ml-auto">
              <input type="hidden" name="id" value={initialData.id!} />
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <button type="submit" className="rounded-md border border-red-300 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50">Delete</button>
            </form>
          ) : (
            <span title={deleteBlockedReason} className="ml-auto rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-400 cursor-not-allowed">Delete</span>
          )
        )}
      </div>
    </form>
  )
}
