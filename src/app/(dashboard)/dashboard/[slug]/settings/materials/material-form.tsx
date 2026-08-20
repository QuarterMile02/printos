import Link from 'next/link'
import { saveMaterial } from './actions-sr'
import UnitsOfBusinessSelect from './units-of-business-select'
import MaterialSizeFields from './material-size-fields'

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
  // FK classification (preferred over legacy text fields)
  material_type_id?: string | null
  category_id?: string | null
  // Migration 047 legacy text fields (kept for display only)
  material_type?: string | null
  material_category?: string | null
  unit_width?: number | null
  unit_height?: number | null
  unit_depth?: number | null
  unit_cost?: number | null
  thickness?: number | null
  other_charge?: number | null
  per_li_unit?: boolean | null
  calculate_wastage?: boolean | null
  include_in_base_price?: boolean | null
  discount_id?: string | null
  part_number?: string | null
  sku?: string | null
  weight?: number | null
  weight_uom?: string | null
  cog_account?: string | null
  qb_item_type?: string | null
  po_description?: string | null
  info_url?: string | null
  print_image_on_pdf?: boolean | null
  show_internal?: boolean | null
  display_description_in_li?: boolean | null
  description?: string | null
}

type DiscountOption = { id: string; name: string }
type MaterialTypeOption = { id: string; name: string }
type MaterialCategoryOption = { id: string; name: string }
type ProductTypeOption = { id: string; name: string }

type Props = {
  material: MaterialData | null
  orgId: string
  orgSlug: string
  canEditInventory: boolean
  materialTypes: MaterialTypeOption[]
  materialCategories: MaterialCategoryOption[]
  discounts: DiscountOption[]
  // Units of Business -- product_types is the real entity for this (see
  // known-issues/2026-08-21-material-units-of-business.md): "a product
  // belongs to ONE unit of business" already exists as products.product_type_id;
  // a material can belong to MANY, via the new material_product_types
  // junction table below.
  productTypes: ProductTypeOption[]
  selectedProductTypeIds: string[]
}

const UNITS = ['Each', 'Sqft', 'Roll', 'Sheet', 'Feet', 'Inch', 'Yard', 'Hr', 'Linear Ft']
const FORMULAS = ['Area', 'Perimeter', 'Width', 'Height', 'Unit', 'Fixed Qty', 'Sheet']
const WEIGHT_UOMS = ['lbs', 'kg', 'oz', 'g']
const QB_ITEM_TYPES = ['Non Inventory', 'Inventory', 'Service', 'Other Charge']

function n(v: number | null | undefined, d = 0) { return Number(v ?? d) }
function inp(cls = '') { return `mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime ${cls}` }

const sectionTitleCls = 'text-xs font-bold uppercase tracking-wider text-gray-500 border-b border-gray-200 pb-1 mb-3'
const labelCls = 'block text-sm font-medium text-gray-700'

export default function MaterialForm({
  material, orgId, orgSlug, canEditInventory, materialTypes, materialCategories, discounts,
  productTypes, selectedProductTypeIds,
}: Props) {
  const m = material
  const isEdit = !!m?.id
  return (
    <form action={saveMaterial} className="space-y-6">
      {isEdit && <input type="hidden" name="id" value={m!.id} />}
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />

      {/* General -- names + the "always visible" flags. These 4 checkboxes
          used to live at the bottom of the form (Active standalone, the
          other 3 under Display & Accounting) -- moved here per Ruben's
          spec so they're seen immediately, not after scrolling past
          pricing/dimensions/charges. */}
      <div>
        <h3 className={sectionTitleCls}>General</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className={labelCls}>Name *</label><input type="text" name="name" required defaultValue={m?.name ?? ''} className={inp()} /></div>
          <div><label className={labelCls}>Display Name</label><input type="text" name="external_name" defaultValue={m?.external_name ?? ''} className={inp()} /></div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" name="print_image_on_pdf" defaultChecked={m?.print_image_on_pdf === true} className="h-4 w-4 accent-qm-lime" />
            Print Image on PDF
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" name="show_internal" defaultChecked={m?.show_internal === true} className="h-4 w-4 accent-qm-lime" />
            Show Internal
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" name="display_description_in_li" defaultChecked={m?.display_description_in_li === true} className="h-4 w-4 accent-qm-lime" />
            Display Description in Line Item
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" name="active" defaultChecked={m?.active !== false} className="h-4 w-4 rounded border-gray-300 accent-qm-lime" />
            Active
          </label>
        </div>
      </div>

      {/* Classification -- Type moved out to MaterialSizeFields below: it
          now lives right next to the fields it drives the labels of
          (Material Size), not next to Category, so the type-driven
          relabeling is visually obvious as you change it. */}
      <div>
        <h3 className={sectionTitleCls}>Classification</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Category</label>
            <select name="category_id" defaultValue={m?.category_id ?? ''} className={inp()}>
              <option value="">— None —</option>
              {materialCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        {/* Units of Business -- a material can belong to many (unlike a
            product, which belongs to exactly one via product_type_id).
            Drives the monthly QuickBooks material-cost allocation export
            (not built yet -- this is just the classification data it'll
            need). Dropdown + removable chips, not a checkbox grid --
            same product_types list, same material_product_types junction. */}
        <div className="mt-4">
          <label className={labelCls}>Units of Business</label>
          <UnitsOfBusinessSelect productTypes={productTypes} initialSelectedIds={selectedProductTypeIds} />
        </div>
      </div>

      {/* Pricing -- units/formula ABOVE cost, per Ruben: how the material
          is bought/sold and priced is decided before the actual numbers. */}
      <div>
        <h3 className={sectionTitleCls}>Pricing</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className={labelCls}>Buying Units</label>
            <select name="buying_units" defaultValue={m?.buying_units ?? ''} className={inp()}>
              <option value="">—</option>{UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Selling Units</label>
            <select name="selling_units" defaultValue={m?.selling_units ?? ''} className={inp()}>
              <option value="">—</option>{UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Formula</label>
            <select name="formula" defaultValue={m?.formula ?? 'Area'} className={inp()}>
              {FORMULAS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div />
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div><label className={labelCls}>Cost</label><input type="number" name="cost" step="0.0001" defaultValue={n(m?.cost).toFixed(4)} className={inp()} /></div>
          <div><label className={labelCls}>Price</label><input type="number" name="price" step="0.0001" defaultValue={n(m?.price).toFixed(4)} className={inp()} /></div>
          <div><label className={labelCls}>Multiplier</label><input type="number" name="multiplier" step="0.01" defaultValue={n(m?.multiplier, 2).toFixed(2)} className={inp()} /></div>
          <div><label className={labelCls}>Sell/Buy Ratio</label><input type="number" name="sell_buy_ratio" step="0.01" defaultValue={n(m?.sell_buy_ratio, 1).toFixed(2)} className={inp()} /></div>
        </div>
      </div>

      {/* Wastage & Fixed Side -- grouped together: Fixed Side decides which
          roll dimension is "fixed" for the waste-strip calculation that
          Calculate Wastage turns on, and Wastage Markup is the multiplier
          applied to that waste. */}
      <div>
        <h3 className={sectionTitleCls}>Wastage &amp; Fixed Side</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Wastage Markup (X)</label>
            <input type="number" name="wastage_markup" step="0.01" defaultValue={n(m?.wastage_markup, 1).toFixed(2)} className={inp()} />
            <p className="mt-1 text-xs text-gray-500">Multiplier, not a percent — 1 = cost only, 2 = cost doubled (100% wastage)</p>
          </div>
          <div>
            <label className={labelCls}>Fixed Side</label>
            <select name="fixed_side" defaultValue={m?.fixed_side ?? ''} className={inp()}>
              <option value="">None</option>
              <option value="Width">Width</option>
              <option value="Height">Height</option>
            </select>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" name="calculate_wastage" defaultChecked={m?.calculate_wastage === true} className="h-4 w-4 accent-qm-lime" />
              Calculate Wastage
            </label>
          </div>
        </div>
      </div>

      {/* Material Size -- Type-driven labels (Part 2 of the material form
          redesign). Roll: Width x Length. Substrate: Height x Width x
          Thickness. Unit: Height x Width x Depth/Thickness. Cost label
          (Roll Cost/Sheet Cost/Unit Cost) follows the same Type, all three
          reusing the same `sheet_cost` column -- this is the fix for
          "Sheet Cost showing on a Roll material." See
          known-issues/2026-08-21-material-form-redesign-part2-type-resolution.md. */}
      <MaterialSizeFields
        materialTypes={materialTypes}
        initialTypeId={m?.material_type_id ?? null}
        initialWidth={m?.width}
        initialHeight={m?.height}
        initialThickness={m?.thickness}
        initialSheetCost={m?.sheet_cost}
      />

      {/* Packaging / Shipping -- unit_width/unit_height are the packaging
          pair (Part 1 confirmed zero readers outside their own detail
          view, so free to repurpose), plus the new unit_depth third
          dimension. Weight/Weight UOM moved here out of Identification
          (Part 1 finding D: one column pair, 258/1788 populated, no
          readers, safe to move). */}
      <div>
        <h3 className={sectionTitleCls}>Packaging / Shipping</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div><label className={labelCls}>Height (in)</label><input type="number" name="unit_height" step="0.0001" defaultValue={m?.unit_height ?? ''} className={inp()} /></div>
          <div><label className={labelCls}>Width/Length (in)</label><input type="number" name="unit_width" step="0.0001" defaultValue={m?.unit_width ?? ''} className={inp()} /></div>
          <div><label className={labelCls}>Depth (in)</label><input type="number" name="unit_depth" step="0.0001" defaultValue={m?.unit_depth ?? ''} className={inp()} /></div>
        </div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className={labelCls}>Weight</label><input type="number" name="weight" step="0.0001" defaultValue={m?.weight ?? ''} className={inp()} /></div>
          <div>
            <label className={labelCls}>Weight UOM</label>
            <select name="weight_uom" defaultValue={m?.weight_uom ?? ''} className={inp()}>
              <option value="">—</option>
              {WEIGHT_UOMS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Charges + Pricing flags -- Calculate Wastage moved out to Wastage
          & Fixed Side above. */}
      <div>
        <h3 className={sectionTitleCls}>Charges</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div><label className={labelCls}>Labor Charge</label><input type="number" name="labor_charge" step="0.01" defaultValue={n(m?.labor_charge).toFixed(2)} className={inp()} /></div>
          <div><label className={labelCls}>Machine Charge</label><input type="number" name="machine_charge" step="0.01" defaultValue={n(m?.machine_charge).toFixed(2)} className={inp()} /></div>
          <div><label className={labelCls}>Setup Charge</label><input type="number" name="setup_charge" step="0.01" defaultValue={n(m?.setup_charge).toFixed(2)} className={inp()} /></div>
          <div><label className={labelCls}>Other Charge</label><input type="number" name="other_charge" step="0.0001" defaultValue={m?.other_charge ?? ''} className={inp()} /></div>
        </div>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Discount</label>
            <select name="discount_id" defaultValue={m?.discount_id ?? ''} className={inp()}>
              <option value="">— None —</option>
              {discounts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div><label className={labelCls}>Preferred Vendor</label><input type="text" name="preferred_vendor" defaultValue={m?.preferred_vendor ?? ''} className={inp()} /></div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" name="per_li_unit" defaultChecked={m?.per_li_unit === true} className="h-4 w-4 accent-qm-lime" />
            Per LI Unit
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" name="include_in_base_price" defaultChecked={m?.include_in_base_price === true} className="h-4 w-4 accent-qm-lime" />
            Include in Base Price
          </label>
        </div>
      </div>

      {/* Identification -- Weight/Weight UOM moved to Packaging/Shipping. */}
      <div>
        <h3 className={sectionTitleCls}>Identification</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div><label className={labelCls}>Part Number</label><input type="text" name="part_number" defaultValue={m?.part_number ?? ''} className={inp()} /></div>
          <div><label className={labelCls}>SKU</label><input type="text" name="sku" defaultValue={m?.sku ?? ''} className={inp()} /></div>
        </div>
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
              <label className={labelCls}>Current Stock</label>
              <input type="number" name="current_stock" step="0.01" min="0"
                defaultValue={n(m?.current_stock).toFixed(2)} className={inp()} />
              <p className="mt-1 text-xs text-gray-400">Units match selling units above</p>
            </div>
            <div>
              <label className={labelCls}>Min Level (reorder trigger)</label>
              <input type="number" name="min_stock_level" step="0.01" min="0"
                defaultValue={n(m?.min_stock_level).toFixed(2)} className={inp()} />
            </div>
            <div>
              <label className={labelCls}>Reorder Quantity</label>
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

      {/* Display & Accounting -- the 3 flags that used to live here moved
          up to General; this section keeps the rest. */}
      <div>
        <h3 className={sectionTitleCls}>Display &amp; Accounting</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className={labelCls}>COG Account</label><input type="text" name="cog_account" defaultValue={m?.cog_account ?? ''} className={inp()} /></div>
          <div>
            <label className={labelCls}>QB Item Type</label>
            <select name="qb_item_type" defaultValue={m?.qb_item_type ?? ''} className={inp()}>
              <option value="">—</option>
              {QB_ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3">
          <label className={labelCls}>PO Description</label>
          <textarea name="po_description" rows={2} defaultValue={m?.po_description ?? ''} className={inp()} />
        </div>
        <div className="mt-3">
          <label className={labelCls}>Info URL</label>
          <input type="url" name="info_url" defaultValue={m?.info_url ?? ''} className={inp()} />
        </div>
        <div className="mt-3">
          <label className={labelCls}>Description</label>
          <textarea name="description" rows={3} defaultValue={m?.description ?? ''} className={inp()} />
        </div>
      </div>

      <div className="flex gap-3 border-t border-gray-200 pt-4">
        <button type="submit" className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">Save Material</button>
        <Link href={`/dashboard/${orgSlug}/settings/materials`} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</Link>
      </div>
    </form>
  )
}
