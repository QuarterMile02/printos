# 2026-08-21 — Material form redesign, Part 2: Type resolution + Material Size / Packaging

## Status

**Correction to Part 1 finding A**, then the Part 2 build (Material Size + Packaging/Shipping
sections, migration 170 proposed). Part 1's finding A (`known-issues/2026-08-20-material-form-
redesign-part1-investigation.md`) is **wrong** and is superseded by this doc.

## Disputed finding A, resolved: Type is `material_type_id`, not `buying_units`

Part 1 claimed *"no column literally named `type` exists"* and that `buying_units` was
*"the real match"* for materials.type. That's wrong — it looked at the legacy, 100%-NULL
`material_type` text column and concluded no real classification field existed, missing the
actual FK column entirely.

**The live UI proves it wrong directly.** `material-form.tsx`'s Classification section renders:

```tsx
<label className={labelCls}>Type</label>
<select name="material_type_id" defaultValue={m?.material_type_id ?? ''} className={inp()}>
  <option value="">— None —</option>
  {materialTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
</select>
```

The field name is `material_type_id`, a real FK column, populated from a real `material_types`
catalog table (`[id]/page.tsx:130-137`, `.from('material_types').select('id, name')...`). This is
a completely separate field from `buying_units`, which renders in the unrelated Pricing section
(`material-form.tsx` — `<select name="buying_units">`).

**Confirmed live, full 1,788-row table** (Part 1's own queries were silently capped at 1,000 rows
by PostgREST's default row limit — re-queried here with explicit pagination and an
exact `count` to catch that):

- **`material_types` table**: 23 org-defined rows — Accessories, Artwork, Backdrop, Channel
  Letter Materials, Commercial Printing, Consumables, Digital Advertising, Digital Printing,
  Digital Screens, Electrical, Fabrication Materials, Finishing, Flags, Ink, Ink- Large Format,
  Prefabricated Cabinets, Rigid Substrates- Sheets, Roll Materials, Substrates, Table Cloths,
  Tent, Trade Show, Vacuum Form Face Outsource. Matches `data/QMI_Material_Types.csv` almost
  exactly (that reference file additionally lists Laminates, Media Player, Stock Photos —
  currently unused by any material) and matches the real ShopVOX CSV export's own `Type` column
  values exactly (`data/Material_Export_List_4526.csv`).
- **`materials.material_type_id` distribution** (all 1,788 rows, every material has one):
  Accessories 469, Roll Materials 369, Rigid Substrates- Sheets 235, Electrical 168, Consumables
  106, Fabrication Materials 99, Channel Letter Materials 54, Commercial Printing 50, Ink- Large
  Format 49, Flags 46, Digital Printing 44, Backdrop 27, Tent 19, Finishing 16, Table Cloths 12,
  Prefabricated Cabinets 6, Substrates 5, Digital Screens 4, Digital Advertising 3, Trade Show 3,
  Vacuum Form Face Outsource 2, Artwork 1, Ink 1.
- **`materials.buying_units` distribution** (a completely different value set, confirming these
  are two distinct fields, not one): Unit 760, Roll 457, Sheet 243, Box 108, Case 69, Bag 58,
  null 23, Feet 19, Gallon 19, Ream 17, Set(s) 7, Sqft 6, Yard 2.

**Answer: `materials.material_type_id` (FK → `material_types`) is the real Type field**, exactly
matching the "Roll Materials" example from the live UI. `buying_units` is a real, separate field
(how the material is bought/sold), not the classification field — Part 1's identification of it
as "materials.type" was a mistake, not a valid alternate reading.

## The build

### 1. Material Size — Type-driven labels

Type (`material_type_id` → `material_types.name`) is grouped into one of three dimension groups
via a name-match heuristic (`src/lib/material-size-labels.ts`, `dimensionGroupForType()`):

- Contains "roll" (e.g. "Roll Materials") → **Roll**
- Contains "substrate" (e.g. "Rigid Substrates- Sheets", "Substrates") → **Substrate**
- Everything else (the other 20 types — Accessories, Electrical, Consumables, Ink, ...) →
  **Unit** (the default)

**This is a deliberate, low-risk heuristic**, not a full 23-way mapping: it only special-cases the
two type families the spec names explicitly, defaulting every other type to Unit. It's a single,
easily-editable lookup (`SIZE_FIELDS`/`COST_LABEL` in that same file) if Ruben wants specific other
types bucketed differently later (e.g. "Channel Letter Materials" or "Table Cloths" as their own
group) — flagging this explicitly since it's the one interpretive call in this build, per the
instruction that "every type-driven label in this part depends on it."

**Which fields need new columns vs. reusing width/height** — only ONE new column,
`thickness`, is needed for the whole Material Size section:

| Group | Fields (in order) | Backing column | New? |
|---|---|---|---|
| Roll | Width, Length | `width`, `height` | No — `height` relabeled "Length" |
| Substrate | Height, Width, Thickness | `height`, `width`, `thickness` | `thickness` only |
| Unit | Height, Width, Depth/Thickness | `height`, `width`, `thickness` | `thickness` only (same column, reused) |
| Cost (all 3) | Roll Cost / Sheet Cost / Unit Cost | `sheet_cost` | No — label only |

Two judgment calls, both applying the same principle already established by the "Sheet Cost"
bug itself (same column, wrong label because it was never type-driven):

- **Roll's "Length" reuses the existing `height` column**, relabeled — not a new `length` column.
  A roll's length was always stored in `height`, just mislabeled. Part 1 confirmed the real
  pricing engine never reads `materials.height` at all, so relabeling it has zero live consumers
  to break.
- **Unit's "Depth/Thickness" reuses the same new `thickness` column as Substrate's "Thickness"**
  — not a second new column. Same physical concept, different label per group, avoiding two
  near-duplicate columns for one idea.
- **The Cost field is `sheet_cost` for all three groups**, just relabeled Roll Cost / Sheet Cost /
  Unit Cost. This is the literal fix for "Sheet Cost showing on a Roll material" — the column was
  never wrong, the label just never varied by Type. Confirmed this doesn't conflict with the
  existing PO-prefill fallback chain either (`src/app/api/materials/route.ts:49`,
  `buy_unit_cost: m.sheet_cost ?? ...`), which already prefers `sheet_cost` first regardless of
  buying type — reusing it for "Unit Cost" is consistent with that existing logic, not a new
  collision.

**Implementation**: `MaterialForm` (`material-form.tsx`) is a Server Component with no client
interactivity of its own (same as before this change). The Type select had to move out of the
Classification section into a new client component, `material-size-fields.tsx`
(`MaterialSizeFields`), which owns both the Type `<select name="material_type_id">` and the three
dynamically-labeled size inputs, so changing Type relabels the fields live, without a save+reload
round trip — same "self-contained client subcomponent embedded in a Server Component form"
pattern already used by `UnitsOfBusinessSelect`. Classification now holds only Category (Type
moved next to the fields it drives, which is more discoverable than leaving it next to Category).

### 2. Packaging / Shipping — its own section

Per Part 1's confirmation that `unit_width`/`unit_height` are the packaging pair (zero readers
outside their own detail-view display), repurposed as:

- Height = `unit_height` (existing)
- Width/Length = `unit_width` (existing)
- Depth = **new** `unit_depth` column (matches the existing `unit_` prefix convention)
- Weight / Weight UOM = `weight` / `weight_uom` (existing columns, just moved here — Part 1
  finding D: one column pair, 258/1,788 populated, no readers outside the material form/detail
  view, safe to move)

No type-driven labels needed here — packaging dimensions apply the same way regardless of
Material Size group.

### 3. Migration 170 — proposed only

`supabase/migrations/170_material_size_and_packaging_columns.sql` — **two** `ALTER TABLE`
statements (`materials.thickness numeric(10,4)`, `materials.unit_depth numeric(10,4)`), each in
its own paste block with its own `information_schema.columns` verification query underneath, per
instruction ("one statement per paste... information_schema, not the success message"). Not run —
Ruben pastes each into the Supabase SQL Editor separately.

**Defensive write, since migration hasn't landed yet**: `thickness`/`unit_depth` are written to
the *same* `fields` object as every other `materials` column in `actions-sr.ts`'s `saveMaterial`
— unlike the `material_product_types` junction table (a separate query, already wrapped in its
own try/catch), a missing column in this object would fail the *entire* material save, not just
these two values, blocking every material edit/create until the migration runs. Added the same
`"does not exist"` retry fallback already used elsewhere in this codebase for pending-migration
columns (`quotes.converted_to_so_id` in `convert-action.ts`, `rescue_flag`/
`needs_manager_approval` elsewhere): on that specific error, retry once with `thickness`/
`unit_depth` stripped from the payload, so the rest of the material still saves. Once Ruben runs
migration 170, the first attempt succeeds and the fallback path never triggers.

### 4. Import-boundary impact: **no changes needed**

Checked `src/lib/material-import-mapper.ts`'s `HEADER_MAP` against the real ShopVOX export sample
(`data/Material_Export_List_4526.csv`, 48 header columns) — confirmed there is no "Length",
"Thickness", or "Depth" column anywhere in ShopVOX's actual export. ShopVOX does not capture this
data at all, so there is no CSV header to map and nothing to "silently skip" — a mapper fix isn't
possible here because there is no source column to point it at.

Practical effect at the next re-scrape:

- `width` / `height` / `sheet_cost` / `weight` / `weight_uom` continue to import exactly as they
  do today, completely unaffected by this change — this PR only changes their **display label and
  form section**, not the underlying columns or the import mapper's field names.
- `thickness` / `unit_depth` will be **NULL for every re-scraped material**, same as
  `unit_width`/`unit_height` already are today (also confirmed to have zero CSV header mapping,
  per Part 1) — these are, and will remain, manually-entered-only fields. This is not a
  regression introduced by this change; it's an inherent gap in what ShopVOX exports.

If Ruben wants `thickness`/`unit_depth` populated in bulk rather than one material at a time,
that would need a separate data source (e.g. a supplemental CSV Ruben provides) — out of scope
here, flagged for a future pass if needed.

## Explicitly not done

Per instruction: `materials.width`/`.height` still aren't read by `calculateProductPrice()` (the
real pricing engine) — that's Part 1 finding B, a real bug, tracked on the blocker list, and
deliberately untouched by this PR.

## Related

- `known-issues/2026-08-20-material-form-redesign-part1-investigation.md` — findings A (superseded
  by this doc), B, C, D.
- `known-issues/2026-08-21-material-units-of-business.md` — the Units of Business dropdown
  (product_types), unrelated field, built in the prior PR.
- `src/lib/material-size-labels.ts`, `material-size-fields.tsx`, `material-form.tsx`,
  `actions-sr.ts`, `[id]/page.tsx`, `supabase/migrations/170_material_size_and_packaging_columns.sql`
  — the files touched by this PR.
