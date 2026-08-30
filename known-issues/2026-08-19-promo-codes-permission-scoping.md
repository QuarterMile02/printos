# 2026-08-19 — promo_codes permission scoping — needs a real access-tier decision

## Status

**Open, not fixed, no code changed.** This is a scoping note, not an orphaned-feature finding —
different in kind from the other two write-ups from this sweep
(`2026-08-19-general-categories-orphaned-feature.md`, `2026-08-19-custom-notes-orphaned-feature.md`).
Ruben has confirmed promo codes are a real, intended feature — the open question here is about
permission granularity, not whether the feature is finished.

## What it is

Settings → Promo Codes (`src/app/(dashboard)/dashboard/[slug]/settings/promo-codes/`, including its
`[id]/` detail route) manages a `promo_codes` table (`supabase/migrations/111_promo_codes.sql`) —
discount codes with `discount_type`, `value`, `minimum_requirement`, `limit_of_using`, `valid_from`/
`valid_to`, `is_active`.

## Confirmed: intentional forward-looking infrastructure, not dead code

Unlike `general_categories`/`custom_notes`, this one doesn't misrepresent its own status. It's
self-documented as unfinished-by-design in three separate places:

- The migration's own header comment: *"Forward-looking infrastructure for a future customer
  self-checkout / Customer Portal ordering flow — not wired into the current manual quote flow, and
  no redemption/usage-tracking exists yet since there's no checkout to attach it to."*
- The settings list page's description: *"Settings/management only for now — not yet wired into
  quotes or a customer checkout flow."*
- The detail page's subtitle: *"Management only for now — not yet redeemable from any quote or
  checkout flow."*

A grep of every quotes/sales-orders/orders directory confirmed no code path applies a promo code to
a quote or order total — consistent with what the code itself says. This is a real, planned feature
still waiting on the checkout flow it depends on, not a stale or abandoned page.

## The real open question: one combined permission key isn't enough

Today, `settings.promo_codes` is a single `checkPermission()` key gating the entire settings page —
`true` for `accounting`, `false` for every other non-owner role (`src/lib/permissions.ts`), assigned
during the Team permission-overrides rebuild alongside 9 other catalog/reference-data keys as a
blanket "accounting manages catalog data" default.

Ruben has flagged that this key needs different treatment than the other 9: **not everyone who can
see that promo codes exist should be able to create or edit them.** A single combined
`settings.promo_codes` key can't express that — it's all-or-nothing (open the page and you can both
view and create/edit). Two real access tiers are wanted:

- **View** — see which codes exist, their terms, whether they're active.
- **Create/edit** — actually define new codes or change existing ones (discount amount, validity
  window, usage limits — direct revenue/margin impact).

This would need splitting into two separate permission keys (e.g. `promo_codes.view` /
`promo_codes.manage`, naming TBD) and updating `page.tsx`'s single `checkPermission()` call into two
checks gating the read vs. the write UI/actions separately — not done here, this is a scoping note
only.

## Left open — not decided here

- Exact key names and where they should live (currently grouped under "Settings" in the Team
  permissions picker alongside the other catalog keys — may deserve its own "Promo Codes" grouping
  once split, or may make more sense once the Portal Tiers precedent — a real key already broken out
  from Settings — is considered).
- Which roles/tiers get view vs. create/edit. Deliberately not guessed here, unlike the other 9
  catalog keys (which got a blanket `accounting: true` default) — this one depends on how the
  checkout flow it's built for actually gets scoped, which hasn't happened yet. Assigning access now
  would be guessing at a business decision that hasn't been made.
- Whether the current single `settings.promo_codes: true` (accounting) default should be treated as
  a placeholder "view + manage" grant in the meantime, or left as-is until the split happens.

## Related

- `src/lib/permissions.ts` — `settings.promo_codes` in `ROLE_DEFAULTS` (single combined key today).
- `src/app/(dashboard)/dashboard/[slug]/settings/team/TeamSettingsClient.tsx` — Team permissions
  picker, currently lists this as one toggle under "Settings."
- `supabase/migrations/111_promo_codes.sql` — table definition and its own forward-looking-infra
  comment.
- `known-issues/2026-08-19-general-categories-orphaned-feature.md`,
  `known-issues/2026-08-19-custom-notes-orphaned-feature.md` — the two genuinely orphaned findings
  from the same sweep, different in kind from this one.
