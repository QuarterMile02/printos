// Material Size field labels, driven by the material's Type
// (materials.material_type_id -> material_types.name) -- NOT buying_units.
// See known-issues/2026-08-21-material-form-redesign-part2-type-resolution.md
// for the full resolution of why Type is the real, distinct field (this
// corrects Part 1's finding A, which had misidentified buying_units as
// "materials.type").
//
// Pure, framework-agnostic -- shared by the client form (material-size-
// fields.tsx, for live labels as Type is picked) and the server-rendered
// detail view ([id]/page.tsx, for the saved value's labels).

export type DimensionGroup = 'Roll' | 'Substrate' | 'Unit'

// Only two of the org's 23 material_types are name-matched to their own
// group ("Roll Materials" and the two Substrate-named types, "Rigid
// Substrates- Sheets" / "Substrates") -- every other type (Accessories,
// Electrical, Consumables, Ink, ...) defaults to Unit. This is a
// deliberate, low-risk heuristic: it only special-cases the two type
// families the spec names explicitly, and is a single, easily-editable
// spot if Ruben wants specific other types (e.g. "Channel Letter
// Materials", "Table Cloths") bucketed differently later.
export function dimensionGroupForType(typeName: string | null | undefined): DimensionGroup {
  if (!typeName) return 'Unit'
  const t = typeName.toLowerCase()
  if (t.includes('roll')) return 'Roll'
  if (t.includes('substrate')) return 'Substrate'
  return 'Unit'
}

export type SizeFieldKey = 'width' | 'height' | 'thickness'

export type SizeFieldSpec = { key: SizeFieldKey; label: string }

// Order matches Ruben's spec exactly: "Roll: Width x Length",
// "Substrate: Height x Width x Thickness", "Unit: Height x Width x
// Depth/Thickness". Roll's "Length" and Unit's "Depth/Thickness" reuse
// the existing `height` / new `thickness` columns respectively -- same
// column, different label, same pattern as the Cost label below.
export const SIZE_FIELDS: Record<DimensionGroup, SizeFieldSpec[]> = {
  Roll: [
    { key: 'width', label: 'Width (in)' },
    { key: 'height', label: 'Length (in)' },
  ],
  Substrate: [
    { key: 'height', label: 'Height (in)' },
    { key: 'width', label: 'Width (in)' },
    { key: 'thickness', label: 'Thickness (in)' },
  ],
  Unit: [
    { key: 'height', label: 'Height (in)' },
    { key: 'width', label: 'Width (in)' },
    { key: 'thickness', label: 'Depth/Thickness (in)' },
  ],
}

// The "Sheet Cost showing on a Roll material" bug -- same underlying
// `sheet_cost` column for all three, only the label was never type-driven.
export const COST_LABEL: Record<DimensionGroup, string> = {
  Roll: 'Roll Cost',
  Substrate: 'Sheet Cost',
  Unit: 'Unit Cost',
}
