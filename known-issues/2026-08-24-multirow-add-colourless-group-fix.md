# Multi-row "add to existing material" — colour-less group fix

Branch: `fix-multirow-add-colourless-group` (off `main` at `97c4ebf`, PR #35 already merged; not
pushed to `main`). Org: `4ca12dff-97be-4472-8099-ab102a3af01a`.

## The bug, reproduced live

`Magnet Digital 30Mil Magnum` (2 rows, 1 colour/finish group = `(none)`) could not be added to its
already-migrated parent of the same name — blocked with `Name the new colour/finish "(untitled)",
or map it to an existing one.` Two independent causes, both confirmed by reading the code directly:

1. **Client-side (`actions.ts`)**: `addVariantToExistingMaterial`'s validation required
   `existingColorId` **or** a non-blank `name`/`code`. A colour-less group has neither by
   definition, so it could never pass — there was no way to *express* "no colour/finish" in the
   payload at all.
2. **RPC-side (migration 185, live)**: even if the client had sent `existing_color_id: null` with
   `name: null`/`code: null` anyway, 185's colour-resolution branch was unconditional —
   `existing_color_id IS NOT NULL → map to it, ELSE → always INSERT a material_colors row`
   (`NULLIF(v_colour->>'name', '')`, so a null name just produced a row with a null name). That is
   a structurally different thing from no colour/finish: migration 181's one-default-per-colour
   unique index buckets on `COALESCE(color_id, '00000000-...')`, so a real (nameless)
   `material_colors` row and `color_id` actually `NULL` are two different buckets that would never
   interact correctly (defaults, sort order, everything downstream keyed on `color_id`).

Rows with no colour/finish are legitimate and confirmed live — line + axis + brand only, no colour
token anywhere in the name (`Magnet Digital 20Mil Magnum 24in`, `Banner Translucent 15oz Ultraflex
Vulite Pro BL 54in`, `Film Translucent 7Mil Magic SBL-7 36in`, and the reproduction case itself).

## Migration 182 read first, mirrored exactly

`accept_family_proposal`'s rule (lines ~131–137): `colour.name IS NULL or blank → v_colour_id :=
NULL, no material_colors row created`. That's the reference behavior. 185 never adopted it for the
"existing_color_id is null" branch — it only ever had two paths (map / create-new-with-optional-
blank-name), never a genuine third "no colour at all" path. **Where 185 differs from 182,
concretely**: 182 infers "no colour" from a blank name; 185 (both before and — deliberately — still
after this fix) uses an **explicit** boolean instead of inferring it from a blank name, because
185's payload already had to distinguish three targets (map / create-new / none), and leaving one
of the three to be inferred from "name happens to be blank" is exactly the ambiguity that produced
this bug. The resulting DB shape is identical either way — `color_id NULL`, no `material_colors`
row — so a material built by Accept and a material folded in by this path are now structurally
identical, which was the explicit goal.

## The fix

**Migration 185 is already applied live and was not edited.** A new migration, 186, `CREATE OR
REPLACE`s the same function again — the same pattern 185 itself used against 183. **Proposed only,
not run — paste and run the SQL yourself**: `supabase/migrations/186_add_variant_to_existing_material_no_colour.sql`.

- New payload field per colour: `"no_colour_finish": boolean`. When `true`: `v_colour_id := NULL`
  directly, no `material_colors` INSERT at all, `name`/`code` ignored. Checked **first**, ahead of
  both the existing-colour-mapping and create-new branches, so it can never fall through to either.
- `client actions.ts` / `migrate-client.tsx`: `AddToExistingColourInput`/`EditableColourFinish`
  gain a `noColourFinish` boolean, mutually exclusive with `existingColorId` being set. The
  colour-mapping `<select>` in "Or add to an existing material" now has three options: **"No
  colour/finish"** (new), **"+ New colour/finish"**, or any existing `material_colors` row on the
  chosen parent. `buildEditableState` defaults `noColourFinish` to `true` exactly when the
  proposal's own colour group carries neither a name nor a code — so the reproduction case
  (`Magnet Digital 30Mil Magnum`) now defaults correctly with zero clicks, not just "is now
  possible to select."
- Validation (both client `actions.ts` and the pre-submit check in `migrate-client.tsx`) now
  accepts all three targets: mapped, no-colour, or named-new — only rejects the case that's
  actually invalid (neither mapped, nor no-colour, nor named).

**Every existing safeguard preserved, unchanged**, confirmed by inspection:
- Org + colour ownership validation — untouched, still runs for the `existing_color_id` branch.
- Move-an-existing-default, scoped per colour — the two queries that key off `color_id` already
  used `color_id IS NOT DISTINCT FROM v_colour_id` (NULL-safe equality) in 185, unmodified here.
  This means the no-colour-finish bucket gets correct move-default and `sort_order` behavior with
  **zero additional branching** — `v_colour_id = NULL` flows through exactly the same two queries
  a named colour's id would, and `IS NOT DISTINCT FROM NULL` correctly matches only NULL rows,
  never a named colour's rows.
- Multiplier fail-loud, 0 refused exactly like NULL — untouched.
- One transaction, all-or-nothing — untouched; the new branch is a plain `IF` inside the same loop,
  no new statement boundary.

## Verify

- **Exact reproduction**: traced through 186's resolution order for the `Magnet Digital 30Mil
  Magnum` payload (`no_colour_finish: true` on its one colour group) — hits the first `IF`
  (`v_no_colour_finish`), sets `v_colour_id := NULL`, skips both the mapping and create-new
  branches entirely, so no `material_colors` row is ever touched. Both variants insert with
  `color_id = NULL`. Client-side: `buildEditableState` defaults this group's `noColourFinish` to
  `true` (no colour name/code on the source rows), so the dropdown already shows "No colour/finish"
  selected by default and the pre-submit validation no longer blocks it.
- **A coloured family still adds correctly**: unaffected code path — `no_colour_finish` is `false`
  for any group with `existingColorId` set or a real name/code, so resolution falls through to the
  unmodified `existing_color_id IS NOT NULL` / create-new branches exactly as in 185.
- **Mixed payload** (one colour-less group + one coloured group, same call): each colour group is
  resolved independently inside the same `FOR v_colour IN ...` loop — one hits the new `IF
  v_no_colour_finish` branch, the other falls through normally; both are inserted before the loop
  ends, in the same transaction, same batch `source_row_ids` UPDATE at the end. No interaction
  between them.
- **Substrates unchanged**: `git diff main -- src/lib/material-family-proposals.ts` is **empty** —
  this fix touches only the migrate screen's "add to existing material" action and its own RPC,
  never the family-proposal parser. Substrates cannot regress; nothing in the changed surface area
  can reach `SUBSTRATE_FAMILY_CONFIG` or `buildFamilyProposals`.
- Migration 186 itself was **not executed** against production — consistent with "migrations are
  proposed only, I paste and run SQL myself." It was not possible to exercise the live RPC without
  either applying it (reserved for you) or running it in a rolled-back transaction (still a write
  against production, so also not done). In its place: the change is a single, small, additive `IF`
  branch inserted ahead of already-live, already-tested logic (185's mapping/create-new branches
  and the `IS NOT DISTINCT FROM`-based default/sort-order queries are byte-identical to what's
  running in production today), verified by direct code trace above. Three smoke tests are included
  in the migration file's comments (exact reproduction with a pre-existing NULL-colour default to
  move, mixed payload, and a "name ignored when no_colour_finish=true" guard test) for you to run
  by hand alongside the migration.
- `npx tsc --noEmit` — clean.
- `npx eslint` on both touched files — clean.
- `npm run build` — succeeds, full production build.

## Files in this PR

- `src/app/(dashboard)/dashboard/[slug]/settings/materials/migrate/actions.ts`
- `src/app/(dashboard)/dashboard/[slug]/settings/materials/migrate/migrate-client.tsx`
- `supabase/migrations/186_add_variant_to_existing_material_no_colour.sql` — **proposed only**, not
  run. Paste and run yourself. (185 stays as-is, already live — not edited.)
- This report.

No scratch scripts were created this session (no live-data verification required — the RPC change
was verified by code trace since executing it would mean applying the migration, and the client
change's only live-data dependency, the parser, has zero diff).
