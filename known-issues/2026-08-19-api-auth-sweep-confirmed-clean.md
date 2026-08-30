# 2026-08-19 — API auth sweep: confirmed-clean routes

> **⚠ Coverage warning (added 2026-08-30). This sweep examined 21 of 68 routes under
> `src/app/api/` — roughly 31%.** The title says "API auth sweep"; the scope was not the API.
> The other 47 routes were never opened. Do not read this file, or the sweep it belongs to, as
> evidence that a route is safe unless that route is named below. Routes known to have been
> missed, and found later to have real gaps, include `POST /api/collection-calls`
> (unauthenticated cross-org write until 2026-08-30), `POST /api/quotes/approve` and
> `POST /api/quotes/rescue-archive` (cross-org writes gated only on the org-blind
> `checkPermission`), and `GET /api/jobs/labels` (trusted `?org=` in its date-range mode).
>
> **One clearance below was wrong and has been corrected: `POST /api/test-sms`.** See that
> section.

## Status

**Reference only — no action needed.** Companion to the fixes in this PR (see PR description
for the full list of what was actually broken). Recording what was checked and found already
correct, so nobody re-flags these in a future sweep without re-reading them first.

## `materials/[id]/pricing-tiers/*` (GET, POST, PATCH, DELETE, `/export`, `/import`)

- `src/app/api/materials/[id]/pricing-tiers/route.ts`
- `src/app/api/materials/[id]/pricing-tiers/[tierId]/route.ts`
- `src/app/api/materials/[id]/pricing-tiers/export/route.ts`
- `src/app/api/materials/[id]/pricing-tiers/import/route.ts`

All five resolve the org from the **session**, not the request, via the shared
`getSupabaseAndOrg()` helper (`src/lib/pricing-tiers-server.ts`): looks up the authenticated
user, returns `orgId: null` if there's no session, and every query afterward is scoped with
`.eq('organization_id', orgId)` using that session-derived id — never a client-supplied one.
The mutating routes additionally call `materialBelongsToOrg()` before touching a specific
`materialId`, confirming the material itself belongs to that same session org. This is the
correct pattern (the same shape `require-org-access.ts` was written to bring to the routes
that didn't have it) — no gap found.

## ~~`POST /api/test-sms`~~ — **CLEARED IN ERROR. Route deleted 2026-08-30 (PR #56).**

**The original ruling, retained so the mistake is legible:**

> `src/app/api/test-sms/route.ts` hard-blocks itself outside development:
> `if (process.env.NODE_ENV === 'production') return 403`. It's a dev-only Twilio smoke-test
> tool with no org-scoped data involved (just sends a test SMS to a phone number in the request
> body via the shared Twilio account) — the production block is the correct control for what
> this route is. No gap found.

**Why that was wrong.** `NODE_ENV !== 'production'` is not an access control. Vercel preview
deployments are non-production, publicly reachable at a guessable URL, and carry the same
environment variables as production — including `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and
`TWILIO_PHONE_NUMBER`. On every preview build this route was an **open, unauthenticated SMS
relay**: no session check, no allowlist on the destination number, no rate limit, `To:` taken
verbatim from the request body, billed to the shared Twilio account. It had zero callers. It
was open for 11 days.

"No org-scoped data involved" was true and irrelevant. The asset at risk was the Twilio
account and the ability to send messages from the company's number to arbitrary recipients —
neither of which is org-scoped data, and neither of which the production block protected.

**The general lesson, which is the reason this section is kept rather than deleted:** an
environment check is not a guard. Neither is "dev only", "internal tool", "no callers", "not
linked in the UI", or "nobody knows the URL". A route is cleared only by an authentication
check *in the route*, or by being a credential-bearing endpoint where the credential IS the
request (see `auth/callback` and `shipping/webhook` below — both genuinely clean, for that
reason). Anything cleared on environment or obscurity reasoning should be re-opened.

## The webhooks — one confirmed clean, two fixed in a separate held PR

- `src/app/api/shipping/webhook/route.ts` (EasyPost) — already failed closed (`if (!secret)
  return 500`), HMAC-SHA256 verified with `timingSafeEqual`. Confirmed clean, no gap found.
  Reference pattern used for the other two.
- `src/app/api/webhooks/ghl/route.ts` and `src/app/api/webhooks/dialpad/route.ts` — **were**
  fail-open (unset secret env var skipped verification instead of refusing the request).
  Fixed, but deliberately **not** in this PR — closing this one breaks the live GHL
  integration on deploy until a secret is rotated on both sides, unlike everything else in
  this sweep, so it's held in its own PR (#21) pending that handoff. See
  `known-issues/2026-08-19-ghl-dialpad-webhook-secret-handoff.md` (moved to that PR) for the
  full plan, including a fallback for GHL's no-code workflow builder if it can't do proper
  HMAC signing.

Once #21 merges, all three will share the same shape: refuse the request outright if the
secret env var isn't configured, otherwise verify a signature with `crypto.timingSafeEqual`.

## `GET /api/auth/callback`

`src/app/api/auth/callback/route.ts` is Supabase's own PKCE/OTP code-exchange redirect
handler (`supabase.auth.exchangeCodeForSession(code)`) — the `code` param is a one-time,
Supabase-issued exchange token, not an org id or resource id, and a failed exchange redirects
to `/login?error=auth_callback_error` rather than leaking anything. Standard Supabase Auth
flow, no gap found.

## Related

- PR description — the actual fixes from this sweep (Tier 1 + Tier 2).
- PR #21 (draft, held) — the GHL/Dialpad webhook fail-closed fix, split out of this PR pending
  the secret-rotation handoff.
- `known-issues/2026-08-19-checkpermission-org-scoping-gap.md` — a systemic gap found *during*
  this sweep, deliberately not fixed here (too large a blast radius for this PR).
- `known-issues/2026-08-19-dialpad-stream-org-scoping-design.md` — the one item from the sweep
  that's a design problem, not a quick fix; scoped but not built.
