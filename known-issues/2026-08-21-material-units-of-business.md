# 2026-08-21 — Units of Business on materials: investigation + junction table + multi-select

## Status

**Investigated first, as instructed. Entity identified with confidence (not assumed). Junction
table + multi-select built. The export itself is NOT built** — separate, later piece, per
instruction.

## a) Does a "unit of business" entity exist today? Where?

**No — not as its own thing. The real entity for this is `product_types`.** Checked every
candidate named, plus one not named, rather than assuming any of them:

- **`departments` (14 seeded rows, real table)** — used for job/crew routing
  (`jobs.department`, plain text, CHECK-constrained to these codes — not an FK) and
  `product_categories.primary_department`. Already has an exact junction-table precedent for
  this exact shape: `labor_rate_departments`/`machine_rate_departments` (migration 070), live
  and wired (checkbox list on the labor/machine rate forms). **Wrong semantic fit anyway** —
  it includes pure workflow stages with no revenue meaning at all (`installation`,
  `service_repair`), and its snake_case codes (`large_format`, `commercial_print`) don't match
  the QuickBooks account names Ruben cited.
- **The "8 units of business" on the TV Management Board** — `MANAGEMENT_UNITS` in
  `src/app/(dashboard)/dashboard/[slug]/display/board-config.ts`. **Not a database entity at
  all** — a hardcoded array grouping a *subset* of the 14 department codes into 8 display
  buckets for one screen (e.g. `ILLUMINATED SIGNS: [channel_letters, fabrication]`). Confirms
  the task's own suspicion: this 8-count and `departments`' 14-count don't reconcile because
  they were never the same thing — one is real data, the other is a hardcoded display grouping
  of most (not all) of it.
- **`general_categories` with a `sub_type`** — real table, real `sub_type` column (migration
  089), but its actual sub_types are `industry`, `lead_source`, `machine`, `note`,
  `pricing_level`, `tag` — a tagging taxonomy for quotes/jobs/assets, per its own header
  comment. Nothing related to revenue/business-unit classification. (Already flagged
  separately as its own orphaned-feature concern —
  `known-issues/2026-08-19-general-categories-orphaned-feature.md` — unrelated finding, same
  table.)
- **`product_types` (13 seeded rows, real table, migration 067) — the answer.**
  `products.product_type_id` already exists as a single FK, satisfying *"a product belongs to
  ONE unit of business"* exactly, with no schema change needed on the product side. Its seeded
  names — **"Signs / Large Format Printing", "Fleets / Vehicle Wraps", "Commercial Printing"**,
  plus Illuminated Signs, Electrical, Apparel, Branding, Digital Advertising, Digital
  Marketing, Direct Mail, Material Resale, Promotional/Outsource, Asset — directly match
  Claudia's QuickBooks Item List income-account split (**4200 Signs / Large Format, 4300
  Commercial Printing, 4600 Fleets / Vehicle Wraps**) far more precisely than `departments`'
  codes do. Confirmed live and actively maintained, not orphaned: editable per-product via a
  real `<select>` on the product form, with its own Settings → Product Types management page
  that tracks usage counts.

**`departments` is real but is the wrong entity for this feature — `product_types` is the
right one**, despite not being named "unit of business" anywhere in the schema. Do not
conflate the two going forward; they serve different purposes (workflow routing vs. revenue
classification) even though several of their labels sound similar.

## b) Junction table + multi-select — built

`materials` had no product-type link of any kind before this (confirmed: no `product_type_id`
or equivalent column exists on `materials`). Added:

- **`material_product_types`** (migration 169, PENDING — same "Ruben runs it manually"
  convention as everything else this week): `material_id`, `product_type_id`,
  `organization_id`, unique on `(material_id, product_type_id)`. Exact same shape as the
  `labor_rate_departments`/`machine_rate_departments` precedent, just keyed by
  `product_type_id` instead of `department_id`.
- **Multi-select on the material form** — new "Units of Business" section, checkbox list over
  every active `product_types` row, same pattern as the existing "Departments" checkboxes on
  the labor/machine rate forms. Wired into `saveMaterial()`: delete-then-insert the junction
  rows from `product_type_ids` on every save, alongside the material's own fields.
- **Fails soft, not hard, until the migration runs**: both the read (material edit page) and
  write (`saveMaterial()`) sides of the new table use best-effort error handling rather than
  throwing, specifically because this table doesn't exist in production until Ruben applies
  migration 169 — without that, editing any material would otherwise break entirely on a
  "relation does not exist" error the moment this code deploys.

## c) How would the monthly export know CONSUMED vs. in inventory?

**This data doesn't exist today — confirmed, not assumed, exactly as predicted.** Searched for
any consumption-log, inventory-transaction, or material-usage table — none exists anywhere in
the schema. What materials-side inventory tracking DOES exist:

- `materials.current_stock` / `min_stock_level` / `reorder_quantity` — a **static, manually
  maintained snapshot** (edited via the `materials.edit_inventory` permission gate on the
  material form), stamped with `last_inventory_count_at` when someone updates it by hand.
  Read by `LowStockWidget` and the roll-selection engine
  (`smart-material-engine.ts`) — nothing writes to it automatically, and nothing decrements it
  when a job actually consumes material.
- No job, quote, or PO write path adjusts `current_stock` on production or receiving. There is
  no per-transaction record anywhere of "job X used Y sqft of material Z on date D."

**The only proxy available today** would be inferring consumption from
`jobs`/line-items → `products` → `product_default_items` → `materials` for jobs completed
within the export period — i.e., "this material appears in the recipe of a product that shipped
this month." That's a real approximation, not real consumption data: it can't account for
actual quantity used (recipe membership isn't quantity), waste, partial jobs, or materials
purchased via a PO and sitting in inventory unused. Building the export on top of that proxy
without saying so would misrepresent what the number means.

**What would actually be needed**, for whoever picks this up: a job-material-consumption log
written at production time (or at minimum at job-completion time) recording
`material_id, quantity, job_id, date` — new plumbing, not a query rewrite. Reported per
instruction; not built.

## Not built (deliberately, per instruction)

**The QuickBooks export itself.** This piece only lays down the classification data
(material → one-or-more units of business) the export will need. Building it also requires
resolving (c) above first, or it would allocate cost using a proxy the export's own consumer
(accounting) wouldn't be told is approximate.

## Related

- `supabase/migrations/169_material_product_types_junction.sql` — the new junction table, with
  the full candidate-elimination reasoning in its own header comment.
- `supabase/migrations/070_rate_departments_junction.sql` — the precedent this mirrors.
- `supabase/migrations/067_product_types_categories.sql` — `product_types`' own creation +
  seed data.
- `src/app/(dashboard)/dashboard/[slug]/display/board-config.ts` — `MANAGEMENT_UNITS`, the
  hardcoded 8-bucket TV board grouping.
- `src/app/(dashboard)/dashboard/[slug]/settings/materials/material-form.tsx`,
  `actions-sr.ts` — the new multi-select + junction write.
- `known-issues/2026-08-19-general-categories-orphaned-feature.md` — the separate,
  already-documented orphaned-feature finding on the same `general_categories` table ruled out
  above.
