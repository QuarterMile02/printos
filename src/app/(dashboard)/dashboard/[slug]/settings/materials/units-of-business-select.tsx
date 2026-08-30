'use client'

import { useState } from 'react'

type ProductTypeOption = { id: string; name: string }

type Props = {
  productTypes: ProductTypeOption[]
  initialSelectedIds: string[]
}

// Multi-select dropdown + removable chips, replacing the checkbox grid --
// same 13 product_types (the real "unit of business" entity, see
// known-issues/2026-08-21-material-units-of-business.md), same
// material_product_types junction. Renders one hidden `product_type_ids`
// input per selected chip, so the server action's existing
// `formData.getAll('product_type_ids')` read keeps working unchanged --
// this is purely a client-side presentation swap, not a new field name.
export default function UnitsOfBusinessSelect({ productTypes, initialSelectedIds }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds)

  const selected = productTypes.filter(pt => selectedIds.includes(pt.id))
  const available = productTypes.filter(pt => !selectedIds.includes(pt.id))

  function addId(id: string) {
    if (!id || selectedIds.includes(id)) return
    setSelectedIds(prev => [...prev, id])
  }
  function removeId(id: string) {
    setSelectedIds(prev => prev.filter(x => x !== id))
  }

  return (
    <div>
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {selected.map(pt => (
            <span key={pt.id} className="inline-flex items-center gap-1.5 rounded-full bg-qm-lime/10 px-3 py-1 text-xs font-medium text-qm-lime-dark">
              {pt.name}
              <button
                type="button"
                onClick={() => removeId(pt.id)}
                aria-label={`Remove ${pt.name}`}
                className="text-qm-lime-dark/70 hover:text-qm-lime-dark"
              >
                ×
              </button>
              <input type="hidden" name="product_type_ids" value={pt.id} />
            </span>
          ))}
        </div>
      )}

      {available.length > 0 ? (
        <select
          value=""
          onChange={(e) => addId(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          <option value="">+ Add unit of business…</option>
          {available.map(pt => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
        </select>
      ) : productTypes.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No units of business configured for this org.</p>
      ) : (
        <p className="text-xs text-gray-400">All units of business selected.</p>
      )}
    </div>
  )
}
