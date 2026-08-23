# Roll length is a variant, not a family identity + multi-row "add to existing" — build report

Branch: `roll-length-variant-and-multirow-add` (off `main` at `e7c96e2`, not pushed to `main`).
Org: `4ca12dff-97be-4472-8099-ab102a3af01a`. All counts below are from live, paginated queries
run today against `shopvox_materials` — no query used could have silently truncated at
PostgREST's 1000-row cap.

---

## Fix 1 — roll length is a variant, not a family identity

**Root cause** (`src/lib/material-family-proposals.ts`, `ROLL_WIDTH_X_LENGTH_RE`): the length
side of the `<width> x <length>` token only recognized `in`/`"`. A name like `24in x 10yds` only
matched `24in`; the dangling ` x 10yds` leaked past size extraction into the colour/brand parse,
so it ended up baked into `brand` — and since two different lengths of the *same* product produce
two different leaked strings, they landed in different grouping keys and split into separate
families. Confirmed live on exactly the two cases named in the brief:

- `Vinyl Intermediate ... 2.5Mil Oracal 651 24in x 10yds` (already migrated) vs `... 24in x 50yds`
  (still NEW) — two families for one product.
- `Magnet Digital 30Mil Magnum 48in x 25ft` vs `... 48in x 50ft` — two families for one product
  (the brief's Magnet example; see "Magnet 30Mil collapse" below for the live-data specifics,
  which differ slightly from the brief's recollection).

**Fix**: `ROLL_WIDTH_X_LENGTH_RE`'s length side now also accepts `ft`/`yd`/`yds`. A new
`rollLengthToInches(value, unit)` converts before storage: `ft ×12`, `yd`/`yds ×36`, `in`/`" ×1`.
The whole `<width> x <length>` token (both sides) is stripped from the name before line/brand
computation — structurally, not via an added filter — so length can never leak into the family
name or brand, by construction. If no width×length token exists, extraction falls through to the
bare-width regex and then the DB `width` column exactly as before this fix (untouched code paths,
confirmed by diff below). No length is ever invented.

**Diff scope** (`git diff origin/main -- src/lib/material-family-proposals.ts`): every changed
line is inside `ROLL_FAMILY_CONFIG.extractSize`'s width×length branch and its two supporting
constants. `SUBSTRATE_FAMILY_CONFIG`, `buildFamilyProposals`, `parseRemainder`,
`computeLcpWordCount`, and the bare-width/DB-fallback branches are byte-identical to `origin/main`.
`src/lib/material-migrate-proposals.ts` (cut-to-length / `length_increment` logic) and
`src/lib/roll-axis-regex.js` have **zero** diff against `origin/main` — confirmed with
`git diff origin/main -- <file>` returning empty for both, not assumed.

### Live dry-run: before vs after, current 126 NEW Roll Materials rows

**Note on row count**: the brief referenced "132 remaining rows" / "104 families" from an earlier
session. Live, paginated re-query today shows **126** NEW Roll Materials rows against **99**
pre-fix families — six fewer rows and five fewer families than recalled, consistent with rows
continuing to get migrated between sessions. The numbers below are the live-verified ones, not the
recalled ones.

| | Families | Rows |
|---|---|---|
| **Pre-fix (`origin/main`)** | **99** (39 high / 12 medium / 48 low) | 126 (57 / 21 / 48) |
| **Post-fix (this branch)** | **93** (39 high / 13 medium / 41 low) | 126 (61 / 24 / 41) |

Family count dropped by 6, as required. Every row is still accounted for on both sides (126 = 126).

### Every family whose row-id membership actually changed (3)

Computed by comparing row-id *sets* per family, not by label text (label text changed for more
families than membership did — see next section) — this is the precise "did rows actually get
regrouped" answer:

| Family (post-fix name) | Confidence | Rows | What it was pre-fix |
|---|---|---|---|
| Magnet Digital 30Mil Magnum | low → **high** | 1+1 → **2** | Two separate 1-row singletons (`48in x 25ft`, `48in x 50ft`) |
| Vinyl Heat Transfer Digital 3Mil | low → **high** | 1+1+1+1 → **4** | Four separate 1-row singletons (`x 5yds`, `x 10yds`, `x 25yds`, `x 50yds`) |
| Wall Covering Dream Scape Sandblast | low → **medium** | 1+1+1 → **3** | Three separate 1-row singletons (`x 75ft`, `x 150ft`, `x 300ft`) |

These three account for the entire 6-family drop (3 real merges removing 1+3+2 = 6 pre-fix
singleton families and adding back 3 merged families = net −6, 99 → 93 — reconciles exactly).

### Magnet 30Mil collapse — confirmed specifically

**Live data differs from the brief's recollection**: today there is no single "Magnet 30Mil" line
split into three. There are two distinct products under that thickness:

- `Magnet with Adhesive 30Mil 24in` — a **different product line** ("with Adhesive", no brand,
  no length token), correctly its own singleton both before and after this fix. Not part of the
  bug — it was never mis-split by the length-token issue.
- `Magnet Digital 30Mil Magnum` at two lengths (`48in x 25ft`, `48in x 50ft`) — **this is the real
  collapse**, confirmed above: 2 singleton families → 1 family, 2 size variants. This is the live
  instance of the exact bug pattern described in the brief.

### The blocking family — Oracal 651 2.5Mil x 50yds

`Vinyl Intermediate 2.5Mil Oracal 651` (12 rows) was **already one family pre-fix** — all 12 rows
happened to carry the identical leaked suffix `x 50yds`, so they still shared one grouping key by
coincidence, just under the corrupted name `"...Oracal 651 x 50yds"`. Membership didn't change;
what changed:

- **Family/brand name**: `"...Oracal 651 x 50yds"` → `"...Oracal 651"` — clean, matches the
  already-migrated "x 10yds" material's name (mod length), so `suggestParentMaterials` can now
  actually surface it as a suggested parent (it matches on `line`/`axisValue`/`categoryName`,
  which were previously polluted).
- **Per-variant `sizeLabel`**: `"24in"` (bare width, length silently dropped from display) →
  `"24in x 50yds"` (full token, matching the source row).
- **Height value**: unchanged numerically for this specific family — the DB `height` column on
  these 12 rows already held the correct inches-equivalent (1800) from a prior process, so the
  pre-fix DB-fallback path happened to produce the right number by luck, not by design. Confirmed
  by direct inspection of `row.height` for all 12 rows: 1800 in every case, matching
  `50yds × 36 = 1800`. Fix 1 makes this derivation robust (computed from the name token itself)
  rather than dependent on the DB column happening to be pre-populated correctly — a row with a
  NULL or wrong DB `height` and a text length token now parses correctly where it previously would
  not have.

This is exactly the family Fix 2 needs to attach onto the already-migrated 10yd material.

---

## Fix 2 — a multi-row family can be added to an existing material

### Migration 183, read first — does it handle multi-row/multi-colour?

**No.** Confirmed by reading it directly (not assumed): its payload is exactly one colour + one
variant + one `source_row_id`. Calling it once per row for a 12-row family would be 12 separate,
non-atomic transactions — if row 7 of 12 failed (e.g. a missing multiplier), rows 1–6 would
already be committed. That's the exact failure this closes.

### Migration 185 (proposed, NOT run — paste-and-run SQL)

`supabase/migrations/185_add_variant_to_existing_material_multirow.sql` — `CREATE OR REPLACE` on
`add_variant_to_existing_material(payload jsonb)`, same function name (this app's `actions.ts` is
the only consumer, updated in this same PR, so this is safe). New payload nests `colours[] →
variants[]`, mirroring `accept_family_proposal`'s (182) shape for consistency. One transaction for
the entire call — every colour and every variant lands, or none does.

Every safeguard from 183 survives, scoped **per colour**, not once per call:
- org + colour ownership validation (colour must belong to `material_id`, `material_id` must
  belong to `organization_id`)
- move-an-existing-default — only for a colour that has a variant explicitly claiming
  `is_default = true` in this call, scoped per-(material, colour) per migration 181's unique index
- **fail-loud multiplier, extended**: `multiplier IS NULL OR multiplier = 0` both raise. A
  multiplier of 0 is refused exactly like NULL now, per instruction — real motivating case: the
  16 Channel Letter rows found earlier with a real cost and `multiplier = 0`, which would
  otherwise silently produce a real $0.00 sell price.

All source rows across every colour/variant in the call are collected into one array and
batch-`UPDATE`d against `shopvox_materials` (`migrated_to_material_id`, `migrated_at`,
`migrated_source_hash = source_hash` read live) in a single statement at the end — not per-row.

Includes three smoke tests in the migration file comments (multi-colour add across 5 variants,
multiplier=0 rejection, partial-rollback proof across two colours) for you to run by hand if you
want extra confidence before applying it live.

### Client changes

- `actions.ts`: `AddToExistingMaterialInput` now carries `colours: AddToExistingColourInput[]`
  (each with its own `existingColorId`/`name`/`code`/`variants[]`) instead of one flat shape.
  Same per-colour validation `acceptSubstrateProposal` already uses (empty check, `defaultCount >
  1` check). Returns `{ materialId }` — there's no longer a single "the" variant for a multi-row
  call.
- `migrate-client.tsx`: the singleton-only gate (`isSingleton && singletonRow`) is gone. "Or add
  to an existing material" now renders for **any** proposal, any row count — same shared
  `activeColours` editor state "Accept as new material" already uses (adds one field,
  `existingColorId`, used only by this action). Suggested parents (`suggestions`) no longer gate
  on `!isSingleton` either — `suggestParentMaterials` never looked at row count, the gate was the
  only thing stopping a multi-row family from getting suggestions.
- The old single-colour radio-button + manual height/width/length-increment/base-cost/multiplier
  entry table is gone — those values are already editable per-variant in the colour groups above
  (same table "Accept as new material" uses), so **every** variant sends its own real cost and
  multiplier from its own source row, never a shared/guessed value. The new UI is one mapping
  row per non-removed colour/finish group: map it to an existing `material_colors` row on the
  chosen parent, or create it fresh (`+ New colour/finish`). Submit button reads "Add N row(s) to
  this material" with the real total.
- Every row in the family goes into **one** call to `addVariantToExistingMaterial` (migration
  185's colours→variants payload) — all-or-nothing, whether the proposal is a singleton or a
  12-row family.

### Already-migrated materials — untouched, confirmed

- Fix 1 only affects `buildFamilyProposals`, which `page.tsx` calls exclusively over rows with
  `status = 'NEW'` (`newRows = typedRows.filter(r => r.status === 'NEW')`). Already-migrated rows
  never pass through the changed code at all.
- Fix 2's RPC (185) only `INSERT`s new `material_colors`/`material_variants` rows and `UPDATE`s
  `shopvox_materials` for the `source_row_id`s explicitly in the call's own payload. It never
  updates or deletes any pre-existing `material_variants`/`material_colors` row except the
  explicit, guarded, per-colour default-move (`is_default = false`) — which only fires when the
  new payload itself claims a new default for that same colour, never as a side effect. No
  already-migrated `shopvox_materials` row is ever touched, since those IDs are never in the
  payload being submitted.

### Cut-to-length / `length_increment` — untouched, confirmed

`git diff origin/main -- src/lib/material-migrate-proposals.ts` (where `extractCutToLengthWidth`
lives) returns **empty**. Neither fix touches that file. `ROLL_FAMILY_CONFIG.extractSize` still
passes `lengthIncrement: null` unchanged in the width×length branch; the bare-width and DB-fallback
branches are untouched.

---

## Substrates — regression check

**Cannot be re-run live the same way as before**: all 235 substrate (`Rigid Substrates- Sheets`)
rows are now migrated — **0 NEW rows remain**, confirmed by a direct paginated count. There is no
live NEW-row data left to feed through `buildFamilyProposals`/`SUBSTRATE_FAMILY_CONFIG` to
reproduce the 96/69/4/23 baseline.

Verified at the code level instead: `git diff origin/main -- src/lib/material-family-proposals.ts`
shows every changed line lives inside `ROLL_FAMILY_CONFIG.extractSize`'s width×length branch and
its two supporting constants (`ROLL_WIDTH_X_LENGTH_RE`, `rollLengthToInches`).
`SUBSTRATE_FAMILY_CONFIG`, `buildFamilyProposals`, `parseRemainder`, and `computeLcpWordCount` are
byte-identical to `origin/main`. Since substrates only ever call `SUBSTRATE_FAMILY_CONFIG` and
never touch `ROLL_FAMILY_CONFIG` or its helpers, this is a structural guarantee, not an inference.

---

## Verification run this session

- `npx tsc --noEmit` — clean, whole project.
- `npx eslint` on all three touched files — clean.
- `npm run build` — succeeds, full production build.
- Live dry-run comparison (pre-fix `origin/main` parser vs this branch's parser, same 126-row live
  dataset) — see tables above.
- Live substrate NEW-row count check — 0, code-diff-based regression proof used instead (above).

## Scratch files

All temporary scripts used for the live dry-run/comparison (`scripts/_tmp_roll_dryrun_verify.mjs`,
`scripts/_tmp_roll_dryrun_compare.mjs`, `scripts/_tmp_inspect_variants.mjs`,
`scripts/_tmp_substrate_regression_check.mjs`, and their `scripts/_tmp_dryrun/` output directory)
read `SUPABASE_SERVICE_ROLE_KEY` and have been deleted before this PR opens — not committed.

## Files in this PR

- `src/lib/material-family-proposals.ts` — Fix 1.
- `src/app/(dashboard)/dashboard/[slug]/settings/materials/migrate/actions.ts` — Fix 2 server action.
- `src/app/(dashboard)/dashboard/[slug]/settings/materials/migrate/migrate-client.tsx` — Fix 2 UI.
- `supabase/migrations/185_add_variant_to_existing_material_multirow.sql` — **proposed only**, not
  run. Paste and run yourself.
- This report.
