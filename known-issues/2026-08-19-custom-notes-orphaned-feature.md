# 2026-08-19 — custom_notes settings page — orphaned feature, plus a real save-failure bug

## Status

**Open, not fixed, no code changed.** Found during a follow-up sweep of the 9 other settings pages
that shared `general_categories`' pattern (previously ungated, owner-only-by-accident permission
keys, all added to `ROLE_DEFAULTS` in the Team permission-overrides rebuild). This is one of 2 out
of 8 audited pages that actually matches the orphaned pattern — the other 6 turned out to be
genuinely consumed elsewhere in the app.

## What it is

Settings → Custom Notes (`src/app/(dashboard)/dashboard/[slug]/settings/custom-notes/`) manages a
`custom_notes` table (`supabase/migrations/072_custom_notes.sql`) — canned title/body text entries
per organization, typed by where they're meant to be used. The page's own footer text claims:
*"Custom notes appear as quick-fill dropdowns on quotes, sales orders, and jobs."*

## The real finding: zero consumers, and the claim above isn't true today

Grepped every file in `src` for `custom_notes` — the only hits outside the settings page itself are
permission-key plumbing (`src/lib/permissions.ts`, `TeamSettingsClient.tsx`) and the sidebar nav
link. **No quote, sales-order, invoice, or job creation/edit flow anywhere in the codebase selects
from this table.** There is no "quick-fill dropdown" component consuming it — the page's own
description of what it does is aspirational, not accurate to the current app. Same shape as the
`general_categories` finding (`known-issues/2026-08-19-general-categories-orphaned-feature.md`):
seeded data, a real admin UI, a claim of being wired into other flows, and zero actual consumers.

## Bonus finding: a real bug, independent of the orphaning question

The settings page's own `TYPES` list (`page.tsx`) offers 7 note types:

```
customer_note, quote_note, sales_order_note, invoice_note, job_note, void_reason, lost_reason
```

But the database's `CHECK` constraint (migration 072) only allows 5:

```sql
CHECK (type IN ('void_reason', 'lost_reason', 'customer_note', 'job_note', 'quote_note'))
```

**`sales_order_note` and `invoice_note` are not in the constraint.** Selecting either type in the
form and saving would fail outright with a constraint violation — a real, reproducible bug, not a
hypothetical. This is independent evidence the page was extended after the schema was frozen and
never tested against a save with one of those two types selected.

## RLS detail — same moot-policy pattern as general_categories

Migration 072 defines a hardcoded `role = 'owner'`-only "manage" RLS policy
(`cn_owner_manage`), independent of the `checkPermission()` system — but it's not load-bearing: the
write path (`actions-sr.ts`, `saveCustomNote()`) uses `createServiceClient()`, which bypasses RLS
entirely. The only real gate today is the page-level `checkPermission(org.id,
'settings.custom_notes')` check, `false` for every non-owner role.

## Open question for Ruben — not resolved here

Same shape as `general_categories`: is this a finished admin UI that the consuming flows (quote/SO/
invoice/job "quick-fill" dropdowns) were never actually built for, or a partially-built feature still
waiting on that wiring? Either way, the `sales_order_note`/`invoice_note` mismatch should be fixed
independently of that decision — it's a bug regardless of whether the feature ends up wired up or
removed.

No action taken — `settings.custom_notes` stays `false` for every non-owner role, unchanged from
before this investigation.

## Related

- `known-issues/2026-08-19-general-categories-orphaned-feature.md` — the original finding that
  prompted this sweep, same pattern.
- `src/lib/permissions.ts` — `settings.custom_notes` in `ROLE_DEFAULTS`.
- `supabase/migrations/072_custom_notes.sql` — table definition, RLS, seed data, the `type` CHECK
  constraint.
