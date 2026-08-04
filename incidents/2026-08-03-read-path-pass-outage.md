# 2026-08-03 — Read-path error-handling pass caused two production outages

## Summary

Tonight's read-path error-handling pass (commits `88e007a`..`1795cad`, then the
friendly-error follow-up `c94d590`..`396e614`) wrapped previously-unchecked
Supabase reads in `dbOrThrow`, on the assumption that a failing read almost
always meant a genuine, rare error worth surfacing. Two of those reads instead
had long-standing, *always-failing* queries whose errors had been silently
swallowed by the pre-existing code (no `error` check at all) since well before
tonight. Wrapping them in `dbOrThrow` correctly started surfacing those errors
— but converted "silently degraded" into "full-page crash," taking down
`/customers/[customerId]` and the dashboard root (`/`) for every user.

Both were live for roughly 2 hours before being reported, diagnosed, and
fixed.

## Root causes and fixes

### 1. `customers/[customerId]` — every customer detail page crashed

- **File:** `src/app/(dashboard)/dashboard/[slug]/customers/[customerId]/page.tsx`
- **Query:** open-jobs lookup filtered `.neq('status', 'cancelled')`
- **Bug:** `'cancelled'` has never been a member of the `job_status` Postgres
  enum (`supabase/migrations/003_jobs.sql`: `new`, `in_progress`,
  `proof_review`, `ready_for_pickup`, `completed` only). The filter was added
  in commit `09864d9` (2026-05-15) and has been erroring (`22P02`, invalid
  enum literal) on every single request since — the original code only
  destructured `{ data }` and never checked `error`, so the open-jobs list
  quietly rendered empty instead of crashing.
- **Fix (`d843a1f`):** removed the invalid `'cancelled'` filter. `.neq('status',
  'completed')` alone is correct for "open jobs" given the actual enum.
  Root cause fixed, not re-hidden.

### 2. Dashboard root (`/dashboard/[slug]`) — crashed for every user

- **File:** `src/app/(dashboard)/dashboard/[slug]/page.tsx`
- **Query:** `dashboard_layouts.select('widget_config')`
- **Bug:** `widget_config` doesn't exist on this environment's
  `dashboard_layouts` table — schema drift from migration 039, which defines
  the column at table-creation time. Same shape as bug #1: the original code
  never checked this query's error, so it silently fell back to the default
  widget layout.
- **Fix (`38f42a0`):** switched `dbOrThrow` → `dbBestEffort`. Still logs the
  failure loudly server-side (satisfies the pass's original goal), but
  degrades to the default layout instead of crashing — matching this file's
  own pre-existing schema-drift-tolerance convention for its other reads.

## Verification

- All 3 originally-reported customer IDs confirmed rendering their real page
  live on `printos-six.vercel.app`.
- Vercel logs confirmed zero new errors on those requests post-fix, and
  confirmed the technical detail (message, `DbError`, Postgres code, stack)
  is still being logged server-side as designed.
- Dashboard root confirmed rendering fully (a couple of individual widget
  cards show "Unable to load" — pre-existing, unrelated bugs, not part of
  tonight's changes; see Known related issues below).
- Full live sweep of the entire dashboard-core commit batch (10 files):
  accounting, customers (list), customers/import, customers/[customerId] ×3,
  invoices (list), invoices/[id], jobs (list), jobs/[jobId],
  jobs/[jobId]/scan, dashboard root — all confirmed rendering real content.
- TypeScript clean after both fixes.

## Proactive sweep — remaining 6 batches (~68 files)

Given two hits in one batch, did a full live-verification sweep of every
other batch from the same pass, using the same technique (real page load
against real production data, not static code review):

| Batch | Files | Result |
|---|---|---|
| Products / purchase-orders | 8 | clean |
| Quotes / SO / shipping / vendors / team-members | 11 | clean |
| Reports | 16 | clean |
| Settings batch 1 | 16 | clean |
| Settings batch 2 | 16 | clean |

No further instances of the same failure pattern found. The two bugs above
were isolated to the dashboard-core batch.

One caveat: `reports/[type]/page.tsx` (dynamic catch-all) was not
live-tested directly — every currently-defined report type has its own
static route that Next.js matches ahead of the dynamic segment, so this file
is presently unreachable dead code, not a live risk.

## Known related issues — not part of this incident, not fixed

Found via Vercel logs while investigating; all pre-existing, outside
tonight's changed files, and already degrading gracefully (not crashing):

- `_widgets/QuotesPriorityWidget` — invalid `quote_status` enum literal `"void"`
- `_widgets/DepartmentQueueWidget` — invalid `job_status` enum literal `"on_hold"`
- `_widgets/FileErrorWidget`, `_widgets/ApproachingDeadlineWidget` — invalid
  `job_status` enum literal `"cancelled"` (same bad value as bug #1, different
  file)
- `_widgets/sales-pipeline` (in `display/actions.ts` / dashboard widgets) —
  missing `team_members` table, missing `profiles.email` column
- `src/app/(dashboard)/dashboard/[slug]/display/actions.ts` — three more
  `.neq('status', 'cancelled')` / `.neq('status', 'void')` filters against
  `jobs.status`, same invalid-enum shape as bug #1

Worth a dedicated cleanup pass; none of these are blocking anything today.

## Commits

- `c94d590` — shared `renderPageError`/`DataTableError` infrastructure
- `bbb6dec`..`396e614` — friendly-error rollout across the read-path pass's 78 files
- `d843a1f` — hotfix: customers/[customerId] invalid enum filter
- `38f42a0` — hotfix: dashboard root schema-drift column, dbOrThrow → dbBestEffort
