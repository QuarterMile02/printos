# 2026-08-19 — `checkPermission()` doesn't verify org membership — found during the API auth sweep, not fixed

## Status

**Open, not fixed.** Found while fixing the Tier 1/Tier 2 API auth gaps (see
`src/lib/require-org-access.ts` and every route that imports it) — flagged here rather than
fixed in the same PR because `checkPermission()` has ~70 call sites across the app and a
change to its core logic deserves its own dedicated review and regression pass, not a
drive-by fix bundled into an unrelated auth-gap sweep.

## The bug

`src/lib/check-permission.ts`'s `checkPermission(orgId, permission)` resolves the requesting
user's `profiles` row by **user id only**, then evaluates their role/tier permission table —
**without ever checking that `profile.organization_id === orgId`**:

```ts
if (profile) {
  const allowed = hasPermission(
    { role: profile.role, tier: profile.tier },
    overrides,
    permission,
  )
  return { allowed, profile }   // <-- orgId argument was never compared to anything
}
```

The `orgId` argument is only actually enforced in the fallback branch (when the user has *no*
`profiles` row at all, so the code falls through to an `organization_members` lookup scoped
by `.eq('organization_id', orgId)`). Every user with a normal profile row skips that branch
entirely.

## Why that matters

`hasPermission()` is role/tier-based, not org-based — e.g. the `owner` role is a blanket
`{'*': true}` wildcard on every permission key, for every org. Concretely: a user who is
`owner` of Org A can call `checkPermission(orgB_id, 'invoices.qb_export')` (or any other
permission key) for a completely unrelated Org B, and it returns `allowed: true` — the
function never noticed `orgB_id` isn't their org. Any authenticated user whose own role
happens to have a given permission key passes `checkPermission()` for *any* org's resources
carrying that same key, not just their own.

This is a **cross-tenant authorization bypass**, not merely a permission-granularity issue.
It affects every route that calls `checkPermission(resourceOrgId, someKey)` and trusts a
`true` result as "this caller may access this org's resource" — which is the exact pattern
`GET /api/invoices/[id]/export-iif` uses (PR #19, merged) and the pattern this sweep's Tier 1
item 1 and Tier 1 item 3 fixes were asked to follow ("same pattern as the export-iif fix
already merged"). Rather than propagate a pattern known to have this gap, every route fixed
in this sweep pairs `checkPermission()` with an independent, explicit org-membership check
(`userBelongsToOrg()` / `getUserOrgIds()` in `src/lib/require-org-access.ts`) that resolves
the caller's actual org(s) from their session and compares against the resource's real org —
so the final decision doesn't depend on `checkPermission()`'s org-blindness. **This means
`GET /api/invoices/[id]/export-iif` itself (already merged, not touched by this PR) still has
the underlying gap** — it denies unauthenticated requests correctly, but a same-role user
from a different org would currently pass its `checkPermission()` call. Worth a follow-up.

## Why not fixed here

The obvious fix is small — in the profile-found branch, only evaluate role/tier permissions
when `profile.organization_id === orgId`; otherwise fall through to the existing
`organization_members`-scoped branch 2 (which already does the right thing). That preserves
the multi-org-membership path (a user with access to more than one org via
`organization_members` but a profile pointed at only one) while closing the gap for the
common single-profile case. But `checkPermission()` is the authorization backbone for ~70
files across nearly every settings, reports, and detail page in the app — every one of those
call sites currently depends on today's (broken) behavior in ways not audited here. A change
to shared auth logic at that blast radius needs its own PR, explicit sign-off, and a real
regression pass across those call sites — not something to fold into an unrelated auth-gap
sweep.

## Suggested fix (for the follow-up PR)

In `src/lib/check-permission.ts`, branch 1:

```ts
if (profile && profile.organization_id === orgId) {
  // ...existing role/tier evaluation...
  return { allowed, profile }
}
// falls through to the organization_members-scoped branch for any
// profile whose home org doesn't match orgId (or no profile at all)
```

Then audit call sites for anywhere the caller was relying on cross-org grants (there
shouldn't be any legitimate ones, but confirm before shipping).

## Related

- `src/lib/check-permission.ts` — the function itself.
- `src/lib/require-org-access.ts` — the explicit membership-check helper written for this
  sweep specifically to not depend on the above gap.
- `src/app/api/invoices/[id]/export-iif/route.ts` — merged PR #19, uses the vulnerable
  pattern; not touched by this PR, flagged here for follow-up.
