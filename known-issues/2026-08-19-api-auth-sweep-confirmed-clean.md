# 2026-08-19 — API auth sweep: confirmed-clean routes

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

## `POST /api/test-sms`

`src/app/api/test-sms/route.ts` hard-blocks itself outside development:
`if (process.env.NODE_ENV === 'production') return 403`. It's a dev-only Twilio smoke-test
tool with no org-scoped data involved (just sends a test SMS to a phone number in the request
body via the shared Twilio account) — the production block is the correct control for what
this route is. No gap found.

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
