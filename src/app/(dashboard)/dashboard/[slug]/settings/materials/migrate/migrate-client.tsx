'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { ShopvoxMaterialRow } from '@/lib/material-migrate-proposals'
import type { FamilyProposal, FamilyColourGroup, FamilyVariant } from '@/lib/material-family-proposals'
import { FAMILY_CONFIGS } from '@/lib/material-family-proposals'
import { suggestParentMaterials } from '@/lib/material-parent-suggestions'
import {
  acceptSubstrateProposal, applyChangedFields, addVariantToExistingMaterial, dismissRows, restoreDismissedRow,
  type AcceptColourInput, type AcceptVariantInput, type AddToExistingColourInput,
} from './actions'

type FullRow = ShopvoxMaterialRow & {
  migrated_to_material_id: string | null
  migrated_at: string | null
  source_hash: string
  migrated_source_hash: string | null
  dismissed_at: string | null
}

type LinkedMaterial = {
  id: string; name: string; width: number | null; height: number | null; sheet_cost: number | null
  cost: number | null; price: number | null; multiplier: number | null; preferred_vendor: string | null
  part_number: string | null; sku: string | null; po_description: string | null; info_url: string | null
  description: string | null
}

type ExistingMaterial = { id: string; name: string; category_id: string | null }
type ExistingColour = { id: string; material_id: string; name: string | null; code: string | null }

type MaterialType = { id: string; name: string }

type Props = {
  orgId: string
  orgSlug: string
  types: MaterialType[]
  newCountsByType: Record<string, number> // material_type_id -> TRUE NEW count, org-wide, fully paginated -- never derived from `proposals`
  selectedTypeId: string | null
  parserConfigured: boolean // false = no FAMILY_CONFIGS entry for the selected type -- never render an empty screen for this, see the banner below
  trueNewCount: number // the selected type's NEW row count, straight from the paginated fetch -- independent of `proposals`, checked against it below
  rows: FullRow[]
  proposals: FamilyProposal[]
  linkedMaterials: Record<string, unknown>[]
  migratedMaterialNames: { id: string; name: string }[]
  existingMaterials: ExistingMaterial[]
  existingColours: ExistingColour[]
  categoryNames: Record<string, string>
}

type Tab = 'NEW' | 'CHANGED' | 'MIGRATED' | 'DISMISSED'

const CONFIDENCE_STYLE: Record<string, string> = {
  high: 'bg-green-50 text-green-700 border-green-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-red-50 text-red-700 border-red-200',
}

// Editable copy of a FamilyVariant, plus this screen's own state.
type EditableVariant = FamilyVariant & { isDefault: boolean; removed: boolean }
// Editable copy of a FamilyColourGroup — "Colour / Finish" is the UI
// label everywhere (per instruction: the real data includes Mill, Brite
// Brushed Gold, Painted 1 Side — finishes and prep states, not colours;
// the grouping is right, only the word was wrong). Internal field names
// and the material_colors table name stay "colour" throughout.
//
// existingColorId / noColourFinish: both shared by both actions this
// state now feeds -- "Accept as new material" ignores them entirely (it
// already treats a blank name as "no colour/finish", matching
// accept_family_proposal). "Add to an existing material" reads them per
// colour group to decide the target: an existing material_colors row
// (existingColorId set), a brand-new one (both null/false, needs a
// name/code), or explicitly NO colour/finish at all -- color_id NULL on
// the parent, no material_colors row created (noColourFinish true).
// These three are mutually exclusive and BUG FIX 2026-08-24: they must
// stay that way -- the prior shape (existingColorId: null meaning
// either "create new" or "no colour", disambiguated only by whether
// name/code happened to be blank) made "no colour" impossible to submit
// at all (validation required a name/code whenever existingColorId was
// null) and, had it been sent anyway, would have hit
// add_variant_to_existing_material's create-new branch and inserted a
// material_colors row with a NULL name -- a materially different thing
// from no colour/finish (migration 181's unique index buckets
// COALESCE(color_id, '00000000-...') differently for a real, nameless
// colour row vs. color_id actually NULL). One editable-colours state
// still serves both actions -- there is no separate "add to existing"
// form to keep in sync with edits made here.
type EditableColourFinish = { key: string; name: string; code: string; isStocked: boolean; removed: boolean; existingColorId: string | null; noColourFinish: boolean; variants: EditableVariant[] }

function pickDefaultIndex(variants: FamilyVariant[]): number {
  const noSizeIdx = variants.findIndex((v) => v.sizeLabel === null)
  return noSizeIdx >= 0 ? noSizeIdx : 0
}

// Brand/product-line (rolls only, e.g. "Oracal 651", "Avery SW900") is
// FAMILY-DISTINGUISHING and goes into the generated material NAME as
// plain text -- confirmed by Ruben, no database column for it. Always
// null for substrates, so this is a no-op there (identical output to
// before this field existed).
function familyDisplayName(p: Pick<FamilyProposal, 'line' | 'axisValue' | 'brand'>): string {
  return [p.line, p.axisValue, p.brand].filter(Boolean).join(' ').trim()
}

function buildEditableState(proposal: FamilyProposal): EditableColourFinish[] {
  return proposal.colours.map((c: FamilyColourGroup, ci) => {
    const defaultIdx = pickDefaultIndex(c.variants)
    return {
      key: `${proposal.key}::${ci}`,
      name: c.colourName ?? '',
      code: c.code ?? '',
      isStocked: false,
      removed: false,
      existingColorId: null,
      // Default to "No colour/finish" exactly when the proposal itself
      // carries neither -- e.g. "Magnet Digital 30Mil Magnum 24in",
      // line + axis + brand only, no colour token anywhere in the name.
      // These are legitimate, confirmed live -- not a parse miss.
      noColourFinish: !c.colourName && !c.code,
      variants: c.variants.map((v, vi) => ({ ...v, isDefault: vi === defaultIdx, removed: false })),
    }
  })
}

export default function MigrateClient({ orgId, orgSlug, types, newCountsByType, selectedTypeId, parserConfigured, trueNewCount, rows, proposals, linkedMaterials, migratedMaterialNames, existingMaterials, existingColours, categoryNames }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('NEW')
  const [selectedKey, setSelectedKey] = useState<string | null>(proposals[0]?.key ?? null)
  const [familyNameOverride, setFamilyNameOverride] = useState<string | null>(null)
  const [editableColours, setEditableColours] = useState<EditableColourFinish[] | null>(null)
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  // "Add to existing material" state -- material picker only. Which
  // colour/finish groups get created vs. mapped onto an existing one,
  // and every variant's height/width/length increment, now live on the
  // SAME `activeColours` state "Accept as new material" already edits
  // (see EditableColourFinish.existingColorId) -- one shared editor for
  // both actions, not two that could drift out of sync. Works
  // identically for a singleton (one colour, one variant) or a
  // multi-row family (any number of either) -- no row-count gate.
  const [parentSearch, setParentSearch] = useState('')
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null)

  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])

  const rowsByStatus = useMemo(() => ({
    NEW: rows.filter((r) => r.status === 'NEW'),
    CHANGED: rows.filter((r) => r.status === 'CHANGED'),
    MIGRATED: rows.filter((r) => r.status === 'MIGRATED'),
    DISMISSED: rows.filter((r) => r.status === 'DISMISSED'),
  }), [rows])

  const materialById = useMemo(() => {
    const m = new Map<string, LinkedMaterial>()
    for (const lm of linkedMaterials) m.set((lm as LinkedMaterial).id, lm as LinkedMaterial)
    return m
  }, [linkedMaterials])

  const migratedNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const mm of migratedMaterialNames) m.set(mm.id, mm.name)
    return m
  }, [migratedMaterialNames])

  const selectedProposal = proposals.find((p) => p.key === selectedKey) ?? null
  const activeColours = editableColours ?? (selectedProposal ? buildEditableState(selectedProposal) : [])
  const defaultFamilyName = selectedProposal ? familyDisplayName(selectedProposal) : ''

  // Total rows that would be added to the chosen parent -- every
  // non-removed variant across every non-removed colour. Drives the "Or
  // add to an existing material" submit button label so it's honest
  // about a 1-row vs. a 12-row add, not always "Add to this material".
  const totalActiveRowCount = activeColours
    .filter((c) => !c.removed)
    .reduce((sum, c) => sum + c.variants.filter((v) => !v.removed).length, 0)

  // The config that actually produced `proposals` — keyed by the
  // SELECTED type's name (not hardcoded to substrates), so suggested-
  // parent ranking uses the right axis parser for whatever type is on
  // screen. Falls back to a no-op axis finder when unconfigured (the
  // suggestions list will just be empty via the categoryId gate below).
  const selectedTypeName = types.find((t) => t.id === selectedTypeId)?.name ?? null
  const activeConfig = selectedTypeName ? FAMILY_CONFIGS[selectedTypeName] : undefined

  // Suggested parents -- no row-count gate. Ranking is keyed on line/
  // axisValue/categoryId, all family-level fields that exist for a
  // 1-row or a 50-row proposal alike; suggestParentMaterials never
  // looked at row count in the first place, the gate here was the only
  // thing stopping a multi-row family from getting suggestions.
  const suggestions = useMemo(() => {
    if (!selectedProposal || !activeConfig) return []
    return suggestParentMaterials(
      {
        line: selectedProposal.line,
        axisValue: selectedProposal.axisValue,
        categoryId: selectedProposal.categoryId,
        categoryName: selectedProposal.categoryId ? categoryNames[selectedProposal.categoryId] ?? null : null,
      },
      existingMaterials.map((m) => ({ id: m.id, name: m.name, categoryId: m.category_id })),
      activeConfig.findAxisStart,
    )
  }, [selectedProposal, existingMaterials, categoryNames, activeConfig])

  const filteredExistingMaterials = useMemo(() => {
    const q = parentSearch.trim().toLowerCase()
    if (!q) return existingMaterials.slice(0, 20)
    return existingMaterials.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 20)
  }, [parentSearch, existingMaterials])

  const coloursForSelectedParent = useMemo(
    () => (selectedParentId ? existingColours.filter((c) => c.material_id === selectedParentId) : []),
    [selectedParentId, existingColours],
  )

  function selectProposal(p: FamilyProposal) {
    setSelectedKey(p.key)
    setEditableColours(null)
    setFamilyNameOverride(null)
    setMessage(null)
    setSelectedParentId(null)
    setParentSearch('')
  }

  function updateColour(idx: number, patch: Partial<EditableColourFinish>) {
    const next = activeColours.map((c, i) => (i === idx ? { ...c, ...patch } : c))
    setEditableColours(next)
  }

  function removeColour(idx: number) {
    updateColour(idx, { removed: true })
  }

  function updateVariant(colourIdx: number, variantIdx: number, patch: Partial<EditableVariant>) {
    const next = activeColours.map((c, ci) => {
      if (ci !== colourIdx) return c
      const variants = c.variants.map((v, vi) => {
        if (vi !== variantIdx) return { ...v, isDefault: patch.isDefault ? false : v.isDefault }
        return { ...v, ...patch }
      })
      return { ...c, variants }
    })
    setEditableColours(next)
  }

  function removeVariant(colourIdx: number, variantIdx: number) {
    updateVariant(colourIdx, variantIdx, { removed: true })
  }

  // Vendor seed + legacy pricing fields are sourced from the raw
  // shopvox_materials rows (not the proposal object, which only carries
  // grouping/colour/size structure) — the first non-excluded row across
  // all remaining colours, same "best available" approach Build 1 used.
  function pickSeedRow(colours: EditableColourFinish[]): FullRow | null {
    for (const c of colours) {
      if (c.removed) continue
      for (const v of c.variants) {
        if (v.removed) continue
        const row = rowById.get(v.sourceRowId)
        if (row) return row
      }
    }
    return null
  }

  function pickVendorSeed(seedRow: FullRow | null) {
    if (!seedRow) return null
    const best = [...(seedRow.vendor_pricing ?? [])].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))[0]
    if (best?.vendor_name) return { vendorName: best.vendor_name, vendorPrice: best.price, partNumber: best.part_number, rank: best.rank }
    if (seedRow.preferred_vendor) return { vendorName: seedRow.preferred_vendor, vendorPrice: seedRow.cost, partNumber: seedRow.part_number, rank: null }
    return null
  }

  function handleAccept() {
    if (!selectedProposal) return
    const remainingColours = activeColours.filter((c) => !c.removed && c.variants.some((v) => !v.removed))
    if (remainingColours.length === 0) { setMessage('Every colour/finish is removed — nothing to accept.'); return }

    // BUG FIX 2026-08-21: baseCost/multiplier were hardcoded null here,
    // silently dropping every variant's own real cost and multiplier
    // (confirmed live: a real accept produced base_cost=NULL and
    // multiplier=2.0000 on all 7 variants of an accepted Polycarbonate
    // family, when the true per-row costs ranged $2.61-$4.12 and
    // multipliers were 3 / 3.77). Each variant's cost and multiplier
    // live on its OWN source shopvox_materials row (v.sourceRowId), not
    // on the family/colour as a whole -- look each one up individually
    // rather than reusing the single family-level seedRow used for
    // legacyFields below. sheet_cost is preferred over cost, matching
    // ShopVOX's own "Sheet Cost" field for a per-sqft/per-unit price
    // (cost is the coarser, less specific fallback).
    const colours: AcceptColourInput[] = remainingColours.map((c) => {
      const variants: AcceptVariantInput[] = c.variants
        .filter((v) => !v.removed)
        .map((v) => {
          const sourceRow = rowById.get(v.sourceRowId)
          return {
            height: v.height, width: v.width, lengthIncrement: v.lengthIncrement, isDefault: v.isDefault,
            baseCost: sourceRow?.sheet_cost ?? sourceRow?.cost ?? null,
            multiplier: sourceRow?.multiplier ?? null,
            sourceName: sourceRow?.name ?? null,
          }
        })
      return { name: c.name.trim() || null, code: c.code.trim() || null, isStocked: c.isStocked, variants }
    })

    const sourceRowIds = remainingColours.flatMap((c) => c.variants.filter((v) => !v.removed).map((v) => v.sourceRowId))
    const seedRow = pickSeedRow(remainingColours)
    const vendorSeed = pickVendorSeed(seedRow)
    const familyName = (familyNameOverride ?? defaultFamilyName).trim()
    if (!familyName) { setMessage('Family name is required.'); return }

    startTransition(async () => {
      const result = await acceptSubstrateProposal({
        orgId, orgSlug,
        familyName,
        materialTypeId: selectedProposal.materialTypeId,
        categoryId: selectedProposal.categoryId,
        sourceRowIds,
        colours,
        vendorSeed,
        legacyFields: {
          cost: seedRow?.cost ?? null, price: seedRow?.price ?? null, sheetCost: seedRow?.sheet_cost ?? null,
          multiplier: seedRow?.multiplier ?? null, weight: null,
          partNumber: seedRow?.part_number ?? null, sku: seedRow?.sku ?? null,
          poDescription: seedRow?.po_description ?? null, infoUrl: seedRow?.info_url ?? null,
          description: seedRow?.description ?? null,
        },
      })
      if (result.error) setMessage(`Error: ${result.error}`)
      else {
        setMessage(`Created material "${familyName}".`)
        setSelectedKey(null)
        setEditableColours(null)
      }
    })
  }

  // No row-count gate -- works identically for a singleton (one colour
  // group, one variant) or a multi-row family (any number of either).
  // Every row in the family is sent in ONE call to
  // addVariantToExistingMaterial, which is itself one DB transaction
  // (migration 185) -- either all of it lands or none does, never row
  // by row.
  function handleAddToExisting() {
    if (!selectedProposal) return
    if (!selectedParentId) { setMessage('Pick an existing material first.'); return }
    const remainingColours = activeColours.filter((c) => !c.removed && c.variants.some((v) => !v.removed))
    if (remainingColours.length === 0) { setMessage('Every colour/finish is removed — nothing to add.'); return }
    for (const c of remainingColours) {
      // Three valid targets: mapped to an existing colour, explicitly
      // no colour/finish, or a new one (which needs a name or code).
      // BUG FIX 2026-08-24: a colourless proposal ("Magnet Digital
      // 30Mil Magnum 24in", no colour/finish token at all) used to be
      // unrepresentable here -- existingColorId null with a blank
      // name/code was rejected outright, even though it's the correct,
      // legitimate shape for that family. noColourFinish is the
      // explicit third option that closes this.
      if (!c.existingColorId && !c.noColourFinish && !c.name.trim() && !c.code.trim()) {
        setMessage(`Name the new colour/finish "${c.name || c.code || '(untitled)'}", map it to an existing one, or choose "No colour/finish".`)
        return
      }
    }

    // Each variant's cost and multiplier come from its OWN source row --
    // same "never a shared/guessed value" rule handleAccept already
    // follows, not a manually-typed field here either. A multiplier of
    // 0 is sent through as-is, unmodified -- migration 185's RPC is what
    // actually refuses it, same "let the real check fire" pattern
    // accept_family_proposal already established.
    const colours: AddToExistingColourInput[] = remainingColours.map((c) => ({
      existingColorId: c.existingColorId,
      noColourFinish: !c.existingColorId && c.noColourFinish,
      name: !c.existingColorId && !c.noColourFinish ? (c.name.trim() || null) : null,
      code: !c.existingColorId && !c.noColourFinish ? (c.code.trim() || null) : null,
      isStocked: c.isStocked,
      variants: c.variants
        .filter((v) => !v.removed)
        .map((v) => {
          const sourceRow = rowById.get(v.sourceRowId)
          return {
            height: v.height, width: v.width, lengthIncrement: v.lengthIncrement, isDefault: v.isDefault,
            baseCost: sourceRow?.sheet_cost ?? sourceRow?.cost ?? null,
            multiplier: sourceRow?.multiplier ?? null,
            sourceRowId: v.sourceRowId,
            sourceName: sourceRow?.name ?? null,
          }
        }),
    }))
    const rowCount = colours.reduce((sum, c) => sum + c.variants.length, 0)

    startTransition(async () => {
      const result = await addVariantToExistingMaterial({ orgId, orgSlug, materialId: selectedParentId, colours })
      if (result.error) setMessage(`Error: ${result.error}`)
      else {
        const parentName = existingMaterials.find((m) => m.id === selectedParentId)?.name ?? selectedParentId
        setMessage(`Added ${rowCount} row${rowCount === 1 ? '' : 's'} to "${parentName}".`)
        setSelectedKey(null)
        setEditableColours(null)
      }
    })
  }

  function handleDismiss() {
    if (!selectedProposal) return
    startTransition(async () => {
      const result = await dismissRows({ orgId, orgSlug, shopvoxMaterialIds: selectedProposal.sourceRowIds })
      if (result.error) setMessage(`Error: ${result.error}`)
      else {
        setMessage(`Dismissed ${selectedProposal.sourceRowIds.length} row(s).`)
        setSelectedKey(null)
        setEditableColours(null)
      }
    })
  }

  function handleRestore(rowId: string) {
    startTransition(async () => {
      const result = await restoreDismissedRow({ orgId, orgSlug, shopvoxMaterialId: rowId })
      setMessage(result.error ? `Error: ${result.error}` : 'Restored to NEW.')
    })
  }

  function handleDismissSingleRow(rowId: string) {
    startTransition(async () => {
      const result = await dismissRows({ orgId, orgSlug, shopvoxMaterialIds: [rowId] })
      setMessage(result.error ? `Error: ${result.error}` : 'Dismissed.')
    })
  }

  // types.length === 0 is the only case with truly nothing to show — an
  // org with zero material types has zero possible rows. Every other
  // case (a type selected, configured or not) renders the full layout
  // below; an unconfigured type gets a banner and a flat row list, NEVER
  // a bare/empty screen — that ambiguity (empty vs. nothing-to-do) is
  // exactly what hid 5 real rows before this fix.
  if (types.length === 0) {
    return <div className="p-6 text-sm text-red-700">No material types found for this org — nothing to migrate.</div>
  }

  // proposalRowCount is derived ONLY from `proposals` (client-side, its
  // own independent sum). trueNewCount is the row count page.tsx fetched
  // directly, fully paginated, with no dependency on proposals at all.
  // buildFamilyProposals never drops a row, so these should always
  // match when a type is configured — but "should always match" is
  // exactly the kind of assumption that hid rows before. Check it, don't
  // trust it.
  const proposalRowCount = proposals.reduce((sum, p) => sum + p.sourceRowIds.length, 0)
  const countsDisagree = parserConfigured && proposalRowCount !== trueNewCount

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Migrate Materials from ShopVOX</h1>
        <p className="mt-1 text-sm text-gray-500">Left is the read-only ShopVOX scrape, grouped into proposed families. Right is a pre-filled proposal — nothing is written to PrintOS until you accept it, add it to an existing material, or dismiss it.</p>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="type-picker" className="text-xs font-medium uppercase text-gray-500">Material type</label>
        <select
          id="type-picker"
          className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
          value={selectedTypeId ?? ''}
          onChange={(e) => router.push(`?type=${e.target.value}`)}
        >
          {types.map((t) => (
            <option key={t.id} value={t.id}>{t.name} — {newCountsByType[t.id] ?? 0} NEW</option>
          ))}
        </select>
      </div>

      {!parserConfigured && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No parser configured for this material type yet — rows are shown raw below, one at a time. You can review and dismiss them; grouped &ldquo;Accept as new material&rdquo; proposals aren&rsquo;t available until a parser config is added for this type.
        </div>
      )}

      {countsDisagree && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          ⚠ {proposals.length} proposal(s) cover {proposalRowCount} of {trueNewCount} true NEW row(s) for this type — {trueNewCount - proposalRowCount} row(s) may be missing from the grouping below. Do not treat the proposal list as complete until this is resolved.
        </div>
      )}

      {message && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">{message}</div>
      )}

      <div className="flex gap-1 border-b border-gray-200">
        {(['NEW', 'CHANGED', 'MIGRATED', 'DISMISSED'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t} ({rowsByStatus[t].length})
          </button>
        ))}
      </div>

      {tab === 'NEW' && !parserConfigured && (
        <div className="rounded-md border border-gray-200 divide-y divide-gray-100">
          {rowsByStatus.NEW.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <div className="text-gray-900">{r.name}</div>
                <div className="mt-0.5 text-xs text-gray-500">
                  {r.category_id ? categoryNames[r.category_id] ?? '' : '(no category)'}
                  {r.width != null ? ` · ${r.width}in wide` : ''}
                  {r.sheet_cost != null ? ` · $${r.sheet_cost}` : ''}
                </div>
              </div>
              <button disabled={pending} onClick={() => handleDismissSingleRow(r.id)} className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50">
                Dismiss
              </button>
            </div>
          ))}
          {rowsByStatus.NEW.length === 0 && <div className="p-4 text-sm text-gray-500">Nothing new to migrate for this type.</div>}
        </div>
      )}

      {tab === 'NEW' && parserConfigured && (
        <div className="grid grid-cols-2 gap-4">
          {/* LEFT: read-only proposed families */}
          <div className="rounded-md border border-gray-200">
            <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs font-medium uppercase text-gray-500">Proposed families ({proposals.length})</div>
            <div className="max-h-[75vh] overflow-y-auto divide-y divide-gray-100">
              {proposals.map((p) => {
                const label = familyDisplayName(p)
                return (
                  <button
                    key={p.key}
                    onClick={() => selectProposal(p)}
                    className={`block w-full px-3 py-2 text-left ${selectedKey === p.key ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">{label}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase ${CONFIDENCE_STYLE[p.confidence]}`}>{p.confidence}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {p.sourceRowIds.length} row{p.sourceRowIds.length === 1 ? '' : 's'} · {p.colours.length} colour/finish{p.colours.length === 1 ? '' : 'es'}
                    </div>
                    {/* Reasoning always visible, per instruction -- so Ruben can
                        see WHY a family grouped (or a LOW row declined to
                        group) before he ever clicks in, not just that it did. */}
                    <div className="mt-1 text-[11px] text-gray-400 line-clamp-2">{p.reasoning}</div>
                  </button>
                )
              })}
              {proposals.length === 0 && <div className="p-4 text-sm text-gray-500">Nothing new to migrate.</div>}
            </div>
          </div>

          {/* RIGHT: editable proposal */}
          <div className="rounded-md border border-gray-200">
            <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs font-medium uppercase text-gray-500">Proposal</div>
            {!selectedProposal ? (
              <div className="p-4 text-sm text-gray-500">Select a family on the left.</div>
            ) : (
              <div className="max-h-[75vh] space-y-4 overflow-y-auto p-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500">Material name</label>
                  <input
                    type="text"
                    className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm font-semibold text-gray-900"
                    value={familyNameOverride ?? defaultFamilyName}
                    onChange={(e) => setFamilyNameOverride(e.target.value)}
                  />
                </div>
                <div className={`rounded border px-2 py-1.5 text-xs ${CONFIDENCE_STYLE[selectedProposal.confidence]}`}>
                  <span className="font-semibold uppercase">{selectedProposal.confidence} confidence</span> — {selectedProposal.reasoning}
                </div>

                <div className="space-y-3">
                  {activeColours.map((c, ci) => {
                    if (c.removed) return null
                    return (
                      <div key={c.key} className="rounded border border-gray-200 p-2">
                        <div className="flex items-center gap-2">
                          <label className="text-[10px] font-medium uppercase text-gray-500">Colour / Finish</label>
                          <input
                            type="text"
                            placeholder="(none)"
                            className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs"
                            value={c.name}
                            onChange={(e) => updateColour(ci, { name: e.target.value })}
                          />
                          <input
                            type="text"
                            placeholder="code"
                            className="w-20 rounded border border-gray-300 px-1.5 py-0.5 text-xs"
                            value={c.code}
                            onChange={(e) => updateColour(ci, { code: e.target.value })}
                          />
                          <label className="flex items-center gap-1 text-[11px] text-gray-600">
                            <input type="checkbox" checked={c.isStocked} onChange={(e) => updateColour(ci, { isStocked: e.target.checked })} /> Stocked
                          </label>
                          <button onClick={() => removeColour(ci)} className="text-xs text-red-600 hover:underline">Remove</button>
                        </div>

                        <table className="mt-2 w-full text-xs">
                          <thead>
                            <tr className="text-left text-gray-500">
                              <th className="w-8">Default</th><th>Height</th><th>Width</th><th>Length incr.</th><th>Source</th><th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.variants.map((v, vi) => {
                              if (v.removed) return null
                              return (
                                <tr key={v.sourceRowId}>
                                  <td><input type="radio" name={`default-${c.key}`} checked={v.isDefault} onChange={() => updateVariant(ci, vi, { isDefault: true })} /></td>
                                  <td><input type="number" className="w-16 rounded border border-gray-300 px-1 py-0.5" value={v.height ?? ''} onChange={(e) => updateVariant(ci, vi, { height: e.target.value === '' ? null : parseFloat(e.target.value) })} /></td>
                                  <td><input type="number" className="w-16 rounded border border-gray-300 px-1 py-0.5" value={v.width ?? ''} onChange={(e) => updateVariant(ci, vi, { width: e.target.value === '' ? null : parseFloat(e.target.value) })} /></td>
                                  <td><input type="number" className="w-16 rounded border border-gray-300 px-1 py-0.5" value={v.lengthIncrement ?? ''} onChange={(e) => updateVariant(ci, vi, { lengthIncrement: e.target.value === '' ? null : parseFloat(e.target.value) })} /></td>
                                  <td className="max-w-[140px] truncate text-gray-500" title={v.sourceName}>{v.sourceName}</td>
                                  <td><button onClick={() => removeVariant(ci, vi)} className="text-red-600 hover:underline">✕</button></td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                  })}
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    disabled={pending}
                    onClick={handleAccept}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {pending ? 'Saving…' : 'Accept as new material'}
                  </button>
                  <button
                    disabled={pending}
                    onClick={handleDismiss}
                    className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                  <button
                    disabled={pending}
                    onClick={() => { setSelectedKey(null); setEditableColours(null); setFamilyNameOverride(null) }}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Reject
                  </button>
                </div>

                {/* Add to existing material -- no row-count gate. Every
                    non-removed colour/finish above gets its own mapping:
                    either "+ New colour/finish" (create it fresh on the
                    parent) or an existing material_colors row on the
                    chosen parent to fold into. Every variant under every
                    mapped colour goes into ONE call to
                    addVariantToExistingMaterial (migration 185's
                    colours[]→variants[] payload) -- all-or-nothing,
                    whether this proposal is a singleton or a 12-row
                    family. */}
                {selectedProposal && (
                  <div className="mt-4 border-t border-gray-200 pt-3">
                    <div className="mb-2 text-xs font-semibold uppercase text-gray-500">Or add to an existing material</div>

                    {suggestions.length > 0 ? (
                      <div className="mb-2 space-y-1">
                        <div className="text-[11px] font-medium text-gray-500">Suggested parent materials</div>
                        {suggestions.map((s) => (
                          <button
                            key={s.materialId}
                            onClick={() => { setSelectedParentId(s.materialId); setParentSearch(s.materialName) }}
                            className={`block w-full rounded border px-2 py-1 text-left text-xs ${selectedParentId === s.materialId ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}
                          >
                            <div className="font-medium text-gray-800">{s.materialName}</div>
                            <div className="text-[10px] text-gray-500">{s.reason}</div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="mb-2 text-[11px] text-gray-400">No likely parent found — search below if you think one exists.</div>
                    )}

                    <input
                      type="text"
                      placeholder="Search existing materials by name…"
                      className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                      value={parentSearch}
                      onChange={(e) => { setParentSearch(e.target.value); setSelectedParentId(null) }}
                    />
                    {parentSearch && !selectedParentId && (
                      <div className="mt-1 max-h-32 overflow-y-auto rounded border border-gray-200">
                        {filteredExistingMaterials.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => { setSelectedParentId(m.id); setParentSearch(m.name) }}
                            className="block w-full px-2 py-1 text-left text-xs hover:bg-gray-50"
                          >
                            {m.name}
                          </button>
                        ))}
                        {filteredExistingMaterials.length === 0 && <div className="px-2 py-1 text-xs text-gray-400">No matches.</div>}
                      </div>
                    )}

                    {selectedParentId && (
                      <div className="mt-2 space-y-2 rounded border border-gray-200 p-2">
                        <div className="text-xs font-medium text-gray-700">{existingMaterials.find((m) => m.id === selectedParentId)?.name}</div>

                        {/* One mapping row per non-removed colour/finish
                            group above -- ci indexes into `activeColours`
                            directly so updateColour(ci, ...) hits the
                            right group (the shared editor state also used
                            by "Accept as new material"). Height/width/
                            length-increment/base-cost/multiplier for
                            every variant in the group are already shown
                            and editable in that group's table above; this
                            section only decides WHERE each group lands on
                            the chosen parent. */}
                        <div className="space-y-1.5">
                          <div className="text-[10px] font-medium uppercase text-gray-500">Colour / Finish mapping</div>
                          {activeColours.map((c, ci) => {
                            if (c.removed) return null
                            const remainingVariants = c.variants.filter((v) => !v.removed)
                            if (remainingVariants.length === 0) return null
                            return (
                              <div key={c.key} className="flex items-center gap-2 text-xs">
                                <div className="w-32 truncate text-gray-700" title={c.name || '(none)'}>
                                  {c.name || '(none)'}{c.code ? ` (${c.code})` : ''}
                                  <span className="ml-1 text-gray-400">· {remainingVariants.length} size{remainingVariants.length === 1 ? '' : 's'}</span>
                                </div>
                                <select
                                  className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs"
                                  value={c.existingColorId ?? (c.noColourFinish ? 'none' : 'new')}
                                  onChange={(e) => {
                                    const v = e.target.value
                                    if (v === 'none') updateColour(ci, { existingColorId: null, noColourFinish: true })
                                    else if (v === 'new') updateColour(ci, { existingColorId: null, noColourFinish: false })
                                    else updateColour(ci, { existingColorId: v, noColourFinish: false })
                                  }}
                                >
                                  {/* No colour/finish -- color_id NULL on the parent, no
                                      material_colors row created. Legitimate and common: a
                                      family with no colour/finish token in its name at all
                                      (e.g. "Magnet Digital 30Mil Magnum 24in"). Distinct from
                                      "+ New colour/finish" with a blank name/code, which is
                                      rejected outright (see the validation above) rather than
                                      silently creating a nameless material_colors row. */}
                                  <option value="none">No colour/finish</option>
                                  <option value="new">+ New colour/finish</option>
                                  {coloursForSelectedParent.map((ec) => (
                                    <option key={ec.id} value={ec.id}>{ec.name ?? '(none)'}{ec.code ? ` (${ec.code})` : ''}</option>
                                  ))}
                                </select>
                              </div>
                            )
                          })}
                        </div>

                        <div className="text-[10px] text-gray-400">
                          Each variant&rsquo;s height/width/length increment/default are set in the colour groups above. Mapping to an existing colour/finish moves its default if a new default is checked there (per colour, not globally).
                        </div>

                        <button
                          disabled={pending}
                          onClick={handleAddToExisting}
                          className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          {pending ? 'Saving…' : `Add ${totalActiveRowCount} row${totalActiveRowCount === 1 ? '' : 's'} to this material`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'CHANGED' && (
        <ChangedTab
          orgId={orgId}
          orgSlug={orgSlug}
          rows={rowsByStatus.CHANGED}
          materialById={materialById}
          pending={pending}
          startTransition={startTransition}
          setMessage={setMessage}
        />
      )}

      {tab === 'MIGRATED' && (
        <div className="rounded-md border border-gray-200 divide-y divide-gray-100">
          {rowsByStatus.MIGRATED.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-gray-900">{r.name}</span>
              <span className="text-gray-500">→ {r.migrated_to_material_id ? migratedNameById.get(r.migrated_to_material_id) ?? r.migrated_to_material_id : '—'}</span>
            </div>
          ))}
          {rowsByStatus.MIGRATED.length === 0 && <div className="p-4 text-sm text-gray-500">Nothing migrated yet.</div>}
        </div>
      )}

      {tab === 'DISMISSED' && (
        <div className="rounded-md border border-gray-200 divide-y divide-gray-100">
          {rowsByStatus.DISMISSED.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-gray-900">{r.name}</span>
              <button disabled={pending} onClick={() => handleRestore(r.id)} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Restore to NEW
              </button>
            </div>
          ))}
          {rowsByStatus.DISMISSED.length === 0 && <div className="p-4 text-sm text-gray-500">Nothing dismissed.</div>}
        </div>
      )}
    </div>
  )
}

const DIFF_FIELDS: { key: keyof LinkedMaterial; shopvoxKey: keyof FullRow; label: string }[] = [
  { key: 'width', shopvoxKey: 'width', label: 'Width' },
  { key: 'height', shopvoxKey: 'height', label: 'Height' },
  { key: 'sheet_cost', shopvoxKey: 'sheet_cost', label: 'Sheet cost' },
  { key: 'cost', shopvoxKey: 'cost', label: 'Cost' },
  { key: 'price', shopvoxKey: 'price', label: 'Price' },
  { key: 'multiplier', shopvoxKey: 'multiplier', label: 'Multiplier' },
  { key: 'preferred_vendor', shopvoxKey: 'preferred_vendor', label: 'Preferred vendor' },
  { key: 'part_number', shopvoxKey: 'part_number', label: 'Part number' },
  { key: 'sku', shopvoxKey: 'sku', label: 'SKU' },
  { key: 'po_description', shopvoxKey: 'po_description', label: 'PO description' },
  { key: 'info_url', shopvoxKey: 'info_url', label: 'Info URL' },
  { key: 'description', shopvoxKey: 'description', label: 'Description' },
]

function ChangedTab({ orgId, orgSlug, rows, materialById, pending, startTransition, setMessage }: {
  orgId: string; orgSlug: string; rows: FullRow[]; materialById: Map<string, LinkedMaterial>
  pending: boolean; startTransition: (callback: () => void) => void; setMessage: (m: string) => void
}) {
  const [checkedFields, setCheckedFields] = useState<Record<string, Set<string>>>({})

  function toggleField(rowId: string, field: string) {
    setCheckedFields((prev) => {
      const set = new Set(prev[rowId] ?? [])
      if (set.has(field)) set.delete(field)
      else set.add(field)
      return { ...prev, [rowId]: set }
    })
  }

  function apply(row: FullRow, material: LinkedMaterial) {
    const checked = checkedFields[row.id] ?? new Set<string>()
    const fieldsToApply: Record<string, string | number | boolean | null> = {}
    for (const f of DIFF_FIELDS) {
      if (checked.has(f.key)) fieldsToApply[f.key] = (row[f.shopvoxKey] as string | number | null) ?? null
    }
    startTransition(async () => {
      const result = await applyChangedFields({ orgId, orgSlug, shopvoxMaterialId: row.id, materialId: material.id, fieldsToApply })
      setMessage(result.error ? `Error: ${result.error}` : `Applied ${Object.keys(fieldsToApply).length} field(s) to "${material.name}".`)
    })
  }

  function dismiss(row: FullRow, material: LinkedMaterial) {
    startTransition(async () => {
      const result = await applyChangedFields({ orgId, orgSlug, shopvoxMaterialId: row.id, materialId: material.id, fieldsToApply: {} })
      setMessage(result.error ? `Error: ${result.error}` : `Dismissed — kept PrintOS values for "${material.name}".`)
    })
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const material = row.migrated_to_material_id ? materialById.get(row.migrated_to_material_id) : undefined
        if (!material) return null
        const diffFields = DIFF_FIELDS.filter((f) => (row[f.shopvoxKey] ?? null) !== (material[f.key] ?? null))
        return (
          <div key={row.id} className="rounded-md border border-amber-200 bg-amber-50/40 p-3">
            <div className="mb-2 text-sm font-medium text-gray-900">{row.name} <span className="text-gray-500">→ {material.name}</span></div>
            {diffFields.length === 0 ? (
              <div className="text-xs text-gray-500">No field-level differences detected (hash changed elsewhere — e.g. vendor pricing or tiers).</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500"><th className="w-8"></th><th>Field</th><th>ShopVOX now</th><th>PrintOS current</th></tr>
                </thead>
                <tbody>
                  {diffFields.map((f) => (
                    <tr key={f.key}>
                      <td><input type="checkbox" checked={(checkedFields[row.id] ?? new Set()).has(f.key)} onChange={() => toggleField(row.id, f.key)} /></td>
                      <td className="py-0.5 text-gray-700">{f.label}</td>
                      <td className="py-0.5 font-medium text-gray-900">{String(row[f.shopvoxKey] ?? '—')}</td>
                      <td className="py-0.5 text-gray-500">{String(material[f.key] ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="mt-2 flex gap-2">
              <button disabled={pending} onClick={() => apply(row, material)} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">Apply checked fields</button>
              <button disabled={pending} onClick={() => dismiss(row, material)} className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">Dismiss (keep PrintOS values)</button>
            </div>
          </div>
        )
      })}
      {rows.length === 0 && <div className="rounded-md border border-gray-200 p-4 text-sm text-gray-500">Nothing changed since migration.</div>}
    </div>
  )
}
