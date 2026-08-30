'use client'

import { useState } from 'react'
import { dimensionGroupForType, SIZE_FIELDS, COST_LABEL } from '@/lib/material-size-labels'

type MaterialTypeOption = { id: string; name: string }

type Props = {
  materialTypes: MaterialTypeOption[]
  initialTypeId: string | null
  initialWidth: number | null | undefined
  initialHeight: number | null | undefined
  initialThickness: number | null | undefined
  initialSheetCost: number | null | undefined
}

function inp(cls = '') { return `mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime ${cls}` }
const labelCls = 'block text-sm font-medium text-gray-700'
const sectionTitleCls = 'text-xs font-bold uppercase tracking-wider text-gray-500 border-b border-gray-200 pb-1 mb-3'

// Type select + the three size fields, together in one client component --
// Type has to live here (not in the plain Classification section above)
// so picking a different Type instantly relabels Width/Length/Height/
// Thickness/Cost below it, without a save+reload round trip. This is the
// fix for "Sheet Cost showing on a Roll material": the label is now
// type-driven, not fixed, and updates live as Type changes.
export default function MaterialSizeFields({
  materialTypes, initialTypeId,
  initialWidth, initialHeight, initialThickness, initialSheetCost,
}: Props) {
  const [typeId, setTypeId] = useState(initialTypeId ?? '')
  const typeName = materialTypes.find(t => t.id === typeId)?.name ?? null
  const group = dimensionGroupForType(typeName)
  const fields = SIZE_FIELDS[group]
  const costLabel = COST_LABEL[group]

  const initialByKey = { width: initialWidth, height: initialHeight, thickness: initialThickness }

  return (
    <>
      <div>
        <h3 className={sectionTitleCls}>Classification</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Type</label>
            <select
              name="material_type_id"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              className={inp()}
            >
              <option value="">— None —</option>
              {materialTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div>
        <h3 className={sectionTitleCls}>Material Size</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {fields.map(f => (
            <div key={f.key}>
              <label className={labelCls}>{f.label}</label>
              <input
                type="number" name={f.key} step="0.0001"
                defaultValue={initialByKey[f.key] ?? ''}
                className={inp()}
              />
            </div>
          ))}
          <div>
            <label className={labelCls}>{costLabel}</label>
            <input type="number" name="sheet_cost" step="0.01" defaultValue={initialSheetCost ?? ''} className={inp()} />
          </div>
        </div>
      </div>
    </>
  )
}
