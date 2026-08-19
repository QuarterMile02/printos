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

## The three properly-signed webhooks

- `src/app/api/shipping/webhook/route.ts` (EasyPost) — already failed closed (`if (!secret)
  return 500`), HMAC-SHA256 verified with `timingSafeEqual`. Reference pattern used to fix the
  other two.
- `src/app/api/webhooks/ghl/route.ts` — fixed to fail closed in this PR (was fail-open before;
  see `known-issues/2026-08-19-ghl-dialpad-webhook-secret-handoff.md` for the required secret
  rotation before this can actually go live).
- `src/app/api/webhooks/dialpad/route.ts` — same fix, same handoff doc.

All three now share the same shape: refuse the request outright if the secret env var isn't
configured, otherwise verify an HMAC-SHA256 signature with `crypto.timingSafeEqual`.

## `GET /api/auth/callback`

`src/app/api/auth/callback/route.ts` is Supabase's own PKCE/OTP code-exchange redirect
handler (`supabase.auth.exchangeCodeForSession(code)`) — the `code` param is a one-time,
Supabase-issued exchange token, not an org id or resource id, and a failed exchange redirects
to `/login?error=auth_callback_error` rather than leaking anything. Standard Supabase Auth
flow, no gap found.

## Related

- PR description — the actual fixes from this sweep (Tier 1 + Tier 2).
- `known-issues/2026-08-19-checkpermission-org-scoping-gap.md` — a systemic gap found *during*
  this sweep, deliberately not fixed here (too large a blast radius for this PR).
- `known-issues/2026-08-19-dialpad-stream-org-scoping-design.md` — the one item from the sweep
  that's a design problem, not a quick fix; scoped but not built.
