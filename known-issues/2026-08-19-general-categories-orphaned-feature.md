# 2026-08-19 — general_categories settings page — orphaned or unfinished feature

## Status

**Open, not fixed, no code changed.** Found while verifying whether the `settings.general_categories`
permission gap (surfaced during the Team permission-overrides investigation) was worth a follow-up
ticket. It is — but not for the reason originally assumed. This is a write-up only; no fix has been
built.

## What it is

Settings → General Categories (`src/app/(dashboard)/dashboard/[slug]/settings/general-categories/`)
manages a `general_categories` table (`supabase/migrations/071_general_categories.sql`, `sub_type`
column added in `089_categories_subtype.sql`). It covers a real taxonomy: `type` is one of
`asset`/`job`/`quote`/`all`, plus `sub_type` values including `industry`, `lead_source`, `machine`,
`note`, `pricing_level`, `tag`. Migration 071 seeds real data per org (asset types like "Client
Quote"/"Proof", job types like "Installation"/"Production", quote types like "Standard"/"Rush") and
its own comment states it's *"Used across quotes, jobs, and assets for tagging/categorization."*

Access today: only the `owner` role can reach this settings page — `checkPermission(org.id,
'settings.general_categories')` gates it, and that key was left `false` for every non-owner role in
`ROLE_DEFAULTS` (deliberately, during the Team permissions rebuild — flagged then as "too
cross-cutting to assign confidently," not fixed here either).

## The real finding: nothing else in the app reads from this table

Grepped every file in `src` for any reference to `general_categories` outside the settings page
itself (`page.tsx`, `actions-sr.ts`, `general-categories-list-client.tsx`) — zero results. Despite
migration 071's own comment claiming it drives tagging across quotes/jobs/assets, **no quote, job,
or asset anywhere in the current codebase actually queries this table.**

Confirmed concretely for two of its subtypes:
- `customers.industry` and `customers.lead_source` are plain free-text form fields
  (`t(formData.get('industry') as string | null)` in `customers/actions.ts` — trimmed text, no
  validation against `general_categories` or anything else).
- The customer-detail page's industry dropdown (`customer-detail-client.tsx`) is sourced from a
  hardcoded `INDUSTRY_OPTIONS` array in that same client component, not from the database table at
  all.

So at least the `industry`/`lead_source` subtypes are completely disconnected from the settings page
meant to manage them — editing either one there has zero downstream effect anywhere in the app.
Whether `machine`/`note`/`pricing_level`/`tag`/the `asset`/`job`/`quote` category types fare any
better wasn't individually spot-checked beyond the app-wide grep, but the grep result (zero
consumers outside the settings page) covers all of them the same way.

## RLS detail — migration 071's owner-only policy is moot

Migration 071 also defines RLS directly on the table, independent of the `checkPermission()` system
entirely:

```sql
CREATE POLICY "gc_owner_manage" ON public.general_categories FOR ALL
  USING (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid() AND role = 'owner'));
```

This looked at first like a deliberate, hardcoded "owner-only, by design" signal baked into the
schema itself — worth noting since it would have meant the permission gap was intentional, not
accidental. It isn't load-bearing, though: the actual write path
(`general-categories/actions-sr.ts`, `saveGeneralCategory()`) uses `createServiceClient()`, which
bypasses RLS entirely. So this policy currently affects nothing in practice — the only real gate on
who can edit this data is the page-level `checkPermission()` check, same as any other settings page
in this app.

## Open question for Ruben — not resolved here

Two very different possibilities, and the right next step depends entirely on which one is true:

1. **Finished feature, never wired up** — the taxonomy admin UI and seed data exist, but the
   quote/job/asset/customer flows that were supposed to consume them were either never built or
   were later replaced with hardcoded lists (as happened with `industry`). If so, this page (and
   its seed data) is a reasonable candidate for removal rather than for deciding who gets to manage
   it.
2. **Partially-built feature, still in progress** — the intent is for this to eventually drive real
   dropdowns (quote types, job types, industries, lead sources, etc.) across the app, and that
   wiring simply hasn't landed yet. If so, this needs real scoping (which flows should consume it,
   in what order) before it's worth deciding which role should be allowed to edit the underlying
   categories.

No action taken either way — `settings.general_categories` stays `false` for every non-owner role,
same as it already was before this investigation. Flagging for prioritization, not deciding here.

## Related

- `src/lib/permissions.ts` — `settings.general_categories` in `ROLE_DEFAULTS`, `false` for every
  non-owner role.
- `supabase/migrations/071_general_categories.sql`, `089_categories_subtype.sql` — table definition,
  seed data, and the RLS policy discussed above.
- `known-issues/2026-08-17-portal-tiers-rls-gap.md` — the prior finding that prompted rebuilding the
  Team permissions picker, which is what surfaced this gap in the first place.
