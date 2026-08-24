# `accept_family_proposal` — multiplier = 0 gap, closed

Branch: `accept-family-proposal-multiplier-zero` (off `main`, PR #37 already merged; not pushed to
`main`). Org: `4ca12dff-97be-4472-8099-ab102a3af01a`.

**Migration 187 is proposed only, not run.** No `src/` changes — this is a pure SQL fix, so
substrates and rolls are unaffected by construction (nothing under `src/lib/` was touched).

## The bug, confirmed live

`Roodle` was accepted through "Accept as new material" and landed with `multiplier = 0` on both
the material and its one variant — a real, non-error $0.00 sell price. `accept_family_proposal`
(182)'s multiplier check only tested `IS NULL`. Migrations 185/186 added "0 is treated exactly
like NULL" to `add_variant_to_existing_material`, but that guard was never retrofitted into 182 —
the MAIN accept path (every "Accept as new material" click). One door had the guard, the other
didn't.

## The fix (migration 187, `CREATE OR REPLACE` — 182's file is untouched)

Read 182 in full and 186 for the exact established wording first, mirrored here, not reinvented.
Diffed the two function bodies directly (not eyeballed) to confirm the change is exactly what was
asked and nothing else:

1. **Variant-level** (extends the existing check): `multiplier IS NULL OR multiplier = 0` now both
   raise — same message shape as 186, naming the colour and the size.
2. **Material-level** (new — 182 never had any multiplier check here at all): if the payload
   explicitly carries `material.multiplier = 0`, refused. `materials.multiplier` stays nullable —
   `NULL` is still legal and unchanged, exactly as 182's own header comment established
   deliberately. Only an explicit `0` is new-refused, not "unset."

Nothing else changed. `diff` against 182's function body shows exactly these two added blocks and
the two touched comment lines — every INSERT, the vendor_seed handling, and the final
`shopvox_materials` UPDATE are byte-identical to the already-applied, ~1,700-rows-proven 182 body.

## Blast radius — checked live, not estimated

`materials.multiplier = 0` returns **44 rows** org-wide today. Cross-referenced every one against
`shopvox_materials.migrated_to_material_id` (`status = 'MIGRATED'`) to find which were actually
created by `accept_family_proposal`, versus the pre-existing legacy materials the original ShopVOX
scrape wrote directly into `materials` (confirmed separately in the orphan-materials investigation)
— this function was never involved in creating those, so they cannot be part of this fix's blast
radius no matter what:

**41 of 44 are pre-existing legacy materials** — no `shopvox_materials` row points at them at all.
Unrelated to this migration.

**Exactly 3 of 44 were created by `accept_family_proposal`** — these are the only materials this
fix's *variant-level* check would have refused if it had been live at accept time:

| Material | id | Source ShopVOX row |
|---|---|---|
| Roodle | `08c23699-29a6-47f2-bbd3-70807dee6b85` | Roodle Matte White Removable 54" x 100" |
| Trimp Cap | `8d8e5adf-0d3a-49b1-89af-a4c9b4697363` | Bronze 313 / Trimp Cap |
| Trimp Cap | `7e432e0c-02c2-4c83-b16a-d270a1f94d04` | Teal / Trimp Cap |

The two "Trimp Cap" ones are real, previously-unreported instances of exactly the risk flagged in
the Channel Letter investigation report (those two rows were listed there as "will be REFUSED by
the accept path" under the *old*, un-fixed 182 — they weren't refused, because 182 had no guard at
all at the time they were accepted).

All 3 have **both** their material-level multiplier and their one variant's multiplier at exactly
`0` — cross-checked the other direction too: `material_variants.multiplier = 0` returns only 3 rows
org-wide, and they belong to these same 3 materials. No case exists, live, of a real material-level
multiplier hiding a zero-multiplier variant, or the reverse — the material-level check adds zero
*additional* blast radius beyond the variant-level check; both single out the identical 3 rows.

## This migration cannot affect any already-migrated row

A `CREATE OR REPLACE FUNCTION` changes what happens the next time the function is *called* — it
does not re-run against, re-validate, or touch any row a previous call already wrote. The 3
materials above keep existing, keep their $0 sell price, exactly as they are today, until someone
explicitly fixes or replaces them — that's a separate, manual decision, not something this
migration does. Nothing under `src/` changed either, so nothing about how already-migrated data is
*read* changes.

## Grants — `REVOKE ALL ... FROM PUBLIC`

Checked, not assumed: `REVOKE ALL ... FROM anon` alone is a real theoretical gap in general Postgres
semantics — revoking from one specific role doesn't remove access that role would otherwise have
via an `EXECUTE` grant to `PUBLIC` (every role implicitly has whatever `PUBLIC` has). Tested this
live with the project's own anon key against both `accept_family_proposal` and
`add_variant_to_existing_material`:

```
anon.rpc('accept_family_proposal', {})            -> 42501 permission denied for function accept_family_proposal
anon.rpc('add_variant_to_existing_material', {})  -> 42501 permission denied for function add_variant_to_existing_material
```

**Anon currently has no access to either function.** This is most likely Supabase's own default
schema privileges (which revoke `PUBLIC` execute on newly created `public`-schema functions by
default) doing the work, not something this project explicitly configured — an inference from a
platform default, not a guarantee this migration should quietly depend on holding forever.
`REVOKE ALL ON FUNCTION accept_family_proposal(jsonb) FROM PUBLIC;` is added to 187 (before the
existing anon revoke, so the anon revoke reads as explicit belt-and-suspenders documentation, not
as the only thing doing the work) — costs nothing, removes the dependency on the platform default,
and makes the intended posture explicit in the migration itself.

`add_variant_to_existing_material` (185/186) has the identical theoretical gap and the identical
live-tested current safety — **not touched by this migration**, since this migration's scope is
`accept_family_proposal` only. Flagged here for you to decide separately whether it's worth a
matching hardening migration.

## Files in this PR

- `supabase/migrations/187_accept_family_proposal_multiplier_zero.sql` — **proposed only**, not
  run. Paste and run yourself. (182 stays as-is, already live — not edited.)
- This report.

No scratch scripts left over — both investigation scripts (blast-radius query, live anon-grant
test) read `SUPABASE_SERVICE_ROLE_KEY`/the anon key and have been deleted.
