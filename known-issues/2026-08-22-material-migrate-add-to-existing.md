# 2026-08-22 — Migrate screen: Add to existing material, suggestions, Dismiss

## Status

PROPOSED migrations only (183, 184) — nothing run. Per instruction, migrations
179, 181, and 182 are already live in production; this build does not assume
anything else in `supabase/migrations/` is unapplied either — 183 and 184 are
purely additive on top of whatever's already live.

## 1. Add to existing material

New Postgres function `add_variant_to_existing_material` (migration 183), same
one-transaction reasoning as `accept_family_proposal` (182) — PostgREST has no
client-side multi-statement transaction API, so creating the colour (if new),
inserting the variant, and updating `shopvox_materials`' migration link only
have atomicity if they're one function call.

Same `multiplier` fail-loud rule as 182, for the same reason: `material_variants.
multiplier` is `NOT NULL` (migration 173), so a missing value can't be "left
NULL" — the function raises explicitly, before attempting the insert, naming the
dimensions so the error is legible.

`is_default` + migration 181's one-default-per-(material, colour) index: the
function only moves an existing default when the new variant explicitly claims
`is_default: true` — a plain "add a size" never touches another variant's
default, matching "must not also be default unless he explicitly moves it."

UI: `migrate-client.tsx` gates this section to **true singletons only**
(`proposal.sourceRowIds.length === 1`) — a multi-row family has already grouped
several rows into one proposed material; this targets the leftover-singleton
workflow specifically, matching how the RPC is shaped (one colour, one variant,
one source row per call).

## 2. Suggested parent materials

`src/lib/material-parent-suggestions.ts` — pure ranking function, no DB access.

Category match is a **hard gate**, not a soft-weighted signal: a candidate is
only considered when it shares the row's `category_id` AND has at least one word
in common with the row's parsed line. Category alone was deliberately rejected
as sufficient — an org can have dozens of materials in one category (e.g.
"Acrylic"), and suggesting all of them on a bare category match would be exactly
the noise the instruction warned against ("a bad suggestion he trusts is worse
than no suggestion"). Within the gate, name similarity (Dice coefficient over
normalized words) is the primary ranking driver; an exact thickness match is a
smaller tiebreaker bonus — matching the stated priority order (line/category
first, name similarity next, thickness proximity last).

**Not validated against real accepted-material data** — none exists yet (the one
real accept from the first Build 1b test was unwound before this was built).
The algorithm is reasoned from the instruction and the parser's own established
conventions, not spot-checked against live suggestions the way the family
grouping was. Worth a real look once a handful of families have actually been
accepted.

## 3. Dismiss / DISMISSED tab

Migration 184: `shopvox_materials.dismissed_at timestamptz` + the generated
`status` column dropped and re-added with `DISMISSED` checked first (ahead of
NEW/MIGRATED/CHANGED) — Postgres has no `ALTER COLUMN` for a generated column's
expression, only drop-and-recreate; the migration's own paste steps say this
explicitly and warn the three statements (drop index → drop column → re-add
column → recreate index, actually 5 statements) need to be pasted in one
sitting, since the table has no `status` column at all in between.

Reversible: `dismissed_at = null` restores a row to whatever status it would
otherwise read as (normally NEW). Its own DISMISSED tab, alongside NEW/CHANGED/
MIGRATED, so nothing is silently hidden — visible in a dedicated place, not gone.

## An important caveat for first use

The "existing materials" picker and the suggestion engine both derive their
candidate list from `shopvox_materials.migrated_to_material_id` — i.e. only
materials actually created **through this migrate screen** (accept or a prior
add-to-existing), never the ~235 original flat legacy materials the ShopVOX
scrape wrote directly (Build 1 Finding B) — those are the source data being
consolidated, not valid merge targets.

Since production currently has **zero** such materials (the one real accept was
unwound per the bug report this build follows), the picker and every suggestion
list will show empty/"no likely parent" until at least one family has actually
been accepted successfully. This is expected, not a bug — flagging it now so it
isn't mistaken for one on first real use.
