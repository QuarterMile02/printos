import type { createServiceClient } from '@/lib/supabase/server'
import { dbAllOrThrow } from '@/lib/db'

type ServiceClient = ReturnType<typeof createServiceClient>

export type ZeroCostLine = {
  lineItemId: string
  description: string
  materialNames: string[]
}

// The gap PR #40 didn't close: calculateProductPrice falls back to
// materials.cost when no variant can be confidently picked, and nothing
// checks whether THAT is 0. create_material_family_from_variants
// (migration 188) starts every new family at cost = 0, so this is now a
// normal, reachable state.
//
// This is read-only and never recomputes or mutates a line's stored
// price -- it only explains an ALREADY-$0 stored unit_price against the
// product's CURRENT recipe/material data. That also means the flag
// tracks present-day risk, not history: a line that priced fine when
// added but whose material has since been zeroed out (e.g. repointed to
// a fresh $0 family) is caught too, which is exactly what item 4 (the
// send/PDF block) needs to check right before a document goes out.
//
// A line with no product_id (a manual/custom line) is never flagged --
// there's no recipe to explain a $0 price with, and a legitimately-free
// custom line (e.g. "Free shipping") shouldn't be treated as a bug.
export async function findZeroCostMaterialLines(
  service: ServiceClient,
  quoteId: string,
): Promise<ZeroCostLine[]> {
  type LineRow = { id: string; description: string | null; product_id: string | null; unit_price: number | null }
  const lines = await dbAllOrThrow<LineRow>((from, to) =>
    service
      .from('quote_line_items')
      .select('id, description, product_id, unit_price')
      .eq('quote_id', quoteId)
      .range(from, to)
  )

  const zeroLines = lines.filter((l) => l.product_id && Number(l.unit_price ?? 0) === 0)
  if (zeroLines.length === 0) return []

  const productIds = [...new Set(zeroLines.map((l) => l.product_id as string))]

  type RecipeRow = { product_id: string; material_id: string | null }
  const recipeRows = await dbAllOrThrow<RecipeRow>((from, to) =>
    service
      .from('product_default_items')
      .select('product_id, material_id')
      .eq('item_type', 'Material')
      .in('product_id', productIds)
      .range(from, to)
  )

  const materialIds = [...new Set(recipeRows.map((r) => r.material_id).filter((id): id is string => !!id))]
  if (materialIds.length === 0) return []

  type MaterialRow = { id: string; name: string; cost: number | null }
  const materials = await dbAllOrThrow<MaterialRow>((from, to) =>
    service
      .from('materials')
      .select('id, name, cost')
      .in('id', materialIds)
      .range(from, to)
  )

  const zeroCostNameById = new Map(
    materials.filter((m) => Number(m.cost ?? 0) === 0).map((m) => [m.id, m.name])
  )
  if (zeroCostNameById.size === 0) return []

  const zeroNamesByProduct = new Map<string, string[]>()
  for (const r of recipeRows) {
    if (!r.material_id) continue
    const name = zeroCostNameById.get(r.material_id)
    if (!name) continue
    const arr = zeroNamesByProduct.get(r.product_id) ?? []
    if (!arr.includes(name)) arr.push(name)
    zeroNamesByProduct.set(r.product_id, arr)
  }

  const flagged: ZeroCostLine[] = []
  for (const l of zeroLines) {
    const names = zeroNamesByProduct.get(l.product_id as string)
    if (names && names.length > 0) {
      flagged.push({ lineItemId: l.id, description: l.description ?? '(no description)', materialNames: names })
    }
  }
  return flagged
}

// Shared block message for item 4 (send / PDF). Never blocks editing --
// callers use this only at the send/generate entry points.
export function zeroCostBlockMessage(flagged: ZeroCostLine[]): string {
  const names = [...new Set(flagged.flatMap((f) => f.materialNames))]
  const materialList = names.join(', ')
  const lineWord = flagged.length === 1 ? 'line' : 'lines'
  return `Can't send -- ${flagged.length} ${lineWord} priced at $0 because of a zero-cost material (${materialList}). Fix the material's cost or the line item, then try again.`
}
