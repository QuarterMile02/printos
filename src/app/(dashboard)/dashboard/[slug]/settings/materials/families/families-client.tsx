'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  moveVariants, createFamilyAndMoveVariants, renameFamily, renameColour, deactivateMaterials,
  reactivateMaterials, deleteMaterials, bulkEditVariants, bulkEditMaterials,
} from './actions'

// ── Types ────────────────────────────────────────────────────────────

type MaterialRow = {
  id: string; name: string; active: boolean; material_type_id: string | null
  formula: string | null; show_external: boolean | null; length_uom: string
  cost: number | null; price: number | null
}
type VariantRow = {
  id: string; material_id: string; color_id: string | null
  width: number | null; height: number | null; base_cost: number | null
  multiplier: number; cost_per_unit: number | null; sell_per_unit: number | null
  is_default: boolean; length_uom: string
}
type ColourRow = { id: string; material_id: string; name: string; code: string | null }
type MaterialType = { id: string; name: string }

type Props = {
  orgId: string
  orgSlug: string
  types: MaterialType[]
  materials: MaterialRow[]
  variants: VariantRow[]
  colours: ColourRow[]
  recipeRefCounts: Record<string, number>
  vendorRefCounts: Record<string, number>
}

// Sentinel bucket keys. A real family's key is just its material id.
const PEN = '__pen__'
const LOOSE = '__loose__'
const DISABLED = '__disabled__'
const NEW_FAMILY = '__new__'
type SideKey = 'L' | 'R'

type Chip = { text: string; tone: 'n' | 'w' | 'c' | 'g' | 'p' }
type DeleteStatus = 'safe' | 'hold' | 'block'

const PEN_STORAGE_PREFIX = 'printos:material-families-pen:'

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10000) / 10000)
}

// ── Component ────────────────────────────────────────────────────────

export default function FamiliesClient({ orgId, orgSlug, types, materials, variants, colours, recipeRefCounts, vendorRefCounts }: Props) {
  const [pending, startTransition] = useTransition()
  const [banner, setBanner] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)

  // ── Indexes over the server-loaded snapshot ───────────────────────
  const materialsById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials])
  const colourById = useMemo(() => new Map(colours.map((c) => [c.id, c])), [colours])
  const variantsById = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants])
  const variantsByMaterial = useMemo(() => {
    const map = new Map<string, VariantRow[]>()
    for (const v of variants) {
      const arr = map.get(v.material_id) ?? []
      arr.push(v)
      map.set(v.material_id, arr)
    }
    return map
  }, [variants])
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types])

  // ── Holding pen -- client-only, writes nothing. Persisted so a page
  // refresh doesn't lose it. Stores bare variant ids; every other field
  // is looked up live from the props above, never snapshotted, so a
  // revalidate elsewhere can never leave the pen showing stale data.
  const penStorageKey = PEN_STORAGE_PREFIX + orgId
  const [pen, setPen] = useState<string[]>([])
  const [penHydrated, setPenHydrated] = useState(false)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(penStorageKey)
      if (raw) setPen(JSON.parse(raw))
    } catch { /* corrupt/blocked storage -- start with an empty pen, not a crash */ }
    setPenHydrated(true)
  }, [penStorageKey])
  useEffect(() => {
    if (!penHydrated) return // don't clobber storage with [] before the initial read completes
    try { window.localStorage.setItem(penStorageKey, JSON.stringify(pen)) } catch { /* ignore */ }
  }, [pen, penHydrated, penStorageKey])
  // Drop any pen entry whose variant no longer exists (deleted via some
  // other path) -- graceful, not a crash, and keeps the pen count honest.
  useEffect(() => {
    setPen((cur) => cur.filter((id) => variantsById.has(id)))
  }, [variantsById])

  // ── Slots ──────────────────────────────────────────────────────────
  const [slot, setSlot] = useState<{ L: string; R: string }>({ L: LOOSE, R: PEN })
  const [filter, setFilter] = useState<{ L: string; R: string }>({ L: '', R: '' })
  const [ticked, setTicked] = useState<{ L: Set<string>; R: Set<string> }>({ L: new Set(), R: new Set() })
  const [newDraft, setNewDraft] = useState<{ name: string; typeId: string | null }>({ name: '', typeId: null })

  function setTickedFor(side: SideKey, next: Set<string>) {
    setTicked((cur) => ({ ...cur, [side]: next }))
  }
  function clearTicks() {
    setTicked({ L: new Set(), R: new Set() })
  }

  // ── Bucket option list (the <select>) ─────────────────────────────
  // Families are grouped by material type name -- "every active material
  // that has >1 variant, grouped by material type," per spec. "+ New
  // family..." is right-slot only.
  type Option = { key: string; label: string; group: string }
  const familyOptions = useMemo(() => {
    const opts: Option[] = []
    for (const m of materials) {
      if (!m.active) continue
      const count = variantsByMaterial.get(m.id)?.length ?? 0
      if (count <= 1) continue
      const groupName = (m.material_type_id && typeById.get(m.material_type_id)?.name) || 'Uncategorized'
      opts.push({ key: m.id, label: m.name, group: groupName })
    }
    opts.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label))
    return opts
  }, [materials, variantsByMaterial, typeById])

  const looseCount = useMemo(() => materials.filter((m) => m.active && (variantsByMaterial.get(m.id)?.length ?? 0) <= 1).length, [materials, variantsByMaterial])
  const disabledCount = useMemo(() => materials.filter((m) => !m.active).length, [materials])

  function optionsFor(side: SideKey): Option[] {
    const working: Option[] = [
      { key: PEN, label: `⟡ Holding pen (${pen.length})`, group: 'Working buckets' },
      { key: LOOSE, label: `Not in a family (${looseCount})`, group: 'Working buckets' },
      { key: DISABLED, label: `Disabled · legacy (${disabledCount})`, group: 'Working buckets' },
    ]
    const fam = side === 'R' ? [{ key: NEW_FAMILY, label: '+ New family…', group: 'Families' }, ...familyOptions] : familyOptions
    return [...fam, ...working]
  }

  // ── Delete-safety, Disabled bucket only ───────────────────────────
  function deleteStatus(materialId: string): DeleteStatus {
    if ((recipeRefCounts[materialId] ?? 0) > 0) return 'block'
    if ((vendorRefCounts[materialId] ?? 0) > 0) return 'hold'
    return 'safe'
  }

  // Summary chips for the two multi-material browsing buckets -- a real
  // family's chips are data-quality flags (chipsFor, below); these two
  // are just "how big is this pile, and how much of it can I delete."
  function looseChips(): Chip[] {
    return [{ text: `${looseCount} material${looseCount === 1 ? '' : 's'}`, tone: 'n' }, { text: 'single-variant', tone: 'w' }]
  }
  function disabledChips(): Chip[] {
    const disabledMats = materials.filter((m) => !m.active)
    let safe = 0, blocked = 0
    for (const m of disabledMats) {
      const s = deleteStatus(m.id)
      if (s === 'safe') safe++
      else if (s === 'block') blocked++
    }
    return [
      { text: `${disabledCount} material${disabledCount === 1 ? '' : 's'}`, tone: 'n' },
      { text: `${blocked} blocked`, tone: 'c' },
      { text: `${safe} safe`, tone: 'g' },
    ]
  }

  // ── Computed chips -- a real family's data-quality flags. Documented
  // heuristics, not stored anywhere.
  function chipsFor(materialId: string): Chip[] {
    const mat = materialsById.get(materialId)
    const vs = variantsByMaterial.get(materialId) ?? []
    const chips: Chip[] = [{ text: `${vs.length} variant${vs.length === 1 ? '' : 's'}`, tone: 'n' }]

    const colourIds = new Set(vs.map((v) => v.color_id).filter((id): id is string => !!id))
    chips.push({ text: `${colourIds.size} colour${colourIds.size === 1 ? '' : 's'}`, tone: 'n' })

    const multipliers = new Set(vs.map((v) => v.multiplier))
    const mixedMultiplier = multipliers.size > 1

    const priced = vs.filter((v) => v.cost_per_unit != null && v.cost_per_unit > 0)
    const zeroCost = vs.length - priced.length
    let spread = 0
    if (priced.length > 1) {
      const costs = priced.map((v) => v.cost_per_unit as number)
      spread = Math.max(...costs) / Math.min(...costs)
    }

    // Formula-vs-dimensions mismatch, e.g. the Velcro case: formula='Area'
    // on a 0.5in x 900in tape prices at $/sqft, which is meaningless for
    // something bought and consumed by the linear inch. Heuristic: an
    // "Area"-family formula paired with any variant whose long side is
    // 20x its short side or worse. 20x is a judgment call, not a rule
    // from the schema -- documented here because there is no other
    // source of truth for it.
    const formula = mat?.formula ?? 'Area'
    const isAreaFormula = formula === 'Area' || formula === 'Total_Area' || formula === 'Area_in_sqyd'
    const narrowAndLong = isAreaFormula && vs.some((v) => {
      if (v.width == null || v.height == null || v.width <= 0 || v.height <= 0) return false
      const ratio = Math.max(v.width, v.height) / Math.min(v.width, v.height)
      return ratio >= 20
    })

    if (zeroCost > 0) chips.push({ text: `${zeroCost} zero/missing cost`, tone: 'c' })
    if (spread >= 3) chips.push({ text: `${spread.toFixed(1)}× cost spread`, tone: 'c' })
    if (mixedMultiplier) chips.push({ text: 'mixed multiplier', tone: 'w' })
    if (narrowAndLong) chips.push({ text: `${formula} → should be Length`, tone: 'w' })
    if (zeroCost === 0 && spread < 3 && !mixedMultiplier && !narrowAndLong) chips.push({ text: 'consistent', tone: 'g' })

    return chips
  }

  // ── Row shape for one slot's current bucket ───────────────────────
  // Cost and sell are each shown as a PAIR: the writable column next to
  // the generated per-unit rate it produces. baseCost/multiplier are the
  // two columns this screen can actually edit; costPerUnit/sellPerUnit
  // are material_variants' generated columns (173) -- read-only here,
  // shown so the two scales sit side by side instead of one masquerading
  // as the other. This is the whole diagnosis for the wrong-pricing-axis
  // case (the Velcro example): baseCost=21.00 next to costPerUnit=6.72 on
  // a 0.5in x 900in roll is what makes the mismatch visible at a glance;
  // a single "Cost" column showing only one of the two never would.
  //
  // height/width are kept as raw numbers, not a formatted "H x W" string
  // -- two right-aligned columns that never wrap (a 4-digit roll length
  // like Coil .040's 3240 broke the old single-string Size column onto
  // two lines), and Fix 5's sort needs the raw numbers anyway.
  //
  // materialName/colourName/typeName are carried on every row (not just
  // shown when the bucket needs them) because grouping and sorting need
  // them regardless of what the row's own label ends up displaying.
  type Row = {
    variantId: string; materialId: string; materialName: string; colourName: string | null
    height: number | null; width: number | null
    baseCost: number | null; costPerUnit: number | null
    mult: number; sellPerUnit: number | null
    badCost: boolean; status?: DeleteStatus
    typeId: string | null; typeName: string
  }

  function rowsFor(bucketKey: string): Row[] {
    if (bucketKey === PEN) {
      return pen.map((vid) => variantToRow(vid)).filter((r): r is Row => r !== null)
    }
    if (bucketKey === LOOSE) {
      return materials
        .filter((m) => m.active && (variantsByMaterial.get(m.id)?.length ?? 0) <= 1)
        .flatMap((m) => (variantsByMaterial.get(m.id) ?? []).map((v) => variantToRow(v.id)))
        .filter((r): r is Row => r !== null)
    }
    if (bucketKey === DISABLED) {
      return materials
        .filter((m) => !m.active)
        .flatMap((m) => (variantsByMaterial.get(m.id) ?? []).map((v) => variantToRow(v.id)))
        .filter((r): r is Row => r !== null)
        .map((r) => ({ ...r, status: deleteStatus(r.materialId) }))
    }
    if (bucketKey === NEW_FAMILY) return []
    // A real family.
    return (variantsByMaterial.get(bucketKey) ?? []).map((v) => variantToRow(v.id)).filter((r): r is Row => r !== null)
  }

  function variantToRow(variantId: string): Row | null {
    const v = variantsById.get(variantId)
    if (!v) return null
    const mat = materialsById.get(v.material_id)
    if (!mat) return null
    const colour = v.color_id ? colourById.get(v.color_id) : null
    const typeName = (mat.material_type_id && typeById.get(mat.material_type_id)?.name) || 'Uncategorized'
    return {
      variantId, materialId: v.material_id, materialName: mat.name, colourName: colour?.name ?? null,
      height: v.height, width: v.width,
      baseCost: v.base_cost, costPerUnit: v.cost_per_unit,
      mult: v.multiplier, sellPerUnit: v.sell_per_unit,
      badCost: v.cost_per_unit == null || v.cost_per_unit === 0,
      typeId: mat.material_type_id, typeName,
    }
  }

  function chipsForBucket(key: string): Chip[] {
    if (materialsById.has(key)) return chipsFor(key)
    if (key === PEN) return [{ text: pen.length === 0 ? 'nothing written yet' : `${pen.length} waiting, nothing written`, tone: 'p' }]
    if (key === LOOSE) return looseChips()
    if (key === DISABLED) return disabledChips()
    return []
  }

  // ── Mover ──────────────────────────────────────────────────────────
  const otherSide: Record<SideKey, SideKey> = { L: 'R', R: 'L' }

  async function move(from: SideKey) {
    const to = otherSide[from]
    const fromBucket = slot[from]
    const toBucket = slot[to]
    const ids = [...ticked[from]]
    if (ids.length === 0) return

    // Moving INTO the pen writes nothing -- pure client state.
    if (toBucket === PEN) {
      setPen((cur) => [...new Set([...cur, ...ids])])
      setTickedFor(from, new Set())
      return
    }

    // "Not in a family" and "Disabled · legacy" are read-only BROWSING
    // buckets, not drop targets -- each shows variants from many
    // different materials at once, so there is no single destination
    // material_id a move there could even mean. Pull variants OUT of
    // these (tick + move them toward a real family/the pen/+New family)
    // is the supported direction; dropping INTO them isn't offered.
    if (toBucket === LOOSE || toBucket === DISABLED) {
      setBanner({ kind: 'error', text: `"${toBucket === LOOSE ? 'Not in a family' : 'Disabled · legacy'}" isn't a destination -- it shows many materials at once, so there's no single family to move into. Load a real family, the pen, or "+ New family…" on this side instead.` })
      return
    }

    startTransition(async () => {
      let result: { error?: string; materialId?: string }
      if (toBucket === NEW_FAMILY) {
        result = await createFamilyAndMoveVariants({ orgId, orgSlug, variantIds: ids, name: newDraft.name, typeId: newDraft.typeId })
        if (!result.error && result.materialId) {
          setSlot((cur) => ({ ...cur, [to]: result.materialId as string }))
          setNewDraft({ name: '', typeId: null })
        }
      } else {
        result = await moveVariants({ orgId, orgSlug, variantIds: ids, targetMaterialId: toBucket })
      }
      if (result.error) {
        setBanner({ kind: 'error', text: result.error })
      } else {
        setBanner({ kind: 'ok', text: `Moved ${ids.length} variant${ids.length === 1 ? '' : 's'}.` })
        if (fromBucket === PEN) setPen((cur) => cur.filter((id) => !ids.includes(id)))
      }
      setTickedFor(from, new Set())
    })
  }

  function swap() {
    setSlot((cur) => ({ L: cur.R, R: cur.L }))
    setFilter({ L: '', R: '' })
    clearTicks()
  }

  function selectBucket(side: SideKey, key: string) {
    setSlot((cur) => ({ ...cur, [side]: key }))
    setFilter((cur) => ({ ...cur, [side]: '' }))
    setTickedFor(side, new Set())
  }

  // ── Pen-only actions. Both are pure client-state clears -- nothing
  // was ever written by placing a variant in the pen, so "emptying" and
  // "putting back" have the identical database effect (none): every
  // pen-held variant has been sitting in its original material the
  // entire time. The two buttons differ only in the message shown.
  function emptyPen() {
    setPen([])
    setBanner({ kind: 'ok', text: 'Pen cleared.' })
  }
  function putEverythingBack() {
    const n = pen.length
    setPen([])
    setBanner({ kind: 'ok', text: n === 0 ? 'Pen was already empty.' : `${n} variant${n === 1 ? '' : 's'} were never moved -- nothing to write, pen cleared.` })
  }

  // ── Family-pane / bucket-pane actions ─────────────────────────────
  function runAction(fn: () => Promise<{ error?: string } | void>, okText: string) {
    startTransition(async () => {
      const result = await fn()
      if (result && 'error' in result && result.error) setBanner({ kind: 'error', text: result.error })
      else setBanner({ kind: 'ok', text: okText })
    })
  }

  function handleRename(materialId: string, currentName: string) {
    const next = window.prompt('Rename family', currentName)
    if (next === null || !next.trim() || next.trim() === currentName) return
    runAction(() => renameFamily({ orgId, orgSlug, materialId, name: next.trim() }), 'Renamed.')
  }

  // "Rename colour" -- an action on the ticked selection, matching
  // "Rename family"'s existing window.prompt pattern rather than an
  // inline-editable row label, which would be a new interaction style
  // this screen doesn't use anywhere else. Enabled only when the ticked
  // rows in this family pane all share exactly one real colour (below).
  // The prompt text itself carries the two things the UI needs to say:
  // this only renames the colour on THIS family (color_id already scopes
  // that structurally -- material_colors is per-material, so there's
  // nothing else to leak into), and it changes every variant of that
  // colour here, since they all point at the same material_colors row.
  function handleRenameColour(colourId: string, currentName: string) {
    const next = window.prompt(
      `Rename colour "${currentName}"? This renames it for every variant of this colour in this family only -- not for any other material.`,
      currentName,
    )
    if (next === null || !next.trim() || next.trim() === currentName) return
    runAction(() => renameColour({ orgId, orgSlug, colourId, name: next.trim() }), 'Colour renamed.')
  }

  function handleDeactivate(materialIds: string[]) {
    if (materialIds.length === 0) return
    runAction(() => deactivateMaterials({ orgId, orgSlug, materialIds }), `Deactivated ${materialIds.length}.`)
  }
  function handleReactivate(materialIds: string[]) {
    if (materialIds.length === 0) return
    runAction(() => reactivateMaterials({ orgId, orgSlug, materialIds }), `Reactivated ${materialIds.length}.`)
  }
  function handleDelete(materialIds: string[]) {
    if (materialIds.length === 0) return
    if (!window.confirm(`Delete ${materialIds.length} material${materialIds.length === 1 ? '' : 's'}? This cannot be undone.`)) return
    startTransition(async () => {
      const result = await deleteMaterials({ orgId, orgSlug, materialIds })
      if (result.error) { setBanner({ kind: 'error', text: result.error }); return }
      const skippedText = result.skipped && result.skipped.length > 0
        ? ` Skipped ${result.skipped.length}: ${result.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}.`
        : ''
      setBanner({ kind: 'ok', text: `Deleted ${result.deleted}.${skippedText}` })
    })
  }

  // ── Bulk-edit strip ────────────────────────────────────────────────
  const [bulkCost, setBulkCost] = useState('')
  const [bulkMult, setBulkMult] = useState('')
  const [bulkFormula, setBulkFormula] = useState('')
  const [bulkInternal, setBulkInternal] = useState('')

  function applyBulk() {
    const variantIds = [...ticked.L, ...ticked.R]
    if (variantIds.length === 0) { setBanner({ kind: 'error', text: 'Nothing ticked.' }); return }

    const cost = bulkCost.trim() === '' ? undefined : Number(bulkCost)
    const mult = bulkMult.trim() === '' ? undefined : Number(bulkMult)
    const materialIds = [...new Set(variantIds.map((id) => variantsById.get(id)?.material_id).filter((x): x is string => !!x))]

    startTransition(async () => {
      const results: { error?: string }[] = []
      if (cost !== undefined || mult !== undefined) {
        results.push(await bulkEditVariants({ orgId, orgSlug, variantIds, baseCost: cost, multiplier: mult }))
      }
      if (bulkFormula || bulkInternal) {
        results.push(await bulkEditMaterials({
          orgId, orgSlug, materialIds,
          formula: bulkFormula || undefined,
          showExternal: bulkInternal === '' ? undefined : bulkInternal === 'no',
        }))
      }
      const err = results.find((r) => r.error)
      if (err) setBanner({ kind: 'error', text: err.error as string })
      else {
        setBanner({ kind: 'ok', text: `Updated ${variantIds.length} variant${variantIds.length === 1 ? '' : 's'}.` })
        setBulkCost(''); setBulkMult(''); setBulkFormula(''); setBulkInternal('')
        clearTicks()
      }
    })
  }

  // ── Render ─────────────────────────────────────────────────────────
  const selectedCount = ticked.L.size + ticked.R.size

  return (
    // Full viewport height minus the dashboard's own 56px top bar, same
    // pattern products/[id]/migrate/migrate-client.tsx already uses for
    // this exact problem. shrink-0 sections (header, banner, bulk-edit
    // strip) take whatever height their content needs; the bench row is
    // flex-1 so the panes get everything left over, and each pane's own
    // row area is flex-1 again internally -- more rows visible on a
    // large screen matters more than any column tightening (Fix 4).
    <div className="flex flex-col overflow-hidden p-6" style={{ height: 'calc(100vh - 56px)' }}>
      <div className="shrink-0">
        <h1 className="text-2xl font-extrabold text-qm-black">Material Families</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Two slots. Load any bucket into either one — a family, the holding pen, everything not in
          a family, the disabled legacy pile — and move variants between them in whichever direction
          you&apos;re working.
        </p>
      </div>

      {banner && (
        <div className={`mt-4 shrink-0 rounded-md border px-3 py-2 text-sm font-medium ${banner.kind === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
          {banner.text}
          <button className="ml-3 text-xs underline" onClick={() => setBanner(null)}>dismiss</button>
        </div>
      )}

      <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 items-stretch gap-3 md:grid-cols-[1fr_100px_1fr]">
        <Pane
          side="L" bucketKey={slot.L} orgSlug={orgSlug}
          isFamilyBucket={materialsById.has(slot.L)}
          options={optionsFor('L')} onSelect={(k) => selectBucket('L', k)}
          filterText={filter.L} onFilter={(t) => setFilter((c) => ({ ...c, L: t }))}
          rows={rowsFor(slot.L)} ticked={ticked.L} onTicked={(s) => setTickedFor('L', s)}
          chips={chipsForBucket(slot.L)}
          newDraft={slot.L === NEW_FAMILY ? newDraft : null} onNewDraft={setNewDraft} types={types}
          acts={actsFor('L', slot.L)}
        />

        <div className="flex shrink-0 flex-row items-center justify-center gap-2 md:flex-col md:gap-2.5">
          <button
            className="rounded-md border border-qm-black bg-qm-black px-3 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-30"
            disabled={ticked.L.size === 0 || pending}
            onClick={() => move('L')}
          >→</button>
          <button
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-30"
            disabled={ticked.R.size === 0 || pending}
            onClick={() => move('R')}
          >←</button>
          <span className="text-center text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {selectedCount === 0 ? <>nothing<br />selected</> : <>{selectedCount}<br />selected</>}
          </span>
          <button
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700"
            title="Swap the two slots" onClick={swap}
          >⇄</button>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Swap</span>
        </div>

        <Pane
          side="R" bucketKey={slot.R} orgSlug={orgSlug}
          isFamilyBucket={materialsById.has(slot.R)}
          options={optionsFor('R')} onSelect={(k) => selectBucket('R', k)}
          filterText={filter.R} onFilter={(t) => setFilter((c) => ({ ...c, R: t }))}
          rows={rowsFor(slot.R)} ticked={ticked.R} onTicked={(s) => setTickedFor('R', s)}
          chips={chipsForBucket(slot.R)}
          newDraft={slot.R === NEW_FAMILY ? newDraft : null} onNewDraft={setNewDraft} types={types}
          acts={actsFor('R', slot.R)}
        />
      </div>

      <div className="mt-4 flex shrink-0 flex-wrap items-end gap-4 rounded-md border border-gray-200 bg-white p-3.5 shadow-sm">
        <Field label="Base cost">
          <input value={bulkCost} onChange={(e) => setBulkCost(e.target.value)} placeholder="unchanged" className="w-28 rounded border border-gray-300 px-2 py-1.5 font-mono text-sm" />
        </Field>
        <Field label="Markup">
          <input value={bulkMult} onChange={(e) => setBulkMult(e.target.value)} placeholder="unchanged" className="w-28 rounded border border-gray-300 px-2 py-1.5 font-mono text-sm" />
        </Field>
        <Field label="Pricing axis">
          <select value={bulkFormula} onChange={(e) => setBulkFormula(e.target.value)} className="w-44 rounded border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">— unchanged —</option>
            <option value="Area">Area · per sq ft</option>
            <option value="Length">Length · per inch</option>
            <option value="Unit">Unit · each</option>
            <option value="Perimeter">Perimeter</option>
          </select>
        </Field>
        <Field label="Internal only">
          <select value={bulkInternal} onChange={(e) => setBulkInternal(e.target.value)} className="w-44 rounded border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">— unchanged —</option>
            <option value="no">No · we sell this</option>
            <option value="yes">Yes · shop use only</option>
          </select>
        </Field>
        <button
          className="h-[34px] rounded-md bg-qm-lime px-4 text-sm font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={pending || selectedCount === 0} onClick={applyBulk}
        >Apply to selection</button>
        <p className="ml-auto max-w-[32ch] text-right text-xs text-gray-400">
          Blank stays as it is. Applies to whatever is ticked, in either slot.
        </p>
      </div>
    </div>
  )

  function actsFor(side: SideKey, bucketKey: string): { label: string; danger?: boolean; onClick: () => void; disabled?: boolean }[] {
    const tickedIds = [...ticked[side]]
    const tickedMaterialIds = [...new Set(tickedIds.map((id) => variantsById.get(id)?.material_id).filter((x): x is string => !!x))]

    if (bucketKey === PEN) {
      return [
        { label: 'Empty the pen', onClick: emptyPen, disabled: pen.length === 0 },
        { label: 'Put everything back', onClick: putEverythingBack, disabled: pen.length === 0 },
      ]
    }
    if (bucketKey === LOOSE) {
      return [
        { label: 'Open detail page', onClick: () => tickedMaterialIds[0] && window.open(`/dashboard/${orgSlug}/settings/materials/${tickedMaterialIds[0]}`, '_blank'), disabled: tickedMaterialIds.length !== 1 },
        { label: 'Deactivate', danger: true, onClick: () => handleDeactivate(tickedMaterialIds), disabled: tickedMaterialIds.length === 0 },
      ]
    }
    if (bucketKey === DISABLED) {
      const safeTickedMaterialIds = tickedMaterialIds.filter((id) => deleteStatus(id) === 'safe')
      return [
        { label: 'Delete selected', danger: true, onClick: () => handleDelete(safeTickedMaterialIds), disabled: safeTickedMaterialIds.length === 0 },
        { label: 'Reactivate', onClick: () => handleReactivate(tickedMaterialIds), disabled: tickedMaterialIds.length === 0 },
      ]
    }
    if (bucketKey === NEW_FAMILY) return []
    // A real family -- the pane itself IS one material.
    const mat = materialsById.get(bucketKey)
    if (!mat) return []
    // "Rename colour" needs the ticked rows to all share exactly one real
    // colour -- read straight off the raw VariantRow (color_id), not the
    // PaneRow, same as tickedMaterialIds above.
    const tickedColourIds = [...new Set(tickedIds.map((id) => variantsById.get(id)?.color_id).filter((x): x is string => !!x))]
    return [
      { label: 'Rename family', onClick: () => handleRename(bucketKey, mat.name) },
      {
        label: 'Rename colour',
        onClick: () => handleRenameColour(tickedColourIds[0], colourById.get(tickedColourIds[0])?.name ?? ''),
        disabled: tickedColourIds.length !== 1,
      },
      { label: 'Open detail page', onClick: () => window.open(`/dashboard/${orgSlug}/settings/materials/${bucketKey}`, '_blank') },
      { label: 'Deactivate', danger: true, onClick: () => handleDeactivate([bucketKey]) },
    ]
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</label>
      {children}
    </div>
  )
}

const CHIP_TONE: Record<Chip['tone'], string> = {
  n: 'bg-gray-100 text-gray-600',
  w: 'bg-amber-50 text-amber-700',
  c: 'bg-red-50 text-red-700',
  g: 'bg-green-50 text-green-700',
  p: 'bg-purple-50 text-purple-700',
}

type PaneRow = {
  variantId: string; materialId: string; materialName: string; colourName: string | null
  height: number | null; width: number | null
  baseCost: number | null; costPerUnit: number | null
  mult: number; sellPerUnit: number | null
  badCost: boolean; status?: DeleteStatus
  typeId: string | null; typeName: string
}

// checkbox | Material | Height | Width | Base | Cost/u | Mult | Sell/u(or Delete?)
// Height/Width were 40px each with a 4px gap -- confirmed by rendering
// this exact grid that at that width the visible whitespace between
// "HEIGHT" and "WIDTH" was the 4px gap alone (both words nearly fill
// their own 40px cell), reading as one run-together word. Widened to
// 56/52px with a 6px gap; verified the fix the same way, side by side.
const ROW_GRID = 'grid-cols-[22px_1fr_56px_52px_60px_56px_46px_60px]'

// Family bucket groups by SIZE (height x width), not colour -- grouped
// this way, a missing colour at one size is visible (Coil .040 has Blue
// at 3240x5.3 and not at 3240x3.5, which grouping by colour hid
// completely). This also makes the row's own label -- the colour name --
// genuinely distinguishing again: it is no longer a repeat of the group
// header it sits under, it is the one thing that differs between rows
// in the same size group.
function groupKeyOf(r: PaneRow, isFamilyBucket: boolean): string {
  if (isFamilyBucket) return r.height != null && r.width != null ? `${r.height}x${r.width}` : '__nosize__'
  return r.typeId ?? '__uncategorized__'
}
function groupLabelOf(r: PaneRow, isFamilyBucket: boolean): string {
  if (isFamilyBucket) return r.height != null && r.width != null ? `${trimNum(r.height)} × ${trimNum(r.width)}` : 'No size'
  return r.typeName
}

function Pane({
  side, bucketKey, orgSlug, isFamilyBucket, options, onSelect, filterText, onFilter, rows, ticked, onTicked,
  chips, newDraft, onNewDraft, types, acts,
}: {
  side: SideKey
  bucketKey: string
  orgSlug: string
  isFamilyBucket: boolean
  options: { key: string; label: string; group: string }[]
  onSelect: (key: string) => void
  filterText: string
  onFilter: (text: string) => void
  rows: PaneRow[]
  ticked: Set<string>
  onTicked: (next: Set<string>) => void
  chips: Chip[]
  newDraft: { name: string; typeId: string | null } | null
  onNewDraft: (d: { name: string; typeId: string | null }) => void
  types: MaterialType[]
  acts: { label: string; danger?: boolean; onClick: () => void; disabled?: boolean }[]
}) {
  const selectGroups = new Map<string, { key: string; label: string }[]>()
  for (const o of options) {
    const arr = selectGroups.get(o.group) ?? []
    arr.push(o)
    selectGroups.set(o.group, arr)
  }

  const dead = bucketKey === DISABLED

  // Fix 3: default expanded for a family (browsing one material's own
  // variants), COLLAPSED for a multi-material bucket -- 1,789 disabled
  // rows in a flat list is unusable; collapsed-by-default makes it a
  // short list of types opened one at a time. Reset ONLY when the bucket
  // SELECTION changes, not on every rows-prop update (e.g. after a move
  // elsewhere revalidates) -- otherwise a mutation would silently
  // re-collapse whatever the user had open.
  const allGroupKeys = useMemo(() => new Set(rows.map((r) => groupKeyOf(r, isFamilyBucket))), [rows, isFamilyBucket])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => (isFamilyBucket ? new Set() : new Set(allGroupKeys)))
  useEffect(() => {
    setCollapsed(isFamilyBucket ? new Set() : new Set(allGroupKeys))
    // Only bucketKey should retrigger this -- see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucketKey])

  function toggleGroup(key: string) {
    setCollapsed((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  function toggle(variantId: string, checked: boolean) {
    const next = new Set(ticked)
    if (checked) next.add(variantId); else next.delete(variantId)
    onTicked(next)
  }

  const t = filterText.toLowerCase()
  const shown = rows.filter((r) => !t || r.materialName.toLowerCase().includes(t) || (r.colourName?.toLowerCase().includes(t) ?? false))

  // Grouping + sort. Family bucket: group by SIZE (height x width) --
  // groups themselves sort height then width ascending (nulls last, the
  // shop convention is height-first), and rows WITHIN a size group sort
  // by colour A-Z, since the colour is what varies inside one size and
  // the whole point of grouping this way is to make a missing colour at
  // a given size visible. Multi-material bucket: unchanged -- group by
  // material type (A-Z), rows within a group sort by material name A-Z.
  const groupMap = new Map<string, { label: string; height: number | null; width: number | null; rows: PaneRow[] }>()
  for (const r of shown) {
    const key = groupKeyOf(r, isFamilyBucket)
    if (!groupMap.has(key)) groupMap.set(key, { label: groupLabelOf(r, isFamilyBucket), height: r.height, width: r.width, rows: [] })
    groupMap.get(key)!.rows.push(r)
  }
  for (const g of groupMap.values()) {
    if (isFamilyBucket) {
      g.rows.sort((a, b) => (a.colourName ?? '').localeCompare(b.colourName ?? ''))
    } else {
      g.rows.sort((a, b) => a.materialName.localeCompare(b.materialName))
    }
  }
  const groupEntries = [...groupMap.entries()].sort((a, b) => {
    if (isFamilyBucket) {
      const ah = a[1].height ?? Infinity, bh = b[1].height ?? Infinity
      if (ah !== bh) return ah - bh
      return (a[1].width ?? Infinity) - (b[1].width ?? Infinity)
    }
    return a[1].label.localeCompare(b[1].label)
  })

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-md border border-gray-200 bg-white shadow-sm">
      <div className="shrink-0 border-b border-gray-100 p-3">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{side === 'L' ? 'Left slot' : 'Right slot'}</p>
        <select value={bucketKey} onChange={(e) => onSelect(e.target.value)} className="w-full rounded border border-gray-300 bg-gray-50 px-2.5 py-1.5 text-sm font-semibold text-qm-black">
          {[...selectGroups.entries()].map(([g, opts]) => (
            <optgroup key={g} label={g}>
              {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </optgroup>
          ))}
        </select>
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c, i) => (
              <span key={i} className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-medium ${CHIP_TONE[c.tone]}`}>{c.text}</span>
            ))}
          </div>
        )}
        {bucketKey !== NEW_FAMILY && (
          <div className="mt-2 flex items-center gap-2">
            <input value={filterText} onChange={(e) => onFilter(e.target.value)} placeholder="Filter…" className="flex-1 rounded border border-gray-300 px-2.5 py-1 text-sm" />
            <button onClick={() => setCollapsed(new Set(allGroupKeys))} className="shrink-0 text-[11px] text-gray-400 hover:text-gray-600 hover:underline">Collapse all</button>
            <span className="text-gray-300">·</span>
            <button onClick={() => setCollapsed(new Set())} className="shrink-0 text-[11px] text-gray-400 hover:text-gray-600 hover:underline">Expand all</button>
          </div>
        )}
      </div>

      {bucketKey === NEW_FAMILY && newDraft ? (
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
          <label className="text-xs font-medium text-gray-500">Family name</label>
          <input value={newDraft.name} onChange={(e) => onNewDraft({ ...newDraft, name: e.target.value })} placeholder="e.g. Polycarbonate .220in – 1/4&quot;" className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
          <label className="mt-1 text-xs font-medium text-gray-500">Material type (optional)</label>
          <select value={newDraft.typeId ?? ''} onChange={(e) => onNewDraft({ ...newDraft, typeId: e.target.value || null })} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">— none —</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <p className="mt-2 text-xs text-gray-400">
            Nothing is created yet. Name it, then tick variants on the other side and press → — the
            family and its first variants are created together, in one step.
          </p>
        </div>
      ) : (
        <>
          {/* Cost and sell are each a PAIR of columns: the writable value
              (Base, Mult) next to the generated per-unit rate it produces
              (Cost/u, Sell/u) -- deliberately never one column doing
              double duty for two different scales. Seeing Base=21.00
              next to Cost/u=6.72 on a 0.5in x 900in roll is the whole
              wrong-pricing-axis diagnosis this screen exists to surface;
              a single "Cost" column showing only one of the two never
              would. No separate Price column -- Sell/u fills that role,
              paired with Mult instead of floating alone; price is
              derivable and cost is what's being audited here. Height and
              width are their own columns, height first (shop convention)
              -- a combined "H x W" string wrapped onto two lines for a
              4-digit roll length and made two real, different sizes
              (Coil .040 at 3240x3.5 and 3240x5.3) look like duplicates. */}
          <div className={`shrink-0 grid ${ROW_GRID} items-center gap-1.5 border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400`}>
            <span />
            <span>Material</span>
            <span className="text-right" title="height, first -- shop convention">Height</span>
            <span className="text-right">Width</span>
            <span className="text-right" title="base_cost -- writable">Base</span>
            <span className="text-right" title="cost_per_unit -- generated">Cost/u</span>
            <span className="text-right" title="multiplier -- writable">Mult</span>
            <span className="text-right">{dead ? 'Delete?' : 'Sell/u'}</span>
          </div>
          <div className="min-h-[240px] flex-1 overflow-y-auto">
            {groupEntries.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-400">
                {bucketKey === PEN ? 'Pen is empty. Tick variants in a family and move them here.' : filterText ? 'Nothing matches that filter.' : 'Nothing here.'}
              </p>
            ) : groupEntries.map(([key, group]) => {
              const isCollapsed = collapsed.has(key)
              return (
                <div key={key}>
                  {/* Sticky within the scroll container, not a <label> --
                      collapse is a view state, never a selection. No
                      checkbox here at all, so ticking a collapsed group's
                      header can never tick its rows. */}
                  <button
                    type="button" onClick={() => toggleGroup(key)}
                    className="sticky top-0 z-[1] flex w-full items-center justify-between gap-2 border-b border-gray-200 bg-gray-100 px-3 py-1 text-left text-[11px] font-semibold text-gray-600 hover:bg-gray-200"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 truncate">
                      <span className={`inline-block shrink-0 text-[9px] transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>▶</span>
                      <span className="truncate">{group.label}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-gray-400">{group.rows.length}</span>
                  </button>
                  {!isCollapsed && group.rows.map((r) => {
                    const blocked = dead && r.status === 'block'
                    const fullName = r.colourName ? `${r.materialName} · ${r.colourName}` : r.materialName
                    const label = isFamilyBucket ? (r.colourName ?? '—') : fullName
                    return (
                      <label key={r.variantId} className={`grid ${ROW_GRID} items-center gap-1.5 border-b border-gray-100 px-3 py-1.5 last:border-0 hover:bg-gray-50 ${ticked.has(r.variantId) ? 'bg-blue-50' : ''} ${blocked ? '' : 'cursor-pointer'}`}>
                        <input type="checkbox" checked={ticked.has(r.variantId)} disabled={blocked} onChange={(e) => toggle(r.variantId, e.target.checked)} className="cursor-pointer accent-qm-lime disabled:cursor-not-allowed" />
                        <Link href={`/dashboard/${orgSlug}/settings/materials/${r.materialId}`} target="_blank" title={fullName} onClick={(e) => e.stopPropagation()} className="min-w-0 truncate text-sm text-qm-black hover:underline">{label}</Link>
                        <span className="text-right font-mono text-[12px] tabular-nums text-gray-500">{r.height != null ? trimNum(r.height) : '—'}</span>
                        <span className="text-right font-mono text-[12px] tabular-nums text-gray-500">{r.width != null ? trimNum(r.width) : '—'}</span>
                        <span className="text-right font-mono text-[12px] tabular-nums text-gray-500">{r.baseCost != null ? r.baseCost.toFixed(4) : '—'}</span>
                        <span className={`text-right font-mono text-[12px] tabular-nums ${r.badCost ? 'font-semibold text-red-600' : 'text-gray-500'}`}>{r.costPerUnit != null ? r.costPerUnit.toFixed(4) : '—'}</span>
                        <span className="text-right font-mono text-[12px] tabular-nums text-gray-500">{r.mult.toFixed(4)}</span>
                        {dead
                          ? <StatusBadge status={r.status ?? 'safe'} />
                          : <span className="text-right font-mono text-[12px] tabular-nums text-gray-500">{r.sellPerUnit != null ? r.sellPerUnit.toFixed(4) : '—'}</span>}
                      </label>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </>
      )}

      {acts.length > 0 && (
        <div className="flex min-h-[46px] shrink-0 flex-wrap gap-1.5 rounded-b-md border-t border-gray-100 bg-gray-50 p-2.5">
          {acts.map((a) => (
            <button
              key={a.label} onClick={a.onClick} disabled={a.disabled}
              className={`rounded border px-2.5 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${a.danger ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-gray-300 bg-white text-gray-600 hover:text-qm-black'}`}
            >{a.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: DeleteStatus }) {
  const style = status === 'safe' ? 'bg-green-50 text-green-700' : status === 'block' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
  const text = status === 'safe' ? 'Safe' : status === 'block' ? 'Blocked' : 'Check'
  return <span className={`rounded px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold uppercase tracking-wide ${style}`}>{text}</span>
}
