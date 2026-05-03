import Link from 'next/link'
import { saveMaterial } from './actions-sr'

type MaterialData = {
  id?: string
  name: string; external_name: string | null
  cost: number | null; price: number | null; multiplier: number | null
  buying_units: string | null; selling_units: string | null
  formula: string | null; fixed_side: string | null
  width: number | null; height: number | null; sheet_cost: number | null
  wastage_markup: number | null; sell_buy_ratio: number | null
  preferred_vendor: string | null
  labor_charge: number | null; machine_charge: number | null; setup_charge: number | null
  active: boolean | null
  // inventory
  current_stock?: number | null
  min_stock_level?: number | null
  reorder_quantity?: number | null
  last_inventory_count_at?: string | null
}

type Props = {
  material: MaterialData | null
  orgId: string
  orgSlug: string
  canEditInventory: boolean
}

const UNITS = ['Each', 'Sqft', 'Roll', 'Sheet', 'Feet', 'Inch', 'Yard', 'Hr', 'Linear Ft']
const FORMULAS = ['Area', 'Perimeter', 'Width', 'Height', 'Unit', 'Fixed Qty', 'Sheet']

function n(v: number | null | undefined, d = 0) { return Number(v ?? d) }
function inp(cls = '') { return `mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime ${cls}` }

export default function MaterialForm({ material, orgId, orgSlug, canEditInventory }: Props) {
  const m = material
  const isEdit = !!m?.id
  return (
    <form action={saveMaterial} className="space-y-6">
      {isEdit && <input type="hidden" name="id" value={m!.id} />}
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />

      {/* Row 1: Names */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label className="block text-sm font-medium text-gray-700">Name *</label><input type="text" name="name" required defaultValue={m?.name ?? ''} className={inp()} /></div>
        <div><label className="block text-sm font-medium text-gray-700">Display Name</label><input type="text" name="external_name" defaultValue={m?.external_name ?? ''} className={inp()} /></div>
      </div>

      {/* Row 2: Cost / Price / Multiplier */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div><label className="block text-sm font-medium text-gray-700">Cost</label><input type="number" name="cost" step="0.0001" defaultValue={n(m?.cost).toFixed(4)} className={inp()} /></div>
        <div><label className="block text-sm font-medium text-gray-700">Price</label><input type="number" name="price" step="0.0001" defaultValue={n(m?.price).toFixed(4)} className={inp()} /></div>
        <div><label className="block text-sm font-medium text-gray-700">Multiplier</label><input type="number" name="multiplier" step="0.01" defaultValue={n(m?.multiplier, 2).toFixed(2)} className={inp()} /></div>
        <div><label className="block text-sm font-medium text-gray-700">Sell/Buy Ratio</label><input type="number" name="sell_buy_ratio" step="0.01" defaultValue={n(m?.sell_buy_ratio, 1).toFixed(2)} className={inp()} /></div>
      </div>

      {/* Row 3: Units / Formula */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div><label className="block text-sm font-medium text-gray-700">Buying Units</label>
          <select name="buying_units" defaultValue={m?.buying_units ?? ''} className={inp()}>
            <option value="">—</option>{UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div><label className="block text-sm font-medium text-gray-700">Selling Units</label>
          <select name="selling_units" defaultValue={m?.selling_units ?? ''} className={inp()}>
            <option value="">—</option>{UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div><label className="block text-sm font-medium text-gray-700">Formula</label>
          <select name="formula" defaultValue={m?.formula ?? 'Area'} className={inp()}>
            {FORMULAS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div><label className="block text-sm font-medium text-gray-700">Fixed Side</label>
          <select name="fixed_side" defaultValue={m?.fixed_side ?? ''} className={inp()}>
            <option value="">—</option><option value="Width">Width</option><option value="Height">Height</option>
          </select>
        </div>
      </div>

      {/* Row 4: Dimensions / Sheet */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div><label className="block text-sm font-medium text-gray-700">Width</label><input type="number" name="width" step="0.01" defaultValue={m?.width ?? ''} className={inp()} /></div>
        <div><label className="block text-sm font-medium text-gray-700">Height</label><input type="number" name="height" step="0.01" defaultValue={m?.height ?? ''} className={inp()} /></div>
        <div><label className="block text-sm font-medium text-gray-700">Sheet Cost</label><input type="number" name="sheet_cost" step="0.01" defaultValue={m?.sheet_cost ?? ''} className={inp()} /></div>
        <div><label className="block text-sm font-medium text-gray-700">Wastage Markup %</label><input type="number" name="wastage_markup" step="0.01" defaultValue={n(m?.wastage_markup).toFixed(2)} className={inp()} /></div>
      </div>

      {/* Row 5: Charges */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div><label className="block text-sm font-medium text-gray-700">Labor Charge</label><input type="number" name="labor_charge" step="0.01" defaultValue={n(m?.labor_charge).toFixed(2)} className={inp()} /></div>
        <div><label className="block text-sm font-medium text-gray-700">Machine Charge</label><input type="number" name="machine_charge" step="0.01" defaultValue={n(m?.machine_charge).toFixed(2)} className={inp()} /></div>
        <div><label className="block text-sm font-medium text-gray-700">Setup Charge</label><input type="number" name="setup_charge" step="0.01" defaultValue={n(m?.setup_charge).toFixed(2)} className={inp()} /></div>
        <div><label className="block text-sm font-medium text-gray-700">Preferred Vendor</label><input type="text" name="preferred_vendor" defaultValue={m?.preferred_vendor ?? ''} className={inp()} /></div>
      </div>

      {/* Inventory — only shown to roles with materials.edit_inventory */}
      {canEditInventory && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-800 mb-3">
            Inventory Tracking
            <span className="ml-2 text-xs font-normal text-amber-600">(owner · accounting · production only)</span>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Current Stock</label>
              <input type="number" name="current_stock" step="0.01" min="0"
                defaultValue={n(m?.current_stock).toFixed(2)} className={inp()} />
              <p className="mt-1 text-xs text-gray-400">Units match selling units above</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Min Level (reorder trigger)</label>
              <input type="number" name="min_stock_level" step="0.01" min="0"
                defaultValue={n(m?.min_stock_level).toFixed(2)} className={inp()} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Reorder Quantity</label>
              <input type="number" name="reorder_quantity" step="0.01" min="0"
                defaultValue={n(m?.reorder_quantity).toFixed(2)} className={inp()} />
              <p className="mt-1 text-xs text-gray-400">Suggested PO qty (future automation)</p>
            </div>
          </div>
          {m?.last_inventory_count_at && (
            <p className="mt-3 text-xs text-amber-700">
              Last count: {new Date(m.last_inventory_count_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          )}
        </div>
      )}

      {/* Active */}
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" name="active" defaultChecked={m?.active !== false} className="h-4 w-4 rounded border-gray-300 accent-qm-lime" />
        Active
      </label>

      <div className="flex gap-3">
        <button type="submit" className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">Save Material</button>
        <Link href={`/dashboard/${orgSlug}/settings/materials`} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</Link>
      </div>
    </form>
  )
}
