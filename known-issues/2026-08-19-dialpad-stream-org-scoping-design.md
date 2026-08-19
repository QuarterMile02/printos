# 2026-08-19 — Dialpad call-event stream has no org dimension at all — scoping report, not fixed

## Status

**Open, reported only — not built.** Called out separately from the rest of this sweep
because the fix isn't a missing auth check on the route; the underlying data model
(`CallEvent`, `src/lib/dialpad-store.ts`) has no organization concept anywhere in it. Adding
`if (!user) return 403` to the stream route wouldn't close the actual gap (any authenticated
user of ANY org would still see every org's call events) — this needs schema and data-flow
changes, scoped here for someone to build as its own piece of work.

## What's there today

`src/lib/dialpad-store.ts` is a single **in-process, module-level array** (`let events:
CallEvent[]`), capped at 50 entries, with no org field on `CallEvent` at all:

```ts
export type CallEvent = {
  id: string
  timestamp: number
  from_number: string
  matched: boolean
  customer_id?: string
  customer_name?: string
  customer_url?: string
}
```

`POST /api/webhooks/dialpad` (the inbound Dialpad webhook) pushes an event on every
`call.started`, looked up by phone number:

```ts
const { data: matches } = await service
  .from('customers')
  .select('id, first_name, last_name, organization_id, organizations(slug)')
  .ilike('phone', `%${digits}%`)
  .limit(1)
```

`GET /api/webhooks/dialpad/stream` is a polling endpoint (hit every 3s by
`IncomingCallToast`) that returns `getEventsSince(since)` — **every** event in the array,
system-wide, to **any** caller, with **no auth check at all**.

## Two separate gaps, both need fixing together

1. **The customer lookup itself isn't org-scoped.** `.ilike('phone', ...)` with no
   `.eq('organization_id', ...)` searches every org's `customers` table for a phone-number
   match. If two different PrintOS orgs each have a customer with the same (or overlapping,
   given `ilike '%digits%'`) phone number, an incoming call could match the wrong org's
   customer — the resulting `customer_url` would point at a customer record in an org the
   call has nothing to do with. There's currently no way to know which PrintOS org a Dialpad
   call event even belongs to, since Dialpad itself has no PrintOS org id to send — the org
   has to be inferred from whichever org's customer table the number matches, which is
   exactly what's ambiguous today.
2. **The stream has no org filter and no auth**, so even once (1) is fixed and each event
   correctly carries the org it belongs to, `/stream` still needs to (a) require a session,
   (b) resolve that session's org, and (c) filter events to that org before returning them.

## What it would take to make this org-scoped end to end

- **Data model**: add `organization_id` to `CallEvent`, populated from `match.organization_id`
  when a customer match is found. For the no-match case, there's still no PrintOS org to
  attach — Dialpad has no concept of "which PrintOS org is this phone number for" unless
  Dialpad numbers map 1:1 to orgs somewhere (worth checking whether each org has its own
  Dialpad number/account, in which case the *webhook subscription itself* could carry the org,
  independent of whether a customer match is found — this would also fix gap (1) above, since
  the org would come from the subscription, not phone-number matching).
- **Persistence**: the module comment already flags that the in-process array doesn't survive
  multi-instance Vercel deployments ("swap for a Supabase row or Redis key") — doing that swap
  is also the natural place to add the `organization_id` column and index, and to apply RLS or
  an explicit org filter on read, consistent with every other table in the app.
- **Webhook**: scope the customer lookup by org (once the org is known from the subscription
  or another source) instead of a bare cross-org `ilike`, and store that org on the event.
- **Stream route**: require a session (`supabase.auth.getUser()`), resolve the caller's org(s)
  (`getUserOrgIds()` from `src/lib/require-org-access.ts`, added in this sweep, can be reused
  here), and filter returned events to those org ids.
- **Client**: `IncomingCallToast` doesn't need changes if the server-side filter does its job
  — it already just renders whatever `/stream` returns.

## Why this wasn't just patched inline

Everything above is schema/data-flow work (new column, a migration, deciding how a Dialpad
number maps to a PrintOS org, probably a persistence-layer swap), not a route-level guard —
out of proportion with the rest of this sweep, which is entirely "add a missing check to an
existing route." Flagging with a concrete plan so it can be scoped and built as its own PR.

## Related

- `src/lib/dialpad-store.ts` — the in-process store, `CallEvent` type.
- `src/app/api/webhooks/dialpad/route.ts` — inbound webhook, the unscoped `ilike` customer
  lookup.
- `src/app/api/webhooks/dialpad/stream/route.ts` — the polling endpoint with no auth and no
  org filter.
- `src/lib/require-org-access.ts` — `getUserOrgIds()`, written for this sweep, reusable here
  once the data model has an org to filter by.
