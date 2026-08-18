# 2026-08-19 — product_categories.primary_department has no editing UI anywhere

## Status

**Open, not fixed, no code changed.** Smaller finding surfaced while auditing Settings → Product
Categories for the same orphaned-feature pattern as `general_categories`. Product Categories itself
is genuinely consumed (products catalog dropdown/display, quote material-selection logic) — not an
orphaned feature. This is a narrower, separate gap on one specific column.

## What it is

`product_categories.primary_department` (added in `supabase/migrations/045_jobs_department_column.sql`,
a `text` column with a `CHECK` constraint restricting it to a fixed set of department codes) is read
by `src/lib/jobs/resolve-departments.ts` — real job-routing logic that determines which department(s)
a job's line items should be routed to, based on the product category's `primary_department`.

## The gap

Confirmed via a grep of every file referencing `primary_department`: the only two places it's
touched are its own migration (which sets it via seed/migration SQL) and `resolve-departments.ts`
(which reads it). **The Settings → Product Categories page itself — the natural place to manage
this — never exposes or writes this column.** Its own `page.tsx`/`actions-sr.ts` only read/write
`id, name, product_type_id, is_active`. There is no UI anywhere in the app to set or change which
department a product category routes jobs to.

Practically: today, `primary_department` values only get set via direct SQL/migration/seed. If QMI
adds a new product category through the settings page (which works fine for `name`/`product_type_id`/
`is_active`), that new category has no `primary_department` and any job routing logic depending on it
falls through to whatever `resolve-departments.ts` does for a null value — worth checking that
fallback is sensible, separate from this write-up.

## Not an orphaned-feature question

Unlike `general_categories`/`custom_notes`, `primary_department` is genuinely consumed — this isn't
"nothing reads it," it's "something reads it but nothing writes it from the UI." Different shape of
gap: a real, load-bearing feature with a missing admin surface for one of its inputs.

## Open question for Ruben — not resolved here

Worth adding a `primary_department` field to the existing Product Categories settings form (small,
contained addition to an already-consumed page), or is department routing meant to be managed some
other way entirely? Not decided or built here — flagging the gap only.

## Related

- `src/lib/jobs/resolve-departments.ts` — the real consumer.
- `supabase/migrations/045_jobs_department_column.sql` — column definition and CHECK constraint.
- `src/app/(dashboard)/dashboard/[slug]/settings/product-categories/` — the settings page that
  manages every other column on this table except this one.
