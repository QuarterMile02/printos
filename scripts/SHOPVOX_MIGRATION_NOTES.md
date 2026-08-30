# ShopVOX → PrintOS migration: durable notes

Written so a fresh session (no conversation memory) can pick this project up
and be immediately useful. If you're that fresh session: read this whole
file before touching any script. Almost everything here was learned by being
wrong first and proving the correction live — don't re-derive what's already
here, and don't trust a plausible-looking count without reading the "reconcile
against a second source" section below.

Org: `4ca12dff-97be-4472-8099-ab102a3af01a` (Quarter Mile Inc, single-tenant).
ShopVOX account: 6-year history. Sames Auto Arena's outstanding balance is
the standing canary for "does native match ShopVOX" — see the canary's full
definition, exact query, and current value near the end of this document
(search "Sames canary, re-baselined") before trusting any bare number for it
quoted earlier in this file; those are dated historical readings, not the
live check.

## Workflow rules — non-negotiable

1. **Migrations are proposed only.** Never `db push`, never run a migration
   script against the live database. Paste-ready inline SQL goes to the user,
   who applies it by hand in the Supabase SQL Editor. Migration 186 and 187
   were both applied this way — read the *live* schema afterward
   (`information_schema` via PostgREST's OpenAPI doc at `GET /rest/v1/`, or a
   `select` against the table) to confirm what actually landed, never assume
   from the migration file text.
2. **Never trust a success message.** A script reporting "harvested N,
   matches reported total" or "upserted N rows" is not proof — independently
   re-query the live table afterward. This caught: an unpaginated FK-lookup
   silently capping at 1,000 rows (looked successful, silently orphaned FKs
   past row 1,000); three "voided" backfill counts that were actually
   duplicate-collision counts; an importer reporting `succeeded` while a
   parent table had actually timed out.
3. **Reconcile every filtered count against a second source before believing
   it.** This account has repeatedly returned a plausible, wrong count instead
   of an error. Concretely: fetch the record directly by uuid and confirm the
   filtered list actually contains it — a count matching your expectation is
   not proof if the filter is silently a no-op returning the unfiltered total.
4. **PowerShell: one command per line, no `&&` chaining**, when handing the
   user something to run themselves.
5. **Read-only against ShopVOX, always.** GET only. The only POST ShopVOX's
   own SPA makes (`authentication/refresh_token`) is triggered by page
   navigation, never constructed directly.
6. **One writer per queue file.** Two `shopvox-capture.mjs` processes racing
   on the same queue file corrupted checkpoint state (not the captured JSON —
   that's always a clean single `writeFileSync` per record — but the
   done/pending bookkeeping). Fixed with a lock file
   (`<queue-file>.lock`, pid + liveness check, self-heals from a `SIGKILL`
   via `process.kill(pid, 0)`) — see `acquireLock()` in `shopvox-capture.mjs`.
   Don't defeat it "just this once."
7. **Never edit `shopvox-capture.mjs`, `import-api-capture.mjs`, or any module
   they import while a capture process is actively running.** Node reads and
   compiles a module into memory once, at process start — an on-disk edit
   made mid-run does not reach the already-running process. On a sequential
   multi-customer run this produces a genuinely confusing split: a process
   that started before the edit keeps executing the old code for its entire
   remaining run, while every later process (once it starts fresh) picks up
   the fix. This is exactly what produced Bolillos Cafe's 13 phantom
   `invoice` queue rows — the `job.orderId` fix landed on disk while
   Bolillos's capture process was already mid-run with the pre-fix module
   loaded, so it kept mistagging that job's sales order as an invoice for
   the rest of its own run; El Despecho (the customer before it) has zero
   such rows because its process started and finished before the edit. The
   inconsistency didn't show up as an error — it showed up as 11 clean parse
   failures (real 404s, so at least visible) plus 2 captures that
   succeeded outright under the wrong entity tag (see the type-agnostic
   endpoint open question below — those 2 are why it wasn't just quietly
   absorbed). On a multi-day account-wide run, mid-run edits would produce
   the same split silently across whatever's captured before vs. after the
   edit, with no log line calling it out — much harder to spot after the
   fact than it was here. If a fix is needed while a capture is running: let
   the current process finish (or stop it cleanly — see the single-instance
   lock above, `SIGINT` checkpoints safely), make the edit, then restart.
   Don't edit out from under a live process.
8. **A Claude Code CLI self-update can plausibly kill a running background
   capture.** One capture process was found externally terminated mid-run —
   no error output, no stack trace, no OOM signature, disk not full (193GB
   free at the time) — the kind of silent, immediate death that points to
   the process tree being torn down from outside rather than a crash inside
   the script. A Claude Code "Update installed · Restart to apply" banner
   was showing during that same window. A background task launched by this
   session ultimately hangs off the CLI's own process tree even when
   detached with `nohup`/`disown` inside the shell, so a self-update
   restarting the CLI is a mechanically plausible way to lose it — but this
   is an assessment of plausibility, not a confirmed root cause: the exact
   restart timestamp was not independently available to check against the
   exact kill timestamp. The queue's checkpoint/resume design (see workflow
   rule 6) made this a non-event for captured data — resuming from the
   on-disk checkpoint picked up exactly where it left off, nothing lost. For
   the multi-day account-wide run: treat an unexplained capture death with
   zero error output as possibly this, not as a mystery to chase — check
   `Get-CimInstance Win32_Process` for whether the process is simply gone,
   trust the queue checkpoint over any in-memory assumption, and just
   resume. Don't assume a silent kill means checkpoint corruption; verify
   the checkpoint before assuming the worst.
9. **A verification query MUST be a separate execution from the write it
   verifies — never bundle a check with the write it checks, not in SQL,
   not in scripts.** Same class of failure as migrations 140 and 152: a
   delete ran, a bundled `SELECT`/`RETURNING`-style check inside the same
   transaction/round-trip reported the correct post-delete counts, the
   transaction never actually committed, and the database was left
   completely untouched while every number on screen looked right. A
   verification step only means something if it's a genuinely independent
   read — a new connection/round-trip, after the write's transaction has
   actually committed, not a number computed as a side effect of the write
   statement itself (a `RETURNING` clause, a bundled `SELECT` in the same
   multi-statement call, a count the ORM/client computed from what it
   *thinks* it sent rather than what the server actually persisted). This
   is the same spirit as rule 2 ("never trust a success message") one level
   more specific: rule 2 is about not trusting a script's own claim of
   success; this rule is about not trusting a check that shares the write's
   own transaction/execution — even a check that LOOKS independent can be
   silently coupled to a write that never committed. Applies to every write
   in this migration going forward: the `historical_import_runs` bookkeeping
   writes, any future `is_active` backfill, and above all the main run's
   import step — always re-query in a fresh, separate call after the write
   call has returned and (for SQL) after the transaction is confirmed
   committed, never inline.

## Destination architecture directive (Ruben, 2026-08-24) — non-negotiable,
same weight as the workflow rules above

**Historical data lands in the NATIVE PrintOS tables (`quotes`,
`sales_orders`, `invoices`, `jobs`, `payments`, etc.) — not a separate
history area, not a "Historical" tab, not a parallel read-only schema.**
`shopvox_*` is a LANDING ZONE only, by deliberate design (staging first so a
mapping error costs a re-import, not a re-fetch — see `import-api-
capture.mjs`'s header). **A promotion step (staging → native tables) is
required and does NOT exist yet. It is the next design task. Do not design
or build it without being asked — it is explicitly out of scope right now.**

What the eventual promotion step must produce, so nothing built before it
lands accidentally forecloses an option:

- A historical sales order lives in `sales_orders` and behaves EXACTLY like
  one created today — same lists, same search, same customer record, same
  reports. No "Historical" section/tab/menu anywhere. After cutover ShopVOX
  is gone; PrintOS is the only place this data exists.
- The only difference: historical records are **READ-ONLY, enforced at the
  database level** (not just hidden/disabled in the UI).
- Numbering/naming **continue from ShopVOX unbroken** — invoice numbering
  resumes after ShopVOX's max, same for quotes/sales orders/jobs. Nothing
  restarts at 1.

Ruben's answers on the four promotion issues (for whoever designs it):

1. **Number collisions**: solved by emptying the native operational tables
   first. Confirmed live 2026-08-24 that every row currently in `quotes`
   (13), `jobs` (4), `sales_orders` (2), `invoices` (0), etc. is test data —
   0 of 4,560 `customers` rows were created natively with no ShopVOX origin
   (`shopvox_imported_at is null` count = 0 for real customers; the 2
   deliberately-unmatched dead leads are the only non-ShopVOX-linked rows
   and aren't test data). All current native test data gets deleted, tables
   start empty, historical records carry their real ShopVOX numbers,
   sequences get set to continue above ShopVOX's max. **No renumbering
   logic needed.**
2. **QuickBooks**: historical invoices import **pre-marked as already
   exported** so they can never be pushed to QuickBooks again. The cutover
   export itself is done **manually**; automation only comes after ShopVOX
   is switched off.
3. **Read-only**: yes — database-level, not UI-level (matches the bullet
   above).
4. **Product catalog**: historical line items are **reference only** —
   product name, category, quantity, price, description stored as plain
   text, no foreign key into the live product catalog. Product
   names/categories are expected to change in PrintOS over time and that's
   fine; historical records must never break or need updating when they do.

## API quirks proven live (not assumed) — this is the load-bearing section

| endpoint / behavior | what actually happens | proof method | fix |
|---|---|---|---|
| `transactions/purchase_orders?filters[]=companyId=X` | Silently ignored. Returns the account-wide total (1,159) even with a `companyId` set to a UUID that doesn't exist. | Compared real-customer filter vs a nonexistent-UUID filter — identical totals. | Purchase orders don't carry a customer at all (see structural finding below) — don't filter by companyId on this endpoint, ever. |
| `companies` list (no filter) | Implicit `active:true` default. Unfiltered total (4,646) exactly equals `active=true` total. | `active=false` filter (which DOES work) returns 7 real, provable customers absent from the unfiltered list. | Always run a supplementary `active=false` pass for customers. |
| `transactions/{quotes,work_orders,invoices,credit_memos,purchase_orders,payments}` list (no filter) | Same implicit `active:true` default, confirmed on every transaction kind checked. `refund` is the one confirmed genuine exception — its `active=false` count is really 0. | Same method: unfiltered total == `active:true` total on every kind; `active=false` returns real, provable records for every kind except refund. | `active=false` pass required for every transaction kind except refund. |
| `pro_jobs/list` | **Cannot enumerate voided jobs by ANY route tried.** `workflowState=equal:voided` → 0. `active=equal:false` → 0. `txnNumber=equal:<its own exact number>` → 0. `txnNumber` with `greaterThan`/`greaterThanOrEqual` → silently ignored, returns the same as fully unfiltered. Field names `number`/`jobNumber` → silently ignored. No dedicated "Voided Jobs" system view exists (checked `user_ui_view_configs?viewId=jobs` the same way "Voided Quotes"/"Voided Sales Orders" views were found — nothing there). Even fully unfiltered, `pro_jobs/list` only returns ~111 account-wide — it is not a general enumeration endpoint at all, not just broken for voided. | Fetched a job known to exist and be voided (`pro_jobs/{id}` direct, confirmed `workflowState:"voided"`) and confirmed it's absent from every one of the above. | No enumeration fix exists. Only the closure pass (below) reaches these, and even that's bounded — see its caveat. |
| Any unpaginated `.select()` via supabase-js | PostgREST silently caps at **1,000 rows**, no error, no warning. | `shopvox_transactions` had 1,079 rows; an unpaginated FK-lookup select returned exactly 1,000; the missing 79 orphaned their child rows' foreign keys. | Always paginate via `.range()` in a loop for any table that could exceed 1,000 rows. See `fetchAllIds()` in `import-api-capture.mjs`. |
| `.delete().in(col, [...ids])` via supabase-js | PostgREST puts every id in the URL query string. A large distinct-id list (~700+) causes a flat `Bad Request` with no useful message. | Hit it live on `shopvox_transaction_charges`'s delete-then-insert phase. | Chunk delete `.in()` calls the same way insert batches already were (150 ids/chunk — see `DELETE_CHUNK` in `import-api-capture.mjs`). |
| Token lifetimes | `shopvox_app_token` (httpOnly cookie, the actual bearer credential): ~30 min. `shopvox_refresh_token`: ~24h. Refreshing is triggered by a plain page navigation — the SPA does it itself, never construct the POST directly. | Observed refresh cycles over a live multi-hour run; confirmed via 401 test that `app_token` is the real credential. | `shopvox-api.mjs`: proactive refresh every ~15 min, reactive refresh-then-retry-once on any 401, and a non-exiting pause-and-poll loop (checks every 60s) if refresh itself fails — never silently marks the whole queue failed. |
| `sales_leads` filter rule `contain` | Not a real rule name — silently ignored, returns the full unfiltered list (4,646 in one test). | Tried it as a partial-match search for "Dos Marias"; got back the alphabetically-first unrelated companies. | Use `equal` with an exact name, or search the locally-cached `customers-list.json` instead of a live partial-match query. |

**Pattern underneath most of these**: this ShopVOX account silently returns a
*plausible* result — a real count, real records, a 200 status — instead of
erroring, when a filter doesn't do what it looks like it does. Every "proof"
in this document means: found a record independently known to be in the
hidden population, fetched it directly by uuid to confirm it's real, then
checked whether the enumeration route in question actually returns it. A
count alone was wrong three separate times before this became the standing
rule.

## Structural findings (not bugs — how ShopVOX's data model actually works)

- **BOM is a transaction-level aggregate, identical across every stage of a
  quote→sales_order→invoice chain.** Compared 5 real chains line by line: 4
  byte-identical, 1 identical content in a different array order — zero real
  divergence anywhere. Importing from every stage triple-counts material
  cost. Fix: import BOM only from the chain's current **terminal** stage — a
  transaction whose own `next_transactions` contains no `Quote`/`WorkOrder`/
  `Invoice` entry (Payment/Refund/CreditMemo entries don't count as further
  stages). A skipped (non-terminal) transaction's stale rows still get
  deleted, nothing re-inserted — tracked separately as
  "deleted without replacement," logged every run so a nonzero number tells
  you how many chains advanced a stage since the last import.
- **Purchase orders are standalone vendor-side records — they cannot be
  attributed to a customer, transaction, or job, ever, structurally.**
  Fetched 10 random POs (34 line items total): every one carries a real
  `vendor: {id, name}`; **zero** carry any customer/job/transaction reference.
  `workOrderLineItems` exists as a field on PO line items (implying the data
  model *could* link back to a sales order line item) but is an empty array
  on all 34 sampled — never actually populated in this account's real usage.
  Confirmed 0 POs for Sames across all 298 of its sales orders' own
  `/purchasings` sub-resource. Import these as standalone records; don't
  build any customer/job attribution logic for them.
- **`actual_seconds` (from `pro_jobs/{id}/steps`' `actualTime`) is CYCLE TIME,
  not labor time.** Summed across Sames' 1,168 completed steps: ~14,201
  hours, ~12h/step average — only sensible as wall-clock-between-state-
  transitions (a step opened Friday, closed Monday, racks up the whole
  weekend). Confirmed via the Customer Review cross-check: a 49-second gap in
  the job's own activity feed against `actualTime:48` for that exact step.
  **`manualTime` is the real labor-time candidate** — non-zero on 703 of
  3,243 Sames steps, consistently much smaller and plausible as real work
  (e.g. one step: `manualTime "0:15:38"` against that same step's
  `actualTime` of 56,299s/~15.6h). Does NOT correlate with `hasTimeSpents`
  (every populated `manualTime` example had `hasTimeSpents:false` — that flag
  isn't a reliable "has real time data" signal either). No separate GET
  endpoint exposing per-entry time logs was found; "Record Time Spent" is a
  write-only UI action, never exercised, per the read-only rule. Migration
  187 added `manual_time_seconds`/`estimated_user_seconds`/
  `estimated_machine_seconds` — parsed from the H:M:S text via
  `parseHMSToSeconds()`, which returns `null` (never `0`) for a missing/empty
  value, since "no labor recorded" and "zero labor" are different facts. In
  practice ShopVOX never actually sends a missing value — always at least
  `"0:0:0"` — so the null path is correctly implemented but not yet exercised
  by real data.
- **`job.orderId` points at the job's CURRENT stage, not always an invoice.**
  `job.transaction.type` can be `"Quote"`, `"WorkOrder"`, or `"Invoice"`
  depending on how far the deal has progressed. The original discovery code
  hardcoded `discover('invoice', orderId)` — wrong whenever a job's parent
  hadn't been invoiced yet, which queued the same uuid twice (correctly as
  `sales_order` from enumeration, incorrectly as `invoice` from discovery),
  producing a 404 on capture. Fixed to read `job.transaction.type` and map to
  the real entity kind.
- **Email `parent.type` values seen**: `JobProof` (has `parent.jobId`),
  `Invoice`/`Quote`/`WorkOrder`/`Payment` (has `parent.id` = that
  transaction's own uuid), and `Company` (a general customer email not tied
  to any specific transaction/job — `parent.id` IS the customer's uuid
  directly). There is no flat `companyId`/`transactableId`/`transactableType`
  field on the email record itself — an early assumption that turned out
  wrong; `customer_shopvox_id` has to be resolved by looking up the parent
  record (already loaded in the same import run) via `parent.type`/`.id`/
  `.jobId`. A parent record outside the current run's loaded scope (not
  captured, or a different customer entirely — e.g. an email pointing at a
  legacy-numbered invoice never enumerated at all) resolves to `null` and is
  logged as a parse failure, not silently dropped.
- **Sales leads are a genuinely separate ShopVOX resource from Quote** — own
  `id`/`workflowState`/`dealValueInDollars`, not a Quote sub-status. Confirmed
  via network capture of the Sales Leads board (`sales_leads?...`, wrap key
  `salesLeads`). `shopvox_transactions.kind` has a CHECK constraint that
  explicitly rejects `'sales_lead'` — confirmed live by attempting the
  insert — so it needed its own table (`shopvox_sales_leads`, migration 186).
- **Line item `productType: "Custom"` → no cost data, and that's correct, not
  a gap.** All 119 of Sames' null-`buying_cost` line items are `Custom`-typed
  with a `productId` that 404s against `products/{id}` — one-off typed-in
  line items never tied to a catalog Product, genuinely no cost to fetch.
- **Cross-customer-boundary attribution isn't limited to closure-discovered
  jobs — it also happens for ordinary transactions (quotes/sales
  orders/invoices) discovered directly off a customer's own transaction
  list.** Confirmed live on Fuel America: 9 of its 969 queued transactions
  and 3 of its 323 queued jobs, per their own captured `companyId`, actually
  belong to **"Fuel America (Encinal Exit 32)"** (`686a468c-9da4-446f-8866-
  e58931360eda`) — a separate ShopVOX company record for a sibling branch
  location, swept into Fuel America's discovery scope the same way Sames'
  discovery reached a job belonging to "Anissa Trevino." Same root cause,
  same correct behavior: the importer writes each record under its own real
  `customer_shopvox_id`, not under whichever queue file happened to discover
  it. **Practical upshot for reconciliation**: comparing "queue file X's
  predicted row count" against "live DB rows filtered by customer X's uuid"
  will show an apparent shortfall whenever any of X's queued records
  actually belong to a sibling/related company — checked live for Laredo
  Chamber of Commerce (3 tx + 1 job → `429d6b08-465e-4ff0-8030-83ce1ae07163`),
  Laredo Heat Soccer Club (2 tx + 1 job → `c16f432d-927a-4883-9ff9-
  d1d2e0f54298`), and Indiana Transport SA de CV (3 tx + 3 jobs → Indiana
  Transport LLC itself, `3eb23018-...`; 3 tx + 4 jobs → a third company
  `0e48586b-2ee5-48d0-b1d5-cb665af61858`) — every one of these fully
  accounted for the apparent gap; zero records were actually missing from
  the DB in any case checked. Don't conclude "not imported" from a
  by-queue-file count mismatch alone — check `found in DB under ANY
  customer_shopvox_id` before concluding anything is actually missing.
- **The `job.orderId`-mistagging phantom-capture class (workflow rule 7)
  also produces "done"-status queue rows, not just the "skipped"/"failed"
  ones seen on Sames/Bolillos.** Indiana Transport SA de CV's queue has 3
  transaction uuids each queued twice under two different entity tags (e.g.
  `sales_order` + `invoice` for the same uuid) — both captured, both marked
  `done`, but the wrong-tag capture's `detail` endpoint is a 404 (`{"error":
  "Record Not Found"}`) with only cosmetic sub-endpoints (taggings/
  activities/emailed_documents) returning 200. `import-api-capture.mjs`
  already handles this correctly on its own — the "expected wrap key not
  found" check (line ~190) rejects the malformed capture as a **parse
  failure** and never builds a row from it, so it can't silently overwrite
  the real (correctly-tagged) capture's data via the `shopvox_id` upsert
  key. Confirmed live: Indiana Transport SA de CV's dry run reports exactly
  3 parse failures, all three of this exact shape, and the resulting DB row
  count matches the customer's real (non-phantom, non-cross-customer) total
  exactly. Harmless as long as the importer's wrap-key check keeps catching
  it — but the queue's own done/skipped bookkeeping doesn't distinguish this
  case from a real success, so don't trust "done" alone as proof a captured
  row is real; the importer's parse-failure count is the actual signal.
- **CORRECTION (2026-08-24): "Sames Auto Arena has a flat-print-only
  profile" — stated as fact earlier in this document and used to justify
  the whole contrast-customer selection — is WRONG.** Ruben (who knows this
  business) said Sames does wraps, fabrication, and installs; that
  characterization came from an earlier session eyeballing imported data,
  not from him. Checked directly against `shopvox_line_items` (1,814 rows,
  40 distinct categories, 155 distinct product names) plus job
  `workflow_name` and BOM `material_name` as corroborating signals:
  Sames' line items include `Wall Wrap` (13), `Full Wrap` (2), `Routed
  Substrates` (64), `Fabrication Materials` (6), `Channel Letters` (3),
  `Electrical Materials` (3), `Assembly` (3), plus `Install LF` (82),
  `Installation` (38), `Removal` (29), `Repairs` (20) — none of that is
  print. Job `workflow_name` has a `Channel Letter (Vinyl Transfer/ Multi
  Color)- Design, Permit, Fabrication & Installation` job and 39
  `Installation Only` jobs. BOM materials include heavy `Zund` cutting/
  routing/stencil labor (CNC fabrication, not flat printing) alongside the
  print-process labor. **Quantified**: wraps+fabrication+install/removal/
  repair categories are 263 of 1,814 line items (14.5%) — a real,
  substantial secondary line of business, not zero and not negligible.
  Print-proper categories (rigid/digital/lightbox/banner/posters) are ~50%
  by volume, so Sames genuinely *is* print-dominant by revenue mix, but
  "flat-print-only" is false — the "only" is the specific error. The
  correct read: Sames is print-dominant with a real wrap/fab/install tail;
  the 11 contrast customers (5,872 line items combined, 66 categories, 356
  product names) are more categorically diverse mainly because they're 11
  *different businesses* combined (a bank, a soccer club, an oil company,
  a university, restaurants, etc.) each contributing a few business-specific
  categories/products — not because any single one of them is more
  structurally varied than Sames on its own. Checked whether missing
  `category` data on Sames specifically caused the original misread — no:
  Sames' null/empty-category rate (6.6%) is BELOW the whole-table average
  (10.6%) and far below Bolillos Cafe (38.0%) or Fuel America (24.5%);
  `product_name` is never null anywhere (0.0% across every customer
  checked). So the wrap/fab/install categories were sitting right there in
  correctly-captured data the whole time — this was a reading error, not a
  capture/import gap. Whole-table null-category rate (10.6%, all 7,721
  `shopvox_line_items` rows currently imported — nothing outside these 12
  customers is in the table yet, confirmed live) is moderate, not the kind
  of systemic-loss number that would call the main run's category field
  into question; per-customer rate varies widely (0.0%–38.0%) and tracks
  individual customers' use of un-cataloged `Custom`-typed line items (see
  the existing `productType: "Custom"` structural finding above), not a
  uniform capture defect.

## Every bug found and fixed (symptom → cause → fix, so the same class is
caught faster next time)

1. **Statement timeout on `shopvox_transactions` upsert.** Symptom: `canceling
   statement due to statement timeout`. Cause: raw jsonb payload per row
   averages 182KB, max 3MB (the FULL captured record — every endpoint, every
   line item — deliberately richer than the old DOM-era importer's
   single-page raw); batch of 100 rows per statement was too much. Fix:
   per-table batch size override (`BATCH_SIZE` map in `import-api-capture.mjs`
   — transactions: 10, jobs: 25, line_items: 25; default stays 100 for
   small-payload tables).
2. **Cascading NOT NULL violations after the transactions upsert failed.**
   Symptom: `shopvox_line_items`/`shopvox_transaction_charges` failed with
   `null value in column "transaction_id"`. Cause: the script continued to
   the FK-backfill SELECT even though the prerequisite table's write had
   errored, silently working from a stale/incomplete id map. Fix: hard-abort
   (`process.exit(1)`) if `shopvox_transactions`/`shopvox_jobs`/
   `shopvox_emails`'s own write reports an error, before touching anything
   downstream.
3. **`shopvox_emails`/`shopvox_email_attachments` upsert failed**: `no unique
   or exclusion constraint matching the ON CONFLICT specification`. Cause: an
   assumed-safe natural key (`shopvox_id`) that turned out to have no actual
   DB constraint backing it. Fix: switched both to delete-then-insert, same
   pattern already used for `shopvox_transaction_charges`/`shopvox_bom_items`.
4. **The 1,000-row silent cap** (see API quirks table above) — same fix
   pattern, paginate every `.select()` that could exceed it.
5. **The 700+-id `.in()` Bad Request** (see API quirks table above).
6. **The BOM triple-count** (see structural findings above) — fixed via
   terminal-stage-only import, with delete-without-replacement tracked and
   logged separately from normal replacement so a nonzero count is legible,
   not silently absorbed.
7. **The email `customer_shopvox_id` mapping was 0 for 0f 931 Sames emails.**
   Cause: assumed fields (`companyId`/`transactableId`/`transactableType`)
   that don't exist on the real record — a guess made before inspecting real
   captured data. Fix: resolve via `parent.type`/`.id`/`.jobId` against
   already-loaded records (see structural findings above). A second bug
   inside the fix: the job-lookup fallback used `job.companyId` without also
   trying `job.company?.id` (the real nesting, same pattern as transactions)
   — caught via the dry-run's parse-failure count (564 → 36 after the real
   fix, few enough to inspect individually).
8. **`job.orderId` mis-tagged as always-an-invoice** (see structural findings
   above).
9. **Email `parent.type: "Company"` unresolved** (see structural findings
   above) — never seen on Sames, surfaced immediately on the first contrast
   customer that had a general (non-transaction-attached) customer email.
10. **The drain-loop bug**: rows appended to the queue mid-run (a captured
    record's line item pointing to a job/parent transaction not yet queued)
    were fixed once at the top of the loop into a snapshot array and never
    revisited — they sat `pending` forever, only picked up by a totally
    separate later run. 11 jobs were stranded exactly this way on Sames
    alone. Fixed: `drain()` now loops with a `scanCursor` that keeps
    re-scanning forward until nothing pending remains (amortized O(n) over
    the whole run, not O(n) per stale rescan), instead of stopping at the
    initial snapshot's length. A `--limit` cap still works as a deliberate
    stopping point (smoke tests), tracked via `reachedCompletion` so the
    closure pass (next item) only runs after a REAL completion, not a capped
    partial run.
11. **Two capture processes racing on one queue file** (see workflow rule 6
    above) — fixed with a pid-liveness lock file.
12. **A login-detection race** in `ensureLoggedInLazy()` (`chain-capture/
    _lib.mjs`): checked `page.url()` for a `/sign-in` redirect immediately
    after `page.goto()`, but the SPA's auth guard redirects via client-side
    JS *after* the initial DOM loads — the check could run before the
    redirect fired, wrongly concluding "already signed in" on a genuinely
    fresh, unauthenticated browser profile. Fixed with a `sleep(1500)` before
    checking. Only surfaced when a second (deliberately separate, unshared)
    browser profile was used for the first time — the primary session had
    never exercised this path since it was always already logged in.

## Job-discovery closure pass — what it is, what it isn't

`pro_jobs/list` cannot enumerate voided jobs (see above). The only route to
them is whatever *other already-captured data* references them — a
transaction line item's `jobId`, an email's `parent.jobId`/`.id`, a job's own
`referenceJobId`. `closureScanJobs()` in `shopvox-capture.mjs` scans every
`'done'` row's capture file for these, queues+captures anything not already
known, and repeats until a pass finds nothing new. Wired in as an automatic
post-drain step — runs only when `drain()` reports `reachedCompletion: true`
(a real finish, not a `--limit`-capped partial run).

**Stated plainly, every time this runs**: a voided job referenced by NOTHING
in the customer's captured data stays invisible to this too. Closure raises
confidence, it does not prove completeness. On Sames: 423 enumerated → 445
after closure (22 found this way, all confirmed `workflowState:"voided"` by
direct fetch), stable across two independent passes. That 22 is the most
complete number this pipeline can currently produce, not a proven ceiling.

**Confirmed property: closure crosses customer boundaries, and a job's
membership in a given customer's queue file does NOT determine which
customer it gets attributed to on import.** Found live: of Sames's 22
closure-discovered jobs, one (`b1db17b9-...`, reached via two of Sames's own
emails referencing it) belongs to a completely different ShopVOX company
("Anissa Trevino") — its own `companyId` says so. The importer correctly
wrote it under its real customer, not under Sames just because Sames's queue
file was the one that happened to discover and capture it. This is correct
behavior, not a bug: a queue file is a *discovery scope* (where to look), not
a *customer filter* (who owns the record) — those are different things, and
conflating them would be the actual mistake. Anything that counts "jobs for
customer X" by counting rows in customer X's queue file, rather than by the
job's own `customer_shopvox_id` in the database, will be wrong by however
many jobs closure reached across a boundary like this one.

## Current state (as of this writing — check queue files and Supabase for
what's actually current by the time you read this, don't trust this section
past a fresh reconciliation)

- **Sames Auto Arena** (`8f903be5-05db-49f3-826e-11997893f2f8`): fully
  captured (445 jobs after closure, everything else per its queue file),
  imported to Supabase (13 tables, all succeeded) — **but the live import is
  stale relative to the full 445-job closure result**; the last real import
  ran before closure found the extra 22 voided jobs. Re-running
  `import-api-capture.mjs` over Sames' queue file is idempotent and safe, just
  hasn't been done since closure landed.
- **Main queue** (`scripts/queue/queue.jsonl`): 28,980 rows after the
  voided-coverage passes (was 27,602). `sales_lead` is a new entity here
  (1,185 rows — never enumerated account-wide before). Per-entity deltas and
  exactly which came from today's `active=false`/new-entity passes vs. other
  discovery are in the conversation history / `scripts/queue/_totals.json`.
- **Twelve contrast customers** (deliberately chosen for structural variety —
  vehicle wraps, fabrication, institutional POs, a university, a bank,
  restaurants — vs. what earlier sessions assumed was Sames' flat-print-only
  profile — **that assumption is WRONG, see the correction below**): all 11
  resolved-uuid
  customers finished capturing as of 2026-08-23 (Fuel America last, 7:14 PM).
  **All 11 are now confirmed imported** (verified 2026-08-24 session, by
  querying live `customer_shopvox_id` counts, not trusting any prior success
  log): TAMIU, El Despecho, Indiana Transport LLC, International Bank of
  Commerce, Bolillos Cafe, Arguindegui Oil Co, and Aimlag Properties matched
  their queue files' predicted row counts exactly on first check. Laredo
  Chamber of Commerce, Laredo Heat Soccer Club, Indiana Transport SA de CV,
  and Fuel America each showed an apparent shortfall (a few tx/jobs missing
  per customer) that turned out to be **fully explained by legitimate
  cross-customer attribution** (see new structural finding below), not
  missing data — re-querying by the real sibling customer_shopvox_id(s)
  accounted for 100% of the gap in every case. Fuel America additionally
  turned out to already have a successful `historical_import_runs` row from
  2026-08-24T00:16 UTC (~2 min after its capture finished) predating this
  verification session entirely — the belief that it "wasn't imported" was
  wrong; a second idempotent run was performed anyway as a confirmatory
  no-op and both runs' end states match. **"Dos Marias" never resolved for
  the contrast set** — zero exact-name matches; three branch-suffixed
  variants exist (Zapata Hwy / Santa Ursula / McPherson) and nobody's picked
  which one, if any, was meant. Don't guess. (Note: a customer_self-only
  stub for the Zapata Hwy variant, `0d11334d-cdb4-4bfe-bcd8-a0b89f7aebcb`,
  already exists on disk at `scripts/queue/customer-0d11334d-....jsonl` and
  `scripts/capture/customer/0d11334d-....json` — timestamped
  2026-08-24T00:18 UTC, ~4 min after Fuel America's capture finished and
  well before the 2026-08-24 verification session started. It has never been
  enumerated beyond the customer record itself. Whoever created it did not
  leave a note — treat it as inert, not as a green light to proceed with
  Dos Marias.)
- **Customer backfill** (`public.customers.shopvox_id`): 4,553 set, 13 still
  null. **2026-08-24 session pulled live detail+contacts+transaction-counts
  for all 3 duplicate-name blockers plus a live email/phone search for
  Hector Valdez** (`scripts/api-probe/13_endpoint_confirm_and_customer_lookups.mjs`
  + `14_hector_valdez_followup.mjs`, raw output in the matching `.json`
  files) — reported to Ruben for a human decision, nothing written to
  `shopvox_id`:
  - **`commerce bank`**: the two records ARE clearly distinguishable, not a
    coin-flip — `e3bd9b95-94a1-42d7-96f8-cc9c239955bc` is active, `status:
    "sold"`, 6 contacts, 7 transactions, updated as recently as 2024-09-23.
    `3c76b950-3884-4d98-b26a-f03c47c536e6` is inactive, `status: "lead"`,
    `legalName: "COMMERC001"` (a legacy-import artifact code), 0 contacts, 0
    transactions, last touched 2021-03-08 — a dead lead entry. **New
    finding**: the active record's contacts are ALL `@ibc.com` addresses
    (`strevino@ibc.com`, `JulissaGalvan@ibc.com`, `aldoguerrero@ibc.com`,
    `eliazarsilva@ibc.com`), and `JulissaGalvan@ibc.com` / "Julissa D.
    Galvan" is independently also a contact on **International Bank of
    Commerce** (`84973c15-...`) itself. Both are on San Dario St. in Laredo
    (Commerce Bank: 5800 San Dario; IBC: 1320 San Dario Ave. — different
    block, same street). Reads like two branches/departments of the same
    real bank filed as separate ShopVOX customers, not an unrelated
    "Commerce Bank" — worth Ruben's judgment on whether `commerce bank`
    should even resolve independently of IBC.
  - **`nezt real estate group`**: also clearly distinguishable —
    `6c22741a-...` active/`closable`, 1 contact, 1 transaction;
    `f829c137-...` inactive/`lead`, 0 contacts, 0 transactions. Same email
    (`linda@neztgroup.com`) and phone on both — the inactive one looks like
    an abandoned duplicate lead entry that predates the real customer
    record, both created the same minute (`2021-01-26T10:40:41`).
  - **`ralph morales`**: **this one contradicts the prior "genuinely 2 real
    records" conclusion** — `098dac3c-...` and `5f7808ee-...` are identical
    in every field checked live: same email, same (null) phone, same
    contact, both `active: true`/`status: "lead"`, 0 transactions each, and
    **`createdAt`/`updatedAt` match to the exact second**
    (`2023-07-24T17:41:39`). Nothing distinguishes them and neither reads as
    more "live" than the other. This looks like an accidental double-submit
    duplicate, not two real customers — flag for re-review before backfill,
    don't treat the earlier note as settled for this one specifically.
  - **`Hector Valdez`** (PrintOS `46cae596-9c87-4e36-9b6e-7d7aba54106c`,
    email `h.valdez66@yahoo.com`, phone `956-237-2425`, `status: sold`):
    exact-email search found exactly one live company,
    **`60ae4e44-d134-43c2-9901-7156cf7444fa`, "HZV Backhoe Services,
    Inc."** — `primaryEmail` and `primaryContact.email` both
    `h.valdez66@yahoo.com`, `primaryPhone`/`primaryContact.phone` both `+1
    956-237-2425` (same number as PrintOS once you add the country code —
    phone search by raw digits/dashes/parens all returned 0, only the
    `+1 956-###-####` format matched; that formatting quirk is worth
    remembering for any future phone-based search on this account),
    `primaryContact.name: "Hector Valdez"` exactly, `status: "sold"`
    matching PrintOS, active, 10 transactions. Zero other candidates by
    phone in any format tried, active or inactive. This is why the
    name-only local cache never found him — he's filed under his business's
    legal name, not his own. Strong single candidate; not written anywhere,
    awaiting Ruben's decision.

  Zero duplicate `shopvox_id` values, independently verified (from an
  earlier session, unaffected by the above).
- **Customer linkage finished 2026-08-24: 4,560 customers, 4,558 with
  `shopvox_id`, 0 duplicates, 0 test customers.** The 2 unmatched are dead
  leads with zero ShopVOX transactions, deliberately left unmatched.
- **`is_active` pre-flight (2026-08-24), NOT written yet — number only.**
  Capture format DOES store each customer's live ShopVOX `active` flag
  (`company.active` in the `customer` entity's `detail` endpoint — confirmed
  on all 13 existing `scripts/capture/customer/*.json` files, all `true`
  since none of the 12 pilot customers happen to be inactive).
  `public.customers.is_active` already exists (boolean, default `true`,
  confirmed live via PostgREST's OpenAPI doc) — the import path can map to
  it directly once customer-entity capture exists for everyone; **that
  import step doesn't exist yet** (`customer` is currently a 0-destination-
  table entity, see the structural finding above — capturing it is not the
  same as importing it). Ran a live `companies?active=equal:false` sweep
  (7 inactive companies account-wide, matching the earlier-documented
  count) and cross-referenced against all 4,558 matched customers
  (correctly paginated this time — see the caught-live 1000-row-cap note
  right below this one): **4 of 4,558 matched customers are inactive in
  ShopVOX** — TP Houston Sur LLC, Daphne Art Foundation, Eduardo Lozano,
  Print Place (uuids in `scripts/api-probe/15_preflight_session_and_active_check.json`).
  The other 3 ShopVOX-inactive companies (including the Commerce Bank and
  Nezt Real Estate Group dead-duplicate records from the earlier duplicate-
  name investigation) are NOT matched to any PrintOS customer — consistent
  with the backfill having correctly picked the live twin over the dead one
  in both cases. **Caught live while building this check**: an unpaginated
  `.select()` on `customers` silently capped at 1000 rows (same class as
  the historical `shopvox_transactions` 1000-cap bug) and would have missed
  3,558 of the 4,558 matched customers — corrected before trusting the
  number, not after. **Business rule for `is_active` (Ruben, 2026-08-24):
  closed or dormant customers are DISABLED, never deleted.** Full history
  stays preserved and reportable; a disabled customer is excluded from
  marketing, pickers, and active-customer counts, but every quote/job/
  invoice/payment tied to it stays intact and queryable exactly as before.
- **Phantom-entity-mistag guard added to `shopvox-capture.mjs` (2026-08-24)
  — SMOKE-TESTED, both synthetically and live.** `main_discover()` now
  checks, before queuing a new discovery, whether that exact uuid already
  has a `done` row under a DIFFERENT entity — if so it queues the new row
  as `status: 'skipped'` with a `reason` field naming the phantom class,
  instead of `pending`. Only catches the case where the correct-kind row
  already finished by the time the wrong-kind discovery fires (order-
  dependent, not a structural guarantee) — still strictly better than the
  status quo, which queued every mistagged uuid as `pending` and let it
  burn a full capture attempt before 404ing. Skipped rows were already
  naturally excluded from `drain()`'s pending scan and from every
  completion check. To make it testable at all, `main_discover`,
  `rowUrl`, `ALL_ENTITY_KINDS`, and `findNextPendingIndex` (drain()'s
  pending-scan predicate, pulled out unchanged so the test asserts against
  the real code path) are now exported, with `main()`'s auto-invocation
  guarded behind an `import.meta.url` check — importing the module no
  longer launches a browser. Synthetic test:
  `scripts/api-probe/16_phantom_guard_synthetic_test.mjs`, 13/13 assertions
  pass — the mistag-produces-skipped-with-reason case, the
  skipped-row-invisible-to-findNextPendingIndex case, the normal-pending
  case, the done-vs-only-pending boundary (guard must NOT fire on a merely
  `pending` conflicting row), and same-key idempotency. A live 20-record
  slice (see below) couldn't exercise this branch on its own, as expected —
  no mistagged discovery occurred in 20 plain refunds — which is exactly
  why the synthetic test was necessary rather than optional.
- **`maxOuterIterations = 10` added to the drain↔closure outer loop in
  `main()` (2026-08-24) — smoke-tested live, cap not exercised (only
  reached outer iteration 1/10).** Was unbounded — if any row ever stayed
  `pending` without `drain()` resolving it to `done`/`failed`/`skipped`
  (not yet observed, but nothing prevented it), the loop would alternate
  forever with zero error output, exactly the kind of silent hang a 2-3 day
  unattended run wouldn't surface until someone checked on it days late. On
  exhaustion: loud console error naming the queue file to inspect,
  `process.exitCode = 1`, then falls through to the normal `context.close()`
  — a clean exit, not a crash, lock file releases normally via the existing
  `process.on('exit')` handler. Added an unconditional `Outer iteration
  N/10` log line at the top of the loop after the first smoke-test attempt
  showed the original placement (inside the "still pending after closure"
  continuation branch only) never fires at all on a `--limit` run, since
  `--limit` always exits after iteration 1 before closure runs — caught by
  actually running the smoke test, not by reasoning about the code.
- **Live smoke test, 2026-08-24: `node scripts/shopvox-capture.mjs
  --limit=20` against the main `queue.jsonl`.** Clean: no crash, 20/20
  capture files landed on disk (independently confirmed by filename, not
  just the run's own count), lock file created and released (confirmed
  absent immediately after exit), rate limiting held at ~2 req/sec (80
  endpoint calls — refund captures are `detail`+`taggings`+
  `previous_transactions`+`next_transactions` only — in 40.4s), the new
  `Outer iteration 1/10` line printed. Queue re-verified in a **separate**
  process per rule 9: done 53→73 (exactly +20), pending 28,927→28,907
  (exactly −20), failed=0, skipped=0, total unchanged at 28,980. Then
  imported those exact 20 (a temp queue file scoped to just their rows, to
  keep this test attributable — the main queue's other 53 `done` rows are
  unrelated pre-existing `credit_memos_migration`/`refunds_migration` seed
  data, not part of this test) via `import-api-capture.mjs`: 20/20 landed
  in `shopvox_transactions` (kind=`refund`), 0 elsewhere — correct, since
  `captureSimple()` never fetches line-item/activity/BOM/proof endpoints
  for `payment`/`refund` kinds in the first place. Re-verified in a
  **separate** script (rule 9 again): 20/20 found live by `shopvox_id`,
  `historical_import_runs` row confirms `succeeded` with matching
  `records_seen`/`records_captured`. This is the first time
  `import-api-capture.mjs` has been run against main-queue-sourced records
  rather than a customer-scoped queue file — no divergence found.
- **The full 57,000-record main run has NOT been started.** Explicitly held
  back at every step of this investigation pending exactly the kind of
  verification this document describes.

## Promotion (staging → native): progress so far

- **Migration A landed and is verified (2026-08-24).** `shopvox_id` (uuid,
  nullable), `shopvox_imported_at` (timestamptz, nullable), `is_historical`
  (boolean, not null, default false) now exist on `quotes`, `sales_orders`,
  `invoices`, `jobs`, `payments`, `refunds`, `quote_line_items`, each with a
  partial unique index on `shopvox_id` (`WHERE shopvox_id IS NOT NULL`), plus
  an `enforce_historical_immutability` BEFORE UPDATE OR DELETE trigger on all
  seven that raises when `OLD.is_historical` is true. Bypass for the
  (not-yet-built) promotion step is a session-local GUC —
  `SET LOCAL printos.bypass_historical_lock = 'on'` — which only works if the
  promoter runs its writes over a single directly-controlled Postgres
  transaction (not discrete PostgREST/supabase-js REST calls, which don't
  share transaction state). The quote/job number-trigger overwrite bug
  (`set_quote_number_trigger`, `set_job_number_before_insert` — both
  unconditional, unlike the guarded `sales_orders`/`invoices`/
  `purchase_orders` equivalents, confirmed from migration source only,
  **still not independently confirmed live** — no `DATABASE_URL`/pg_proc
  access from the script environment) was deliberately left unfixed pending
  that live confirmation, which Ruben has not yet reported back.
- **Status vocabulary rule (Ruben, 2026-08-24), non-negotiable: KEEP
  SHOPVOX'S STATUS NAMES EXACTLY, no translation/mapping to a PrintOS
  equivalent. Any renaming/consolidation decision happens at cutover, not
  during import.** All ShopVOX status values now exist natively: `invoices`
  CHECK gained `draft, sent, paid, partial, overdue, void, closed, past_due,
  open`; `quote_status` enum gained `won, void` (confirmed live: full enum is
  now `draft, sent, approved, declined, delivered, customer_review,
  approve_with_changes, revise, ordered, hold, expired, lost, pending,
  no_charge, won, void`); `job_status` enum gained `voided, hold` (confirmed
  live: full enum is now `new, in_progress, proof_review, ready_for_pickup,
  completed, on_hold, pending_approval, voided, hold`); `sales_orders` CHECK
  was already a superset, unchanged.
- **Decision (Ruben, 2026-08-24): sales orders and invoices get their own
  line items, not shared via `sales_orders.quote_id`.** The current design —
  a sales order's lines are its quote's lines, reached through
  `sales_orders.quote_id` — cannot represent the 108 historical sales orders
  and ~117 invoices that never had a quote, and cannot represent change
  orders or partial invoicing going forward. This is a real limitation in
  the live app, not only a migration problem. Migration C adds
  `sales_order_line_items`/`invoice_line_items` mirroring `quote_line_items`.
- **Migration C landed and verified (2026-08-24).** `sales_order_line_items`/
  `invoice_line_items` created (28 columns each), `quote_line_items` gained 9
  columns (`category`, `secondary_category`, `unit`, `price_per_uom`,
  `buying_cost`, `markup`, `list_price`, `product_description`,
  `internal_notes`), `quantity` is `numeric` on all three tables, RLS on the
  two new tables mirrors `quote_line_items`'s actual live policy shape (a
  positive allow-list — `organization_members.role = ANY (ARRAY['owner',
  'admin', 'member']::org_role[])` — confirmed live via `pg_policies`, not
  assumed from migration source, which had two conflicting versions).
  `price_per_uom` was included despite being confirmed live-identical to
  `unit_price` on all 9,807 `shopvox_line_items` rows (same duplicate
  relationship as `unit`/`area_uom`) — flagged, kept anyway per Ruben's
  explicit call. `income_account`/`cog_account` deferred (QuickBooks scope);
  `shopvox_line_items.raw` retains them regardless, nothing is lost by
  deferring. **Note**: `unit_price` ended up `numeric` on all three tables in
  the applied SQL — the drafted migration had left it `integer` (cents)
  pending the decimal-place decision below, so this was a deliberate
  deviation from the draft, not an oversight; recorded here so the two don't
  read as contradictory later.
- **Decimal-place business rule (Ruben, 2026-08-24) — categorization is
  settled, the `unit_price` rounding consequence is NOT yet decided.**
  Customer-facing money is **2 decimal places**: `quotes`/`sales_orders`/
  `invoices` — `unit_price`, `total_price`, discounts. Internal cost/rate
  data may use **4 decimal places**: `buying_cost`, `markup`, `list_price`,
  `price_per_uom`, and material costs. Two parts of this are confirmed safe
  by measurement: `price_per_uom`/`buying_cost`/`markup`/`list_price` keep
  full ShopVOX precision (uncontroversial), and `total_price` is written
  exactly as ShopVOX recorded it, never recomputed (0 fractional-cent
  violations across all 9,807 `shopvox_line_items` rows — safe, and it's the
  number that reconciles against ShopVOX's own totals, e.g. Sames'
  $1,191.18). **The open part**: rounding `unit_price` to 2 decimals for
  display, on lines where `total_price` is stored independently at full
  precision, produces a visible mismatch on some lines — `quantity ×
  rounded(unit_price, 2)` vs. the recorded `total_price` diverges by more
  than $1 on 47 of the 423 fractional-cent-`unit_price` rows (11.1%),
  worst case $330 (78,000 units × a $0.0442 rate rounds to $0.04, computed
  $3,120 vs. recorded $3,450). All the worst cases share the same shape:
  very high quantity (thousands–tens of thousands) × a very small per-unit
  rate, where a sub-cent rounding error gets multiplied by quantity into a
  real dollar amount. `total_price` itself stays correct either way (it's
  never recomputed) — the risk is a rounded `unit_price` sitting next to an
  unrounded-derived `total_price` reading like a math error to anyone doing
  the multiplication by eye. **DECIDED (Ruben, 2026-08-24): store
  `unit_price` exactly as ShopVOX recorded it — no rounding in promotion,
  ever.** Settled by the worst case itself: 78,000 units × $0.0442 = $3,450
  is a real invoice the customer holds a copy of; rounding to $0.04 would
  make a reprint show $3,120 next to a $3,450 total — a document that
  contradicts the original and can't be sent to anyone. Ruben requires
  historical invoices to be printable/sendable as-is. **This does not
  conflict with the 2-decimal customer-facing rule above** — that rule
  governs what PrintOS *creates* going forward (enforced on input for new
  records in the app); historical documents *reproduce* what ShopVOX
  created, unrounded. Two different rules for two different provenances,
  not a contradiction.
- **Promoter built: `scripts/promote-shopvox-to-native.mjs`** — staging
  (`shopvox_*`) → native tables (`quotes`, `sales_orders`, `invoices`,
  `jobs`, `payments`, `quote_line_items`, `sales_order_line_items`,
  `invoice_line_items`), scoped to one `--customer=<shopvox_customer_uuid>`
  per run, `--dry-run` by default, `--apply` required to write. Writes
  `is_historical = false` on everything (Ruben's rule — sealing to true is a
  separate later step), which means the `enforce_historical_immutability`
  trigger never fires against this script's own writes in this phase, so no
  `SET LOCAL` bypass / direct Postgres connection was needed. Idempotent via
  a resolve-existing-id-by-`shopvox_id`-then-upsert-on-`id` pattern (`id` is
  a normal, non-partial index — works around `shopvox_id`'s partial unique
  index not being usable as a supabase-js `.upsert()` conflict target).
  Money: native `unit_price`/`price_per_uom`/`buying_cost`/`list_price` are
  cents columns but `numeric` (not `integer`) since Migration C, so staging
  dollars × 100 is stored at full precision, unrounded (matches the
  unit_price-exact decision above); `total`/`subtotal`/`tax_total`/
  `total_price` are `integer` cents, rounded on write. Line items have no
  real per-line ShopVOX id (`shopvox_line_items`'s own natural key is
  `(transaction_shopvox_id, position)`, not a standalone id) — the
  promoter's `shopvox_id` on the three line-item tables is a deterministic
  synthetic uuid (sha256 of `transaction_shopvox_id:position`), stable
  across re-runs but not a genuine ShopVOX identifier.
- **2026-08-24: Supabase had a real outage mid-development of the
  promoter** — confirmed on Supabase's own status page (API Gateway
  degraded performance + an intermittent 401/JWT incident), not a local or
  script problem (independently verified: a minimal 13-query probe against
  unrelated tables failed identically, ruling out anything specific to the
  new script). **Treated as a free test of the design**: because the
  promoter is dry-run-by-default and idempotent (resolve-or-mint by
  `shopvox_id`, never assumes a prior run's state), the mid-run 522 failures
  cost nothing and left no partial state — no row was ever written, nothing
  to clean up, nothing to reconcile. Retried once the outage was externally
  confirmed clearing rather than hammering blindly during it. **Keep this
  property when the promoter eventually runs wide across all ~4,500
  customers** — a run spanning days will hit an outage at some point, and
  the same idempotent-resume behavior (safe to just re-run the affected
  customer, or resume account-wide) is what makes that a non-event instead
  of a corruption risk. Same design lesson as the capture pipeline's
  checkpoint/resume behavior (workflow rule 8) — the promoter should carry
  the same "an outage is routine, not a crisis" property when it eventually
  runs at full scale, e.g. real retry/backoff on transient network errors
  rather than a hard fail on the first one.
- **2026-08-24: first `--apply` run against Sames hit a generated-column
  error.** `payments.balance` is `GENERATED ALWAYS AS ((amount_paid -
  applied) - refunded_amount) STORED` — confirmed live (Ruben, via
  `information_schema.columns.is_generated` in the SQL editor), and the
  ONLY generated column across all ten promotion target tables. The
  promoter had been sending an explicit `balance` value (computed
  client-side as `amount_paid - applied`), which Postgres rejects outright
  for a `GENERATED ALWAYS` column — `cannot insert a non-DEFAULT value into
  column "balance"`. Fix: omit the key entirely from the payload (not
  `null` — a present key with any value, including `null`, still trips the
  same error; only a fully absent key lets Postgres compute it). **Why this
  wasn't caught by any earlier live-schema check**: every check in this
  migration used PostgREST's OpenAPI doc (`GET /rest/v1/`) as the
  live-schema source, because it's the only one reachable without a direct
  Postgres connection — and that doc does NOT distinguish a generated
  column from an ordinary one; `balance` looked like a plain nullable
  `integer` in every fetch. The only way to see this live is
  `information_schema.columns.is_generated` (or `pg_attribute.attgenerated`
  in `pg_catalog`), both of which require the SQL editor, not the REST API.
  **Standing rule for whoever writes to a new table in this migration next:
  check `information_schema.columns.is_generated` (and `is_identity`, same
  blind spot, same fix) for every target table before writing to it** — the
  OpenAPI-doc check that's been used throughout this migration is not
  sufficient on its own for this specific class of error.
- **Failure was partial but safe** — a real-world instance of the same
  "outage is routine" property noted above, just from a code bug instead of
  infrastructure. `quotes`/`sales_orders`/`invoices`/`jobs` (369/298/288/444
  rows) wrote successfully before the failure; `payments` and everything
  after it (line items, `payment_applications`) did not run at all. Because
  the promoter resolves existing rows by `shopvox_id` before writing, a
  corrected re-run is expected to update the first four tables in place
  (same content, effectively a no-op) and continue into the untouched
  tables — this is the designed behavior, not yet independently confirmed
  as of this note; see the live verification for whether it held.
- **STANDING RULE (Ruben, 2026-08-25): every numeric column's precision
  must be checked against real staging data BEFORE a migration declares its
  type. Integer is never the default assumption.** Hit four times now,
  the fourth one missed in advance: `quote_line_items.quantity` (390
  fractional rows), line-item `unit_price` (423 sub-cent rows),
  `bom_items.unit_cost` (39% sub-cent — caught in advance because this rule
  was already in effect by then), and `job_workflow_steps.recorded_time_minutes`
  (35% fractional minutes — missed, because this specific column wasn't
  checked before Migration E declared it `integer`; the write failed
  outright, `invalid input syntax for type integer`, caught at write time
  rather than silently truncating). ShopVOX stores computed values, and
  computed values are rarely whole — this applies to *any* numeric-looking
  column, not just money. **Apply this check to `documents`, `proofs`,
  `emails`, and `activity_log` before writing their migrations** — nothing
  in those four has been precision-checked yet.
- **2026-08-25: precision-checked `documents`/`proofs`/`emails`/
  `email_attachments`/`activities` — all clean, 0 fractional values
  anywhere** (`file_size_bytes`, `version`, `view_count`, `comment_count`,
  `sequence`). Unlike the money/time columns, these are already declared
  `integer`/`bigint` in staging itself, so a fractional value could never
  have landed there in the first place — checked live anyway rather than
  reasoned about, per the standing rule.
- **`shopvox_email_attachments` has neither file bytes nor a usable URL —
  confirmed structural, not a capture gap.** The only keys ShopVOX's API
  ever returns for an email attachment, across all 370 Sames rows checked,
  are `id` and `fileName` — no `url`, no `fileUrl`, no size, no content
  type. This is not the proof-download pattern repeated; there is no known
  URL to fetch. **Found and fixed a real, separate mapper bug along the
  way**: `import-api-capture.mjs`'s email-attachment mapper read
  `att.filename ?? att.name`, but the real field is `att.fileName`
  (confirmed live) — `filename` was silently null on all 370 rows despite
  the real value sitting in `raw`. Fixed to check `att.fileName` first.
  Existing already-imported rows still have `filename = null` until a
  re-import; not backfilled as part of this fix.
- **The "we need a third download" fear was wrong — checked, not assumed,
  and the answer is essentially no.** Tested all 370 Sames email
  attachments against `shopvox_documents` (via the parent email's parent
  transaction) and against the just-completed proof download: **368/370
  (99.5%) are the same PDF as an already-captured `shopvox_documents` row**
  (confirmed by embedded invoice/SO number + a 10-row spot-check that the
  matched document's local file exists on disk), **1 more is an exact
  filename match to an already-downloaded proof image**. Only **2 of 370**
  (both payment-receipt PDFs — a doc_type `shopvox_documents` never
  captures) have no already-captured equivalent. `email_attachments`
  promotion needs to *point at* existing `documents`/`proof_versions` rows
  for the 369/370 case, not fetch anything new — a resolution/linking
  problem, not a download problem, at least at Sames' scale.
- **2026-08-25: `email_attachments` resolution order matters, caught live
  in the promoter's own dry run.** Real breakdown for Sames: 365 resolve to
  a `documents` row, **3** resolve to a `proof_versions` row (not 1 — the
  earlier investigation's single spot-check undercounted), 2 unresolved
  (payment receipts). The first version of the promoter code checked
  "does the parent transaction have any document" *before* checking for an
  exact filename match against a proof — since most of a Sames invoice's
  emails have a document (the invoice PDF itself), a proof image emailed
  alongside an unrelated invoice would win the document branch and get
  silently misattributed to that invoice's PDF, still counting as
  "resolved" while pointing at the wrong file. Fixed by checking the exact
  proof-filename match first (more specific signal) and falling back to
  "parent has a document" only when that fails. Migration A/C/E's own bugs
  were all caught by a write failing outright — this one would NOT have
  failed; it would have silently promoted `email_attachments.storage_path`
  pointing at the wrong PDF. Worth remembering as its own class of risk:
  a resolution heuristic with more than one candidate signal needs the more
  specific signal checked first, and "the row wrote successfully" proves
  nothing about which candidate it actually matched.
- **Documents' natural key `(parent_shopvox_id, doc_type)` is not always
  unique** — 5 of Sames' 960 raw `shopvox_documents` rows are the same
  transaction's PDF captured twice: once by the retired chain-capture pilot
  (`captured_at` null, files under `scripts/chain-capture/pdfs/`) and once
  by the real capture pipeline (`captured_at` set, files under
  `scripts/capture/pdfs/`). Promoter dedupes on this key, preferring
  whichever row has `captured_at` set. 955 real distinct documents for
  Sames, not 960 — and not the earlier-reported 886 either, which came from
  a queue-file-scoped count that undercounted because a document's
  discovery path doesn't have to be the same customer-scoped queue file
  that ends up "owning" it (same class of finding as the cross-customer
  attribution notes above) — the DB-direct, fully-paginated count is the
  trustworthy one.
- **`proof_versions.file_url` has nowhere to put the local download path.**
  Unlike `documents` (which has both `storage_bucket` and `storage_path`),
  `proof_versions` has only one file-location column, and the live app
  (`uploadProofCore`) treats it as a real Storage URL, not a local path.
  Migration G didn't add a local-path column (wasn't asked for one at the
  time). Promoter currently leaves `file_url` NULL for every historical
  proof row rather than write a Windows path into a column the app expects
  to be fetchable. **Open decision**: add a local-path column now (small
  follow-up ALTER), or leave it null until the real Storage upload happens.
- **2026-08-25: Indiana Transport LLC promoted — 12th customer done, all 17
  tables, verified in a separate process.** `create-missing-customers-from-shopvox.mjs`
  built and used for real for the first time: created `customers` id
  `9f57ae83-105d-4075-b72f-94b9ce4d65d7` (shopvox_id
  `3eb23018-129a-4309-ad2c-3ed957326295`) plus 2 `customer_contacts`
  (Arturo — primary + AP, last_name fallback to company name; Brenda
  Pulido — neither flag). Independent verification confirmed exactly 1
  customers row, exactly 2 contacts with the dry-run's flags, 0 duplicate
  `shopvox_id` org-wide (4,559 total = distinct), `credit_limit = 0` as
  written. `credit_limit` mapping is still genuinely untested — scanned all
  13 captured customer JSON files for nonzero `creditLimitInDollars` and
  found zero; needs either more captures to land or a known-nonzero
  customer checked directly in ShopVOX's UI before the 93-customer run.
  Promotion itself: 1 quote/1 SO/1 invoice/3 jobs/1 payment/4+4+4 line
  items/1 payment_application/3 transaction_charges/49 bom_items/8
  job_line_items/39 job_workflow_steps/3 documents/4 proof_versions/8
  emails/2 email_attachments, all customer-scoped counts confirmed exact in
  a separate process. Org-wide integrity re-checked and clean: 0 rows with
  `is_historical = true` across all 17 tables, 0 unexpected `shopvox_id IS
  NULL` rows (the 7 pre-existing live-app `proof_versions` rows are still
  the only ones, still `is_historical = false`, untouched). Sames canary
  re-confirmed at exactly $1,191.18. That's all 12 customers now fully
  promoted (Sames + 10 contrast + Indiana Transport LLC).
- **Promoter hardened for the wide run (2026-08-25), built only, not yet
  exercised against anything.** `scripts/lib/retry.mjs` — retry-with-backoff
  (5 attempts, ~15.5s max) on a thrown network failure, HTTP 429, or HTTP
  5xx; a 4xx PostgREST/Postgres error (schema/constraint) still fails
  immediately, never retried. Wired into every read (`resolveCustomer`,
  `resolveIdMap`, and `fetchAllRows` in `scripts/lib/supabase-paginate.mjs`,
  so every staging fetch inherits it) and the apply upsert loop.
  `promote-shopvox-to-native.mjs` gained `--customers=<file>` (newline-
  delimited shopvox uuids) alongside the original `--customer=<uuid>`;
  `promoteOneCustomer()` was pulled out of `main()` so both modes share the
  exact same per-customer logic. Resumability: `--apply` mode appends a
  completed uuid to `scripts/state/promote-progress.txt` (default path,
  override with `--progress=`) and skips anything already in it on re-run;
  `--dry-run` always processes the full list and never touches the progress
  file. `--customers` mode defaults to one summary line per customer + a
  final tally; `--verbose` restores the old full per-table report for each.
  **Regression-tested same day**: dry-ran all 12 already-promoted customers
  through the new `--customers` path — 12/12 succeeded, 0 failed, all 7
  tables that report insert/update counts (`quotes`, `sales_orders`,
  `invoices`, `jobs`, `payments`, `proof_versions`, `emails`) showed 0 new
  inserts across all 12 (pure idempotent no-op, as expected). Confirmed a
  pre-existing (not new) cosmetic report bug: `documents`' insert/update
  label always reads "all new insert" regardless of whether the row already
  exists, because that one count was hardcoded (`existing: 0, fresh:
  documentRows.length`) before this refactor and was never wired through
  `resolveIdMap()` — the actual upsert-on-deterministic-id is unaffected
  and correctly updates in place either way. `scripts/state/promote-
  progress.txt` confirmed untouched by the dry run. Nothing applied.
- **Storage projection (2026-08-25), derived from raw captured JSON on
  disk, not from Supabase staging** — staging (`shopvox_transactions` etc.)
  was found to lag capture badly (4,900 imported rows vs. ~14,400+ raw
  transaction JSON files already on disk at the time), so this used
  `scripts/capture/**` directly. Documents (quote/sales_order/invoice PDFs
  only — no other kind has a pdf endpoint) carry a real measured
  `sizeBytes` recorded in each transaction's own JSON at capture time
  (`endpoints.pdf.sizeBytes`); proofs carry no size anywhere in ShopVOX's
  own JSON (confirmed: the proofs-list endpoint has no size field at all)
  and are only measurable via the locally downloaded file. Result: 2,377
  distinct customers touched by capture so far (of ~4,560 total), 4.897 GiB
  measured so far. The pilot 12 are 0.5% of customers captured so far but
  78.9% of bytes measured so far (Sames alone: 879 MiB) — the pilot set was
  deliberately chosen for edge-case diversity, not sampled randomly, and
  using its rate for a population-wide projection would badly overestimate.
  Projected range for ~4,560 customers: **~2.0 GiB low** (rate = the 2,365
  non-pilot customers captured so far) to **~9.4 GiB high** (rate = the
  full org-wide mix including the pilot) — both from real measured data,
  not the pilot's rate. C: had 186.19 GiB free at the time, comfortably
  above this range.

## Decisions — 2026-08-25, four more entity kinds promote to native

Ruben decided: **purchase_orders promote fully to native tables. Credit
memos AND refunds both promote — historical balances must reflect credits
and refunds exactly as ShopVOX shows them.** Sales leads promote as
**customers with `is_active = false`**, excluded from marketing/pickers/
active counts — not as rows in the native `sales_leads` CRM/pipeline table
(that table exists and is unrelated to this decision, see the schema audit
below). This expands the destination count beyond the 17 tables the pilot
covered.

### Schema audit (2026-08-25) — what already exists, live, before any
migration is written for these four kinds

- **`purchase_orders`** exists, 0 rows. Columns (from PostgREST's OpenAPI
  doc — full constraint/index/RLS/trigger detail needs Ruben's SQL Editor,
  a paste-ready query set was handed off separately): `id`,
  `organization_id`, `po_number`, `vendor_id` (FK -> `vendors.id`),
  `sales_order_id` (FK -> `sales_orders.id`, nullable), `status`, `title`,
  `notes`, `subtotal`, `tax_total`, `total`, `expected_delivery_date`,
  `received_date`, `created_by`, `created_at`, `updated_at`. **No
  `shopvox_id` / `shopvox_imported_at` / `is_historical` — needs a
  migration, same as Migration A/E added to the other tables.** No
  `customer_id` column, correctly — POs are vendor-side in ShopVOX, never
  tied to a customer (confirmed live: `shopvox_transactions.customer_shopvox_id`
  is `null` on every purchase_order row). `sales_order_id` exists but
  nothing found in the captured PO JSON populates it (no `salesOrderId` /
  `workOrderId` field anywhere in `purchaseOrder`'s own body) — flagged as
  an open question, not necessarily a gap to fill.
- **`purchase_order_items`** (the line-items table — note the naming
  outlier: `_items`, not `_line_items` like every other line-item table)
  exists, 0 rows. Columns: `id`, `po_id`, `description`, `quantity`,
  `unit_cost`, `total_cost`, `received_qty`, `sort_order`, `created_at`,
  `material_id`, `unit`. **Also no `shopvox_id` / `is_historical`** — same
  gap, needs the same treatment quote_line_items etc. already got.
- **Credit memos: no dedicated native table exists at all** — no
  `credit_memos`, no `credits`, confirmed both from the OpenAPI doc scan
  and via a `information_schema.tables ilike '%credit%'` query handed to
  Ruben. Credit memos are already staged, though: `shopvox_transactions`
  has a `kind = 'credit_memo'` row set (44/44 captured credit_memo files
  imported — fully caught up, unlike purchase_order's 457/1159), with
  `subtotal`/`tax_total`/`total`/`balance` correctly populated from the
  same `prices` sub-endpoint quotes/invoices use. A native destination
  needs designing from scratch — no existing table to extend.
- **`refunds`** already has `shopvox_id`, `shopvox_imported_at`,
  `is_historical` from Migration A, confirmed live via OpenAPI. Full
  column list: `id`, `organization_id`, `refund_number`, `payment_id` (FK
  -> `payments.id`, NOT NULL), `amount`, `payment_method`, `refunded_on`,
  `note`, `created_by`, `created_at`, `shopvox_id`, `shopvox_imported_at`,
  `is_historical`. Staging is fully caught up too (39/39 captured refund
  files imported). Refund's captured JSON has no `prices` or `line_items`
  endpoint at all (unlike every other kind) — its money comes straight off
  the detail body (`amountInDollars` -> `total`, `balanceInDollars` ->
  `balance`), confirmed live in `shopvox_transactions`.
- **`vendors`** exists, 137 rows already — **all pre-dating this migration
  project** (`shopvox_imported_at` on every row is `2026-05-02`, from
  some earlier, separate vendor-import pass, not this one). **No
  `shopvox_id` column at all** — needs adding. `account_id` (text) exists
  but is `null` on every sampled row, so it isn't already carrying a
  ShopVOX reference under a different name. Cross-checked the 66 distinct
  vendor ids referenced across all 1,159 captured purchase_order JSON
  files against the 137 existing vendor names (case-insensitive exact
  match, since there's no id to join on): **58/66 match an existing vendor
  by name; 8 would need a new vendor row** (SunJoy Group Inc, Pro Am Golf,
  WB Promotion, Imprint ID, MBKP International, Daktronics, Pacific
  Business, Lucky Star Promotions Inc). 0 exact-duplicate vendor names
  among the 137 existing rows, but at least one near-duplicate pair exists
  ("Curtis Steel Company" vs "Curtis Steel Company LTD" — two distinct
  rows) worth a manual look before name-matching is trusted at scale.
- Native `sales_leads` (CRM/pipeline table: `stage_id` -> `pipeline_stages`,
  `assigned_to`, `source`, `estimated_value`, `won_at`/`lost_at`) and
  staging `shopvox_sales_leads` (23/23 captured files imported, columns
  include both `customer_shopvox_id` and an unresolved `customer_id`) both
  already exist — noted for completeness, but per the decision above,
  ShopVOX sales leads are NOT going into the native `sales_leads` table;
  they become `customers` rows.

## Migration H (2026-08-25) — applied and verified, 19/19 expected rows

`purchase_orders` gained `shopvox_id`/`shopvox_imported_at`/`is_historical`/
`vendor_name`, a partial unique index on `shopvox_id`, an index on
`(organization_id, is_historical)`, the immutability trigger, and a `status`
CHECK carrying all 13 values (5 original lowercase + 8 ShopVOX values
verbatim: `Draft, Emailed, Open, Ordered, Approved, Closed, Paid, Received`).
`purchase_order_items` gained the three traceability columns, its own
partial unique index, and the immutability trigger — no RLS added, it
already had working policies (see the correction below). `vendors` gained
`shopvox_id` and its partial unique index.

**Two findings from `pg_get_functiondef` on the PO number/refund functions,
both binding on the promoter, recorded here in the strongest terms so they
can't be missed:**

- **SEAL-ORDER CONSTRAINT — non-negotiable.** `recalc_payment_refunded()`
  derives `payments.refunded_amount` as `SUM(refunds.amount)` and `UPDATE`s
  the payment row on every refund write — `payments.balance` then follows
  automatically via its own generated-column expression. Consequences: (1)
  **the promoter must NEVER write `payments.refunded_amount` directly** —
  anything written there gets silently overwritten by this trigger/function
  the moment a refund is written, so there is no reason to write it and
  every reason not to (it would just be dead work masking the real derived
  value). (2) **refunds must be promoted BEFORE payments are sealed** —
  `recalc_payment_refunded()`'s `UPDATE` on `payments` fires the
  `enforce_historical_immutability` trigger, which raises the moment
  `is_historical = true` on the target row. Sealing payments first and then
  writing refunds afterward would hard-fail on every payment that has a
  refund. Whatever future sealing step runs, its ordering must be: refunds
  written → THEN payments sealed. Not yet relevant today (nothing seals
  anything in this pass — `is_historical` stays `false` on every write, per
  rule 1), but this constraint has to survive to whoever builds the seal
  step.
- **PO MONEY IS DOLLARS, NOT CENTS — the opposite convention from every
  other historical table built in this project so far
  (`quotes`/`sales_orders`/`invoices`/`bom_items`/line items are all integer
  cents; `purchase_orders`/`purchase_order_items` are real dollars-and-cents,
  e.g. `207.84`).** Confirmed from four independent pieces of live app code
  (two explicit source comments warning against exactly this mistake, the PO
  detail page's and PO card's rendering, and the sibling `materials` table's
  own dollars convention — full evidence in the conversation, not repeated
  here). **A promoter that copies the `×100` from
  `promote-shopvox-to-native.mjs` onto PO money would silently write a
  hundredfold-wrong value on all 1,159 purchase_orders and 3,264 line
  items** — `subtotal`/`tax_total`/`total`/`unit_cost`/`total_cost` must be
  written exactly as captured (ShopVOX's own `*InDollars` fields), unscaled
  and unrounded, including the one `tax_total = 5.3601` and the 131 sub-cent
  `unit_cost` values (e.g. `88.4225`, `0.2957`) — the columns are `numeric`
  and can hold that precision losslessly; ShopVOX itself carries it.

## 2026-08-25 — DOCUMENTED EXCEPTION to "historical records reproduce ShopVOX
exactly, unrounded" (read the SCOPE line before citing this anywhere else)

`purchase_orders.tax_total` is declared with a scale of 2, so Postgres
rounds on write. Exactly one PO of 1,159
(`be92b6a2-9169-40b8-9081-7c6992ef6efb`) had a source `tax_total` of
`5.3601` and stored `5.36` — a loss of $0.0001 on a single vendor-side
document. Ruben accepted this rather than widen the column and re-promote.

**SCOPE: this exception covers PO tax totals ONLY.** It does NOT apply to
customer-facing line-item math, which remains unrounded — that rule came
from 78,000 units × $0.0442 = $3,450, where rounding would make a reprint
contradict the customer's own copy. `purchase_order_items.unit_cost` is
unaffected and correctly stores 4 decimals (`0.2957` verified intact). All
other PO money values were clean 2-decimal source values: 0/1,159 sub-cent
`subtotal`, 0/1,159 sub-cent `total`, 0/3,264 sub-cent `total_cost`.

**Purchase orders are now COMPLETE: 1,159 promoted, 3,264 line items, 66/66
vendors linked, `po_number` 1000–2178 all distinct, all 8 ShopVOX status
values carried verbatim, `is_historical` false pending the seal step.**

## 2026-08-25 — Line-item id: the wrong premise, and the fix

**The wrong premise.** This file itself claimed, from the very first line-item
promotion: *"ShopVOX line items have no standalone id of their own."* That was
false. It has one — 100% populated, confirmed across everything captured:
17,708 quote / 3,149 sales_order / 14,408 invoice line items, all distinct
per kind. The real id existed the whole time in each captured JSON's
`lineItems[].id`, and was even preserved into staging inside
`shopvox_line_items.raw.lineItem.id` — it just had no column of its own to
be queried by, so the earlier investigation (which checked staging's own
column list, not the raw payload underneath it) never found it. Built on
that wrong premise: `quote_line_items` / `sales_order_line_items` /
`invoice_line_items` minted both `id` and `shopvox_id` as
`deterministicUuid(transaction_shopvox_id:position)` — the one place in the
whole schema where `id === shopvox_id`. That hash silently collided the one
time ShopVOX itself had two line items sharing a position (4 quotes, found
by a full org-wide import run — see the `shopvox_line_items` entry below):
the second one promoted would overwrite the first with no error.

**Migration I** (2026-08-25) gave `shopvox_line_items` a real
`shopvox_line_item_id` column, backfilled on all 38,159 rows at the time
(0 null, 38,159 distinct), and made it the table's natural key in place of
`(transaction_shopvox_id, position)`.

**The partial-index/`ON CONFLICT` trap, again.** The first version of that
constraint was a *partial* unique index (matching the convention every other
`shopvox_id` column in this project uses) — and `supabase-js`'s
`.upsert(rows, {onConflict: 'shopvox_line_item_id'})` generates a plain
`ON CONFLICT (...) DO UPDATE` with no `WHERE` clause, which Postgres refuses
to match against a partial index. Same failure class `quotes.shopvox_id` hit
early in this project. Fixed by making it a **plain, non-partial** unique
index instead — Postgres already treats NULLs as distinct from each other
under an ordinary unique index, so the partial form bought nothing here and
cost the `ON CONFLICT` target. Worth remembering as the general rule: a
partial unique index is only worth it when the *non-null* values need
uniqueness enforced but the column is expected to be null often AND is never
itself an upsert conflict target — the moment something needs to upsert on
it, it can't be partial.

**The 7,681-row backfill.** `quote_line_items` (3,039) / `sales_order_line_items`
(2,377) / `invoice_line_items` (2,265) — every already-promoted row across
the pilot 12 had `shopvox_id` corrected from the old position hash to the
real id, joined via `(parent transaction's shopvox_id, position)` against
`shopvox_line_items`. `id` was never touched (verified: 0 rows changed),
`shopvox_imported_at` was left at its original value (no restamping — those
rows were genuinely imported earlier that day). Verification came back 0 on
all six checks Ruben ran: 0 mismatched against staging, 0 still holding a
position hash.

**The promoter rework.** `quote_line_items` / `sales_order_line_items` /
`invoice_line_items` now go through `resolveIdMap()` exactly like every
other promoted table — existing native `id` resolved by the real
`shopvox_id`, `randomUUID()` only for genuinely new rows. `job_line_items`
no longer re-derives its FK target from the position formula; it does a real
lookup — `(transaction_shopvox_id, position)` against this customer's
already-fetched `shopvox_line_items` — and if that position now matches more
than one line item (the same 4-quote collision), it's **skipped and
reported by name, never guessed.** Sized that cost directly rather than
leaving it hypothetical: none of the 4 colliding quotes have any
`shopvox_job_line_items` rows at all (checked live, 0 across all four) — the
rule costs nothing today. It exists for whatever position collision turns up
among the ~4,548 customers not yet promoted.

**Applied and verified on the pilot 12** (2026-08-25): `quote_line_items`
3,039 / `sales_order_line_items` 2,377 / `invoice_line_items` 2,265 /
`job_line_items` 4,212 — all unchanged after re-running the reworked
promoter with `--apply`, confirming existing rows resolved and updated in
place rather than duplicating. 0 rows anywhere with `id === shopvox_id`
(the old hash pattern, now fully gone). Sames canary still exactly
$1,191.18.

**This is the second silent-failure bug found in this project, after
`email_attachments`'s resolution-order bug** (2026-08-25, above) — both were
found by asking how something could fail *quietly*, not by anything actually
erroring. Neither would have shown up in a row count, a success message, or
an exit code. Worth carrying forward as a standing question for whoever
builds the next piece of this: not "did it run," but "how could this be
wrong without telling anyone." (Superseded below — this pattern recurred
three more times the very next day.)

## 2026-08-25/26 — Migration J (credit_memos) and Migration K
(invoices.credit_applied), plus the fifth instance of the staging-column
pattern

**The finding that shaped both migrations**: a ShopVOX credit memo does NOT
sit as an independent adjustment against a customer account — it's already
netted into the invoice's own balance. Proven to the penny on invoice
`2c19497c-...` (#5013): `total=$1,042.55`, `payments_total=$0`,
`balance=$0` — the only way that zero happens with no payments is
`prices.creditInDollars` (`$1,042.55`, exactly the credit memo's own total)
subtracted into ShopVOX's own `balanceInDollars` before it ever reaches
staging. Generalized across all 50 captured credit memos: 45/45 non-void
ones matched their linked invoice's credit exactly; every mismatch among the
other 5 was a `void` credit memo, which correctly has no effect (ShopVOX
itself excludes void from the credit calc, same as voided quotes/invoices
everywhere else in this schema). **Consequence, enforced not just assumed**:
`credit_memos` is a record-keeping table. Promoting one must NEVER write to
an invoice. The promoter snapshots `invRows` immediately before any
credit-memo code runs and diffs it byte-for-byte immediately after — a real
runtime assertion that throws if they ever differ, not an architectural
claim. Passed on every one of the 12 pilot customers, twice (Task Z's dry
run and Task AB's apply).

**`credit_memos` / `credit_memo_line_items`** (Migration J): promoted as
destinations 18/19 in `promote-shopvox-to-native.mjs`, under the existing
`--customer` model (credit memos have a real customer, unlike purchase
orders). `credit_memo_number` from `txnNumber` (clean digits, 1000-1049, all
distinct). `status` verbatim (`open`/`closed`/`void` — void IS promoted, a
real record that simply had no balance effect). `quote_id`/`sales_order_id`
resolve from the already-staged parent fields; `invoice_id` has no staged
column of its own and is derived from the `previous_transactions` chain in
`raw` (the same source used to prove the finding above). All money columns
are `numeric`, deliberately (five separate times now an integer money
column in this project turned out to need fractions) — written as cents,
unrounded, via the same `dollarsToCentsExact()` used elsewhere, applied
uniformly to every money field in these two tables including line-item
`total_price` (a deliberate deviation from the round-the-total convention
`quote_line_items`/etc. use, per explicit instruction). Line items use the
real ShopVOX id from day one (`shopvox_line_item_id`) — no position hash
anywhere in this table, unlike the mess that had to be unwound for the other
three line-item tables. `created_by` has no FK — historical credit memos
have no PrintOS user. `shopvox_id` unique indexes are correctly PARTIAL here
(unlike the staging fix below) — the promoter resolves by `shopvox_id` and
upserts on `id`, so these are never an `ON CONFLICT` target, and Postgres
already treats NULLs as distinct under a plain unique index regardless.

**`invoices.credit_applied`** (Migration K, `numeric not null default 0`):
makes the credit visible on the row instead of purely implicit inside
`balance_due` — before this, a $0-balance invoice with $0 paid read as an
unexplained error. Populated by the promoter, not a SQL backfill, so it
comes from the same source/units `balance_due` already uses
(`round2c(t.credit_total) ?? 0` — the `?? 0` matters, `round2c(null)` is
`null` and the column is `NOT NULL`). A real identity check runs on every
invoice with a non-zero credit — `total - amount_paid - credit_applied =
balance_due` — and throws immediately on any mismatch rather than writing a
wrong value; checked 2/2 on the pilot 12 (Sames `#8955`, Fuel America),
both exact.

**The fifth instance — and the reason this got its own audit.** Migration K
was originally going to read `shopvox_transactions.credit_total`, "the value
the promoter already fetches and currently discards." It doesn't fetch
anything — `import-api-capture.mjs` hardcoded `credit_total: null` with a
comment claiming *"no field observed on `prices` for this."* Verified live:
that claim was false on the exact invoice used to prove the finding above —
`2c19497c-...` showed `credit_total: null` in staging while its raw
`prices.creditInDollars` was `1042.55`. 0 of 15,249 staged transactions,
org-wide, across every kind, had a non-null `credit_total` — a dead column,
not a per-row gap. **Fixed at the source rather than routed around**
(explicit decision — routing around it in the promoter would have left the
same landmine for whoever hits this column next): the mapper now reads
`prices.creditInDollars` through the same `money()` every sibling field
uses, and 15,249 already-staged transactions were re-imported to backfill
it (5,885/5,885 invoices now carry the real value; every other kind
confirmed to genuinely never have this field on their own `prices` object —
sampled 30 raw files per kind directly, not assumed).

That prompted a full sweep of `import-api-capture.mjs` for every other
`null`-with-a-comment-claiming-absence. Two more turned out to be false,
found only by going looking, not because anything had broken yet:
- `shopvox_transactions.production_manager`/`project_manager` — claimed
  "not exposed on the transaction record itself (job-level only)." False:
  `productionManagerId`/`projectManagerId` exist on the transaction record.
  The *value* correctly stays null (these columns are `text`, expecting a
  resolved name like `sales_rep`'s sibling `primarySalesRep.name` gets, and
  the transaction record only carries the bare id with no name-resolution
  path anywhere in what's captured — same gap as `sales_rep_id`/`created_by`
  elsewhere) — only the comment was wrong, fixed to say so honestly.
- `shopvox_jobs.line_items_price` — claimed "not confirmed on pro_jobs
  detail." False, and this one mattered: `body.totalPriceInDollars` is real
  and populated (sampled 20 job files directly — varied genuine dollar
  values, not a placeholder). Fixed and backfilled: 1,719/1,719 staged jobs
  now carry it. **No native destination exists for it yet** — `jobs` has no
  price/total/value column at all, and the promoter doesn't write one. Open
  gap, not yet migrated.

**Five instances now, three that caused a visible problem (line-item id
collision, PO `tax_total` rounding, `credit_total` blocking Migration K) and
two found only by going looking (manager names, job line-items price) before
they broke anything.** The standing question from the `email_attachments`
finding holds and gets stronger with every repeat: not "did it run," but
"how could this be wrong without anything saying so."

**Also flagged, not yet fixed**: running the importer against the full
`queue.jsonl` now reliably OOMs (54,625 lines / 15.7 MiB — the queue file
itself is fine; the real driver is that every queue line's *capture file*
gets loaded fully into memory before any processing starts, and that now
totals 3.67 GiB across 37,795 files against Node's default 2.19 GiB heap
ceiling on this machine, confirmed live). Worked around per-task by scoping
to already-staged records, which is not a fix — it will recur, worse, mid
the 4,500-customer wide run unless addressed first. Real fix needs either a
raised heap limit (cheap, temporary), a batched/streaming rewrite of the
load-everything-then-process-everything architecture (real fix, moderate
effort — complicated by `resolveEmailParent()`'s in-memory cross-record
lookup, which a naive stream can't satisfy without its own redesign), or
both. Decision pending, not made yet. **RESOLVED 2026-08-26 — see the section
below.**

## 2026-08-26 — Migration L (jobs.total_price), Migration M
(shopvox_emails/shopvox_email_attachments plain keys), and the queue.jsonl
OOM fix

**Migration L** (`jobs.total_price numeric`, nullable, no default): the
native destination `shopvox_jobs.line_items_price` (fixed in the
five-instance sweep above) never had. Populated straight from staging with
no `?? 0` coalesce — the column is nullable, and "no price recorded" vs
"$0 recorded" are different facts, same reasoning as migration 187's
H:M:S-parsing null-vs-zero rule. Applied to the pilot 12: 1,709/1,709
populated, 2 samples verified exact against staging. Sequenced deliberately
ahead of the OOM fix below — small, unblocked, and unblocking nothing else,
per Ruben's explicit ordering.

**AC part 1 — immediate mitigation.** `--max-old-space-size=8192` documented
in the script's own header MEMORY note. A bigger bucket, not a fix — capture
keeps running and the referenceable-file total keeps growing, so any fixed
ceiling eventually fails again too.

**AC part 2 / Task AE — the shopvox_emails/shopvox_email_attachments
batching hazard, investigated before building anything.** Ruben flagged that
both tables used `DELETE_THEN_INSERT` (the workaround this project reaches
for when no real unique key exists on a table), and that batching plus
delete-then-insert is a known-dangerous combination if a parent's rows can
split across two batches — a later batch's delete phase could delete rows an
earlier batch just inserted for the same parent, with nothing re-inserted to
replace them. Traced the actual delete code before assuming either way:
`shopvox_emails` deletes by its OWN `shopvox_id` (self-referential — under
the planned file-granularity batching a single email is always entirely
contained in one batch, so the hazard as stated doesn't reproduce there) —
flagged as *incidental* safety, a property of this code's current shape, not
a structural guarantee worth relying on long-term. `shopvox_email_attachments`
deletes by `email_id`, a real shared-parent column — but every attachment is
embedded inside its parent email's own capture file, so an email and all its
attachments are always mapped together, in the same batch. Confirmed live
before recommending a fix: `shopvox_emails.shopvox_id` was already 100%
populated (3,552/3,552) and distinct, just unindexed; `shopvox_email_attachments`
had no id column of its own, but `raw.id` was 100% populated (1,335/1,335)
and distinct — same shape as the line-item-id fix, Migration I.

**Migration M** (Ruben): `shopvox_emails` got a PLAIN (non-partial) unique
index on the existing `shopvox_id` column. `shopvox_email_attachments` got a
new `shopvox_attachment_id TEXT` column, backfilled from `raw->>'id'`, with
its own PLAIN unique index. Both plain, not partial — deliberate, per the
partial-index/`ON CONFLICT` rule this project has now proven twice
(`quotes.shopvox_id`, then `shopvox_line_item_id`): a column is only a
candidate for a partial index when it is *never itself an upsert conflict
target*; both of these now are, upserted directly by the importer (not
resolve-then-upsert-on-`id` like the promoter's tables). TEXT rather than
UUID on `shopvox_attachment_id` because the ids were confirmed populated and
distinct but never confirmed to actually be UUIDs.

Four follow-up steps, all completed and independently confirmed:
1. `shopvox_email_attachments.shopvox_attachment_id` populated in the mapper
   (`att.id ?? null`), same pattern as `shopvox_line_item_id`.
2. `NATURAL_KEYS.shopvox_emails → 'shopvox_id'`,
   `NATURAL_KEYS.shopvox_email_attachments → 'shopvox_attachment_id'`.
3. Both tables removed from `DELETE_THEN_INSERT` entirely.
4. Re-imported Sames' queue (927 emails / 370 attachments, customer-scoped)
   to prove the new keys upsert cleanly: 0 dedupe drops, org-wide totals
   confirmed BYTE-UNCHANGED before/after (`shopvox_emails` 3,552→3,552,
   `shopvox_email_attachments` 1,335→1,335) — not just "exited zero."

**`DELETE_THEN_INSERT` now exists for no table that has a real natural
key.** Only two tables still use it (`shopvox_transaction_charges`,
`shopvox_bom_items`), and both genuinely lack a per-row ShopVOX-issued id —
a charge or BOM line is an aggregate, not an individually-identified record,
unlike a line item or an email attachment. **Rule stated explicitly because
this project reached for delete-then-insert on the wrong assumption twice —
`shopvox_transaction_charges`/`shopvox_bom_items` originally, then
`shopvox_emails`/`shopvox_email_attachments` — before checking whether a
real key existed either time: before adding ANY table to
`DELETE_THEN_INSERT`, check whether the raw captured payload has its own id
field first.** The line-item-id and attachment-id findings both prove "no
natural key" is not a safe default on this account; it's been wrong twice
already.

**The batching refactor.** `import-api-capture.mjs` used to load every
referenced capture file FULLY into memory before processing any of it —
confirmed live: 37,795 files already total 3.67 GiB against this machine's
2.19 GiB default Node heap. Fixed with two pieces:
- **Pass 1 — a lightweight `parentCompanyIndex`**
  (`Map<"entity|uuid", companyId>`), built once up front by reading every
  job/transaction-kind file exactly once and keeping only its company id,
  discarding everything else. This is what `resolveEmailParent()` now reads
  from instead of a full in-memory record map — the one piece of the old
  design that made a naive per-batch stream unsafe on its own, since an
  email's parent transaction/job can be captured anywhere in the run, not
  necessarily the same batch as the email itself.
- **Pass 2 — bounded batches.** `queueEntries` (a lightweight
  `{entity, uuid}` list, not file content) is chunked into
  `BATCH_RECORDS`-sized batches (default 3,000; `--batch-records=N` override
  added specifically so a small customer-scoped run can still be forced into
  several batches for testing). Each batch loads its own files, maps them,
  uploads, then is discarded before the next batch starts.
  `historical_import_runs` is still opened/closed exactly once for the whole
  run, not per batch; per-table upsert results aggregate across batches into
  one row per table, same shape the notes/summary always had.

**Proof method (Ruben's explicit requirement, extended to cover attachments
as well as emails).** Snapshotted Sames' `shopvox_emails`/
`shopvox_email_attachments` cross-record-dependent fields as left by the
pre-batching code, ran the new batched code against the same queue file
forced into several batches (`--batch-records=500` — Sames' 2,568 entries
fit in ONE batch at the 3,000 default, which would have proven nothing about
cross-batch behavior at all), re-snapshotted, byte-diffed.

**Result: byte-identical.** 927/927 emails, 370/370 attachments; every
email's `(shopvox_id, customer_shopvox_id, parent_kind, parent_shopvox_id)`
and every attachment's `(shopvox_attachment_id, resolved parent email's
shopvox_id)` matched exactly, before vs. after. Emails landed in batches 4
and 5 of 6 (497+434), not batch 1 — genuinely exercised
`fetchAllIds('shopvox_emails')` picking up an email inserted by an earlier
batch to resolve a later batch's attachment `email_id`, and the pass-1 index
resolving parents regardless of which batch the parent transaction/job fell
into. Org-wide totals unchanged (3,552/1,335 before and after). 0 upsert
errors, 0 natural-key dedupe drops.

**One bug caught before running anything live.** The live-run sample-row
preview (`printSummary()`'s "sample row per table") would have shown
pre-FK-backfill values (`transaction_id`/`job_id`/`email_id` all null) if
captured at the same point row counts get folded in. Fixed by moving the
live-run sample capture into `run()`, right before each table's own upload
call — by then every FK-backfill assignment for that table has already run,
so the preview reflects the row as it was actually sent to the database,
matching the pre-batching behavior exactly. The dry-run path (which never
reaches `run()`) still captures its sample immediately after mapping, as
before — this was never wrong for dry runs, since no backfill ever happens
in one.

**Still open, deliberately not yet run**: proving the fix at the scale it
was built for — the full ~54,625-line `queue.jsonl`, `--dry-run`, WITHOUT
the `--max-old-space-size` safety flag — to confirm the batching itself, not
the flag, is what prevents the OOM. Task AG, next; report separate from this
one.

## 2026-08-26 — Task AG proves the batching fix, then surfaces the seventh
instance of the staging-column pattern

**Task AG**: full-queue dry run, deliberately WITHOUT `--max-old-space-size`
— the same default 2.19 GiB heap that used to OOM, against the full
54,625-entry `queue.jsonl`, to prove the batching refactor itself (not the
heap flag) is what fixes it. **Result: completed cleanly.** 19 batches, 229s
elapsed, peak RSS 1,440 MB — a genuine plateau across batches 10–19 (samples
every 3s: 1,388–1,440 MB, not still climbing), not unbounded growth caught
mid-climb. `shopvox_emails`/`shopvox_email_attachments` correctly mapped 0 —
confirmed live `queue.jsonl` has no `email` entity rows at all (its 10 kinds
are `credit_memo, refund, sales_order, purchase_order, quote, invoice,
payment, customer, sales_lead, job`); emails only ever enter via
customer-scoped queue files. 0 readSkips, 0 naturalKeyCollisions, 0 parse
failures, 16,927 missingFiles (capture still running — expected).

**What that same run also surfaced — the seventh instance of the
staging-column/false-comment pattern, found the same way as the other six:
by reading the run's own numbers with suspicion, not because anything threw
an error.** `finishDryRun()`'s two BOM "delete-without-replacement" preview
count queries — `.in('job_shopvox_id', [...])` /
`.in('transaction_shopvox_id', [...])` against `shopvox_bom_items` — were
never chunked, unlike the live `DELETE_THEN_INSERT` delete phase a few
functions below them, which has used `DELETE_CHUNK` (150) since the
`shopvox_transaction_charges` 700+-id `Bad Request` bug much earlier in this
project. At full-queue scale (1,332 / 3,495 distinct ids) both queries
failed on every run, and both failures were silently absorbed into the
summary's printed **"rows that would be DELETED WITHOUT REPLACEMENT: 0"** —
a number that reads exactly like a real, reassuring zero and is not one.

**Reproduced precisely** (synthetic ids against the real table):
`n=100` → 200 OK. `n=700` and `n=1332` → 400 Bad Request. `n=3495` → 414
Request-URI Too Large. **In every failing case the response body is empty**,
so `supabase-js`'s `error.message` is the actual empty string `''` — not a
masked real message, a genuinely blank one. `status`/`statusText` carry the
real reason (`400`/`Bad Request`, `414`/`Request-URI Too Large`) and were
never being read at all before this fix.

**Fixed.** Every `.in()` call in `import-api-capture.mjs` — three exist
total: the two BOM preview counts (now chunked, via a new `chunkedCount()`
helper reusing the same `DELETE_CHUNK = 150` the live delete phase already
proved safe) and the two `DELETE_THEN_INSERT` delete-phase calls (already
chunked at 150, unchanged). No unchunked `.in()` remains in this file.
**A chunk failure now fails loudly, not into a default.** The preview result
is one of three states, never conflated: nothing to preview (both id sets
empty — line omitted, as before); a real confirmed count (printed as
before); or `{failed: true, failures}` — printed as **"COULD NOT BE
COMPUTED"** plus every failing chunk's `status`/`statusText`/`message`,
never as a bare number a reader could mistake for a real zero.

**Re-ran the full-queue dry run after the fix: the query now succeeds and
reports a real number — 8,818** (previously silently reported as 0). That is
the actual scale of the gap the old bug was hiding: 8,818 stale BOM rows
that a wide `--apply` run would need to clean up via delete-without-replacement,
invisible in every dry-run preview before this fix. 0 chunk failures, 0
stderr output on the re-run.

**Seventh instance of the pattern now** (email_attachments' resolution-order
bug, line-item id collision, PO `tax_total` rounding, `credit_total`,
`production_manager`/`project_manager`, `line_items_price`, and now this).
Every one of the seven was found by asking how a number could be wrong
without anything saying so — never by a crash, a nonzero exit code, or a
logged error pointing at itself. Worth restating for whoever hits an eighth:
a query that fails and a query that returns a real zero must never look the
same on screen, and "it printed a plausible number" has now been wrong seven
separate times on this account. Same rule that already governs
`DELETE_THEN_INSERT`: check for a real natural key before reaching for the
workaround; check every `.in()`/count/aggregate for chunking and honest
failure reporting before trusting what it prints, especially once a run
crosses whatever id-count threshold was fine at pilot scale.

## 2026-08-26 — Task AI (BOM delete-only verified clean) and Task AJ (sales
leads customer promotion — built, ON HOLD)

**Task AI**: the 8,818-row "delete without replacement" BOM preview (from
the Task AH fix above) was independently verified, not just trusted. Full
sweep (not a sample) of all 5,112 non-terminal transactions with a bom:
every single one resolves — via `next_transactions`, multi-hop where needed
— to a captured, terminal successor that will be freshly inserted by the
same `--apply` run that deletes the predecessor's stale rows. **0 true
orphans, 0 real data loss.** First analysis pass got this wrong (1,767 false
positives) by checking whether the successor's key already had existing
rows in staging *before* an apply, rather than whether it would be inserted
*by* the same apply run — corrected before reporting, not after.

**Task AJ**: `scripts/promote-sales-leads-to-customers.mjs` built — promotes
ShopVOX sales leads as `customers` rows with `is_active = false` (not into a
native sales_leads table, none exists). Based on
`create-missing-customers-from-shopvox.mjs`'s conventions (dry-run default,
REFUSED-on-existing-`shopvox_id` collision check). Dedup unit is the
**company**, not the lead — multiple leads per company fold into one
customer row, `notes` records every folded-in lead's title/state/deal
value/source for provenance, `customer_contacts` gets one row per distinct
contact across those leads. `salesRepId` is a deliberate, accepted loss
(Ruben's ruling, 2026-08-26) — same reasoning as
`production_manager`/`project_manager`: a bare id with no name-resolution
path anywhere in what's captured is not worth a column.

**APPLY IS ON HOLD.** The number "23" that framed this task turned out to be
the CAPTURED subset only — `queue.jsonl` lists **1,185** `sales_lead`
entries account-wide. **The scrape itself is NOT paused and is unaffected by
anything else being on hold** — it runs over the internet against ShopVOX
directly, was 68% complete (37,194 done / 17,431 pending / 0 failed) and
actively writing as of the last check, and continues overnight regardless.
(Separately, and NOT the same thing: the ARCHIVE COPY of captured files to
the company's Q: drive is on hold, waiting on VPN/server access — that has
no bearing on capture progress.) Dry-run against the 23 currently staged:
all 23 fold into just **6 distinct companies**, and **all 6 already have a
`customers` row** (Sames, TAMIU, Bolillos Cafe, Arguindegui Oil Co, IBC,
Fuel America) — **0 new customers** from this subset. 1,185 is a materially
different proposition and the real "how many NEW disabled customers does
this actually create" number is unknown until capture finishes. **Do not
`--apply` until capture completes.** When it does, report: total sales
leads captured, distinct companies among them, how many of those companies
already have a `customers` row, and the resulting NEW-customer count — that
count is what Ruben rules on, not the lead count.

## 2026-08-26 — Capture death #4: root cause, fix, supervisor, and why the
supervisor is NOT how this gets launched going forward

**The death.** `shopvox-capture.mjs` ran 29 hours, captured 41,766 records,
then died with no error text anywhere in any log — no crash log, no stderr
capture, no Windows Event Log entry, nothing (Task AK). RSS readings through
the night climbed `628 → 1,809 → 2,007 → ~2,014 → 1,988 MB` against this
machine's 2.19 GiB default Node heap, pressed against the ceiling until it
went. The stale lock file surviving (not deleted by the normal
`process.on('exit')` handler) was itself a clue: a V8 heap-limit abort calls
`abort()` at the C++ level and does not run JS exit handlers, consistent with
a hard OOM rather than a graceful or OS-level-faulted exit (confirmed no
"Faulting application" event in Application/System event logs either). The
auth log's last entry — a **successful** token refresh 8 seconds before
death, with 3 more records captured afterward — ruled out session expiry as
the cause. At the time this was written, the V8-heap-OOM conclusion rested
entirely on this indirect evidence — real, but an inference, not a proof.

**CONFIRMED, not inferred (Ruben, same day, later).** Ruben found the
original console window still open — it had never been closed, just left
behind. Task Manager/process inspection showed the dead process itself: pid
`16516`, uptime `126,134,414 ms` (35.04 h), landing exactly on the 09:01
death. Sitting in that window's buffer was the actual V8 fatal-error text —
the only one of these four capture deaths to ever produce error text of any
kind:

```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of
memory
Mark-Compact 2051.6 (2070.3) -> 2033.9 (2065.5) MB ... allocation failure;
scavenge might not succeed
```

This is a real, textbook V8 heap-limit abort — `Mark-Compact` is V8's
last-resort full GC, and "scavenge might not succeed" is V8 admitting even
that won't free enough to continue. It matches the `abort()`-at-the-C++-level
reasoning above exactly. Death #4 is now a **confirmed** V8 heap-limit OOM,
not a well-supported inference — everything else in this section (root
cause, fix, supervisor, standing rule) stands unchanged; this only upgrades
the death itself from inferred to proven.

**Root cause, found not just inferred.** Every request in the whole pipeline
goes through `context.request.get()` (Playwright's `APIRequestContext`,
bound to the single long-lived browser `context` created once and reused for
the entire multi-hour run). Playwright tracks every dispatched `APIResponse`
object until `.dispose()` is called; `scripts/lib/shopvox-api.mjs` never
called it — not on the terminal response whose body gets read, and not on
retried 401/429/5xx responses either (those were inspected via `.status()`
and dropped on the floor before looping again — a second leak path found
while fixing the first one, not something Ruben asked for specifically).
Over ~400,000+ requests across 41,766 records, this is the one thing in the
whole pipeline that scales with **requests processed**, not queue size —
matching a crash at hour 29, not at startup, with nothing in the script's
own data structures (`rows`, `lineItems`, etc.) big enough to explain
gigabytes of growth on their own.

**Fixed.** `pacedRequest()` in `shopvox-api.mjs` now owns every `APIResponse`
object's full lifecycle — request, read (via a caller-supplied `readBody`
callback), dispose in a `finally` so a throw from the body-read can't leak
it — for both the terminal response and every retried one. Same fix applied
to the two other call sites in that file that bypass `pacedRequest()` by
design (`waitForManualLogin()`/`pauseForBackoff()`'s health-check pings), and
to the two other files in the codebase with their own independent
`context.request.get()` calls: `shopvox-enumerate.mjs`'s paginated
enumeration loop (thousands of pages on a full account-wide run — same leak
class, smaller volume) and `api-probe/02_timing_test.mjs` (a ~20-request
one-off probe, low risk, fixed for consistency). Grepped the whole `scripts/`
tree afterward — no unchunked `.request.get/post/...(` call site left.

**Evidence-leaving added so a 5th death (if one ever happens) doesn't vanish
the same way**: `shopvox-capture.mjs` now appends its own
`{rss, heapUsed, heapTotal, external, arrayBuffers}` to
`scripts/capture/_memory_log.jsonl` at process start, every 50 records
during drain, at drain end, and after every closure pass. Launch is meant to
always include `--report-on-fatalerror --report-directory=<capture dir>` (a
V8 abort writes `report.*.json` instead of vanishing) and stdout/stderr
redirected to a persistent file — both of these are the supervisor's job to
add automatically, see below, not something to remember to type by hand.

**`scripts/shopvox-capture-supervisor.mjs`** — built to restart the capture
on an unexpected exit, bounded (max 10 restarts, hard-stops on two child
deaths within 5 minutes of each child's own start, hard-stops on
`maxOuterIterations` since that's a real bug a restart can't fix). "Clean
completion" is decided by re-reading the queue file's pending count after
the child exits, deliberately NOT by exit code (an OOM abort's exit code
isn't reliably predictable across platforms). Tested against a fake child
through 4 scenarios (instant crash-loop, clean completion, partial-progress-
then-recover, stuck-bug) before ever pointing it at the real queue — all 4
passed. Its very first real launch still hit a bug the fake-child tests
could not have caught: the supervisor spawned the child with the wrong
`cwd`, silently doubling a project-root-relative `--queue=` path
(`scripts\scripts\queue\...`, ENOENT) — the fake-child harness validated
restart **decisions**, not the real launch path, since the fake child never
exercised path resolution the way the real one does. The hard-stop guard
itself fired correctly (2 deaths, both under a second, both counted) — this
was a bug in what got spawned, not in the decision logic. Fixed (`cwd:
process.cwd()`, inheriting the supervisor's own invocation directory, not
`root`) and confirmed live afterward.

**Why the supervisor is not how this gets launched, despite working.** After
the `cwd` fix, the supervisor ran the capture cleanly for 4 hours — see the
validation below — until it stopped with no error, no OOM, no crash
signature at all. What actually happened: the supervisor itself was a child
of a Claude Code background task, and that background task was killed
(externally — not by Ruben, not a crash, not something either the capture's
or the supervisor's own logging could see coming, since neither process
logged anything before it happened). Killing that task killed the
supervisor's own Node process, which killed its child capture process too —
and because the supervisor's process was gone, its own restart-on-
unexpected-exit logic never got to run. **A supervisor that dies with its
child supervises nothing.** The fix isn't a smarter supervisor — the
supervisor's restart logic already worked correctly every time it got the
chance to run (see the cwd-bug hard-stop above). The fix is not letting the
whole process tree be a dependent of infrastructure that can disappear out
from under it without warning. This is the same risk workflow rule 8 already
named for the plain (non-supervised) capture — "a Claude Code CLI self-
update can plausibly kill a running background capture" — just confirmed
again here in a related but distinct form (a background *task* being killed,
not necessarily a CLI self-update specifically) and now with a supervisor in
the mix too, which doesn't fix this class of risk, only compounds it if it's
launched the same dependent way.

**STANDING RULE (Ruben, 2026-08-26), non-negotiable: the capture (supervised
or not) is launched by Ruben, in his own independent process (e.g.
PowerShell `Start-Process`), never from a Claude Code background task.** A
Claude Code background task is not a durable place to run a multi-hour/
multi-day process — see workflow rule 8 and the incident above, now
confirmed twice. The supervisor script itself is still the right tool
(bounded restarts, clean-completion detection by queue state, evidence-
leaving on launch) — it just needs to be started from a process that
survives independently of Claude Code's own task tracking. Nobody should
wire this back up through a background task later on the theory that it
worked fine for 4 hours; it did, right up until the thing hosting it died
and took it down too.

**Validation — the disposal fix is conclusively confirmed, not just
plausible.** The supervised run (after the `cwd` fix) held for **4 hours,
2,400 records processed, 0 failed, 0 backoff pauses**, `drain_start` at
`2026-08-26T20:07:15Z` through the last checkpoint at
`2026-08-27T00:08:17Z`. 48 memory samples across that span:
**RSS bounded 180–309 MB, `heapUsed` bounded 54–134 MB** — a clean,
repeating GC sawtooth the entire time, never trending upward:

```
20:07:15  drain_start        156 MB / heap  89
20:14:39   50 processed      180 MB / heap  57   (heap dropped — GC reclaiming, proof the leak was gone)
20:19:42  100                246 MB / heap 134
20:29:28  200                193 MB / heap  54
20:40:22  300                287 MB / heap 133
20:55:32  450                246 MB / heap  57
21:09:46  600                238 MB / heap  56
23:09:13  1800               309 MB / heap 119
23:38:37  2100               238 MB / heap  55
23:58:10  2300               302 MB / heap 118
00:08:16  2400 (last)        241 MB / heap  60
```

Peak RSS across the whole 4-hour run (309 MB) is 14% of the 2,240 MB ceiling
that killed the previous run. Against the pre-fix `628 → 1,809 → 2,007 →
~2,014 MB` monotonic climb with no oscillation at all, this is a categorically
different shape sustained far longer than the original run took to die —
not a smaller number caught at one lucky moment. The run's actual stop was
the background-task kill above, unrelated to memory; queue state at that
point was 44,179 done / 10,470 pending (up from 41,776/12,868 after the
Task AL repair pass) — real, clean progress the whole way, nothing lost.

## 2026-08-26 — QuickBooks export state: CLOSED, no migration needed

**Ruben's position (real requirement, not hypothetical): all seven years of
historical invoices have ALREADY been exported to QuickBooks. Nothing
historical may ever be exported again.** At cutover, only genuinely pending
invoices get pushed.

**Investigated (Task AM) and confirmed already satisfied, live, no code
change needed.** The one filter that gates every QuickBooks export surface
in the app — both the scheduled cron
(`src/app/api/cron/invoice-iif-export/route.ts`) and the manual "Post to
Accounting" page (`accounting/page.tsx`) — is `invoices.is_posted = false`,
identically in both places. `promote-shopvox-to-native.mjs` already writes
`is_posted: true` unconditionally on every invoice it promotes (comment:
`// rule 7`). Verified live, second independent read: **all 1,015 currently
promoted invoices have `is_posted = true`; none has ever gone through an
actual IIF export since promotion** (`iif_first_exported_at` null on all
1,015). Zero organic (non-ShopVOX) invoices exist yet, so there's nothing
else in the table to worry about. No "unpost" code path exists anywhere in
`src/`, so this can't regress silently. **Conclusion: historical invoices
already cannot enter a future export. No migration required.**

**The blanket `true` is deliberate, accepted knowingly, not an oversight.**
`accounting_status` (`shopvox_transactions`, mirrors ShopVOX's own
undecoded `accountingSyncState` field verbatim) shows value `3` on 5,884 of
5,885 staging invoices and `0` on exactly 1 — i.e. one invoice ShopVOX's own
data suggests may never actually have been pushed. The promoter's rule
doesn't check this field at all; it marks every invoice posted regardless.
Ruben confirmed this is fine as stated: all seven years, no exceptions is
the real position, so the 1-invoice-of-5,885 discrepancy is accepted
knowingly rather than silently smoothed over — recorded here so it reads as
a deliberate call, not a gap nobody noticed.

**Payments, credit memos, refunds: no QuickBooks export pipeline exists for
any of them** — only `invoices` feeds IIF export. `payments.is_posted`/
`posted_at` exist live but are **read by nothing in `src/`** — a dormant
column. Also flagging: **no migration file in either `supabase/migrations/`
or `src/supabase/migrations/` adds `is_posted`/`posted_at` to `payments`** —
it's live schema drift with no committed migration behind it (unlike
`invoices`, which migration 090 covers cleanly). Not urgent since nothing
reads it, but a real gap if anyone goes looking for the migration that
supposedly added it.

## 2026-08-27 — Standing rule: re-importing staging silently invalidates
already-promoted aggregates (Task AN → AQ)

**RE-IMPORTING STAGING SILENTLY INVALIDATES ANYTHING ALREADY PROMOTED FROM
IT.** Promotion copies aggregates (invoice `payments_total`, `balance`,
`credit_total`) as they stood at promotion time. A later import that changes
those aggregates leaves native and staging disagreeing, with no error and no
signal anywhere — found only by an explicit reconciliation (Task AN, 4
invoices / $3,434.32 across 3 customers: El Despecho, Fuel America,
International Bank of Commerce). The child records stay correct; only the
parent aggregate drifts, which is why it is invisible to orphan checks.
**WIDE-RUN ORDER IS THEREFORE FIXED: import must be COMPLETE before
promotion begins, and any re-import afterwards obliges a re-promote of every
affected customer. Do not interleave them.**

**Task AQ attempted the mechanical fix (re-promote the 3 customers) and it
did NOT work — for a more interesting reason than staging drift.** Re-running
the promoter writes the correct `amount_paid` to `invoices` first, but the
SAME run then upserts `payment_applications` (written **after** `invoices` in
the promoter's own write order) — and a **live database trigger with no
migration file anywhere backing it** recomputes `invoices.amount_paid` as
`SUM(payment_applications.amount_applied)` for that invoice on every write to
`payment_applications`, unconditionally overwriting whatever the promoter's
own `invoices` upsert just wrote. Reproduced directly, twice: manually PATCH
`invoices.amount_paid` to a sentinel value, confirm it sticks; touch one
unrelated `payment_applications` row for the same invoice; re-read the
invoice — `amount_paid` snaps back to the trigger's own sum every time,
independent of what the promoter or anyone else wrote to `invoices` itself.
**This means the promoter cannot fix these 4 invoices by re-running, ever —
the trigger will re-override `amount_paid` after every single run, forever,
as long as `payment_applications` rows exist for that invoice.**

**Investigated further and it gets more interesting: the trigger's number is
not obviously wrong.** For all 4 invoices, every `payment_applications` row
traces to a real, independently-verified ShopVOX payment record (checked each
payment's own raw captured `invoicePayments` array, not just the derived
`payment_applications` table):
- **International Bank of Commerce, invoice #1380** ("Pole Banner", $1,289.69):
  two entirely separate real ACH payments (#1425, paid 2020-12-01; #1536,
  paid 2021-01-05), each independently claiming to have paid this invoice in
  full. ShopVOX's own per-payment capture confirms both, unambiguously.
- **Fuel America, invoice #6955** ("FireMedia TV — January", $144.63): same
  pattern — two separate real payments (#6875 and #6886), both paid the same
  day (2025-01-24), each independently claiming to have paid this invoice in
  full.
- **El Despecho, invoices #7227 and #7236**: a genuinely different pattern —
  ONE real $2,000.00 payment, confirmed via its own raw ShopVOX capture to be
  **legitimately split across both invoices** ($1,434.57 to #7227, $565.43 to
  #7236) — a customer paying two open invoices with one check/ACH. Both
  invoices also carry other, unrelated payment applications on top of this
  split — the split itself is correct data, not a duplicate.

So the invoice-level `payments_total` aggregate on `shopvox_transactions` —
the field the promoter naively copies — **understates** the true applied
amount on all 4 invoices, either because ShopVOX's own invoice-level rollup
doesn't correctly account for a payment split across multiple invoices (El
Despecho), or because two independent full payments were genuinely both
applied to the same invoice and the invoice's own aggregate reflects only one
of them (Fuel America, IBC) — which itself could mean a genuine double
payment (a real bookkeeping fact worth knowing) or a misapplication of one of
the two payments to the wrong invoice. **This is a judgment call on real,
conflicting-but-individually-verified ShopVOX data, not a bug in this
project's pipeline to mechanically fix.** Left exactly as the trigger left
it (internally consistent: `amount_paid` = sum of real, verified
`payment_applications`) — not reverted, not forced back to the staging
aggregate — pending Ruben's call on:
1. Fuel America #6955 and IBC #1380: is this a genuine double-payment (real
   money collected twice — refund/credit owed), or should one of the two
   payments be re-applied elsewhere?
2. Whether ShopVOX's own invoice-level `payments_total` field should ever be
   trusted as authoritative again, given it's now shown to disagree with
   individually-verified payment records on 4 known invoices — likely worth
   the same reconciliation pass (payment_applications sum vs. staging
   payments_total) across the full ~4,500-customer run before trusting either
   field blindly at scale.

**The trigger itself is undocumented** — no migration file in
`supabase/migrations/` or `src/supabase/migrations/` defines it or the
`payment_applications` table it lives on (same class of live-schema-drift gap
as `payments.is_posted`, see above). Whoever eventually documents the trigger
properly should also check whether it fires on `INSERT` only, `UPDATE` only,
or both — not yet determined here.

**What the pilot never exercised — say so plainly, "12 customers verified"
does not mean broader coverage than this:**
- **Refunds**: zero `refund`-kind records among all 12 pilot customers'
  staging data. Not "not promoted" — genuinely absent from what was
  captured for this pilot.
- **Credit memos**: only 2 records total, across 2 of the 12 customers
  (Sames: 1, Fuel America: 1). Thin, not zero, but not a real test of the
  credit-memo promotion path either.
- **Sales leads**: staging has lead data for 5 of the 12, but the promoter
  has never written a single row to `sales_leads` — confirmed empty, 0 rows,
  org-wide. This path goes live in the wide run completely untested.

All three of these go live in the ~4,500-customer wide run having never once
been exercised by the pilot that's supposedly de-risked it.

## 2026-08-27 — Migration N: the trigger is guarded, and it was doing more
than anyone had spotted

**Ruben's ruling on the trigger conflict documented above: HISTORICAL
INVOICES SHOW WHAT SHOPVOX SHOWED.** His standing rule that historical
records reproduce ShopVOX exactly applies here — an invoice balance is
precisely the kind of thing a customer holds a copy of, so it must match
what ShopVOX itself said, not a live-app recomputation.

**Migration N is applied and verified live.** Both `recalc_invoice_payment_totals()`
and `recalc_payment_applied()` now return early when the target row carries
a `shopvox_id` (i.e., is a promoted/historical row). Live records are
untouched — the app's own invoices and payments have a null `shopvox_id` and
behave exactly as before; only historical rows are exempt. Confirmed live,
directly: manually set a historical invoice's `amount_paid` to a sentinel
value, touched its `payment_applications` row, re-read — sentinel held. Guard
present and working on both functions.

**What that trigger was ALSO doing, which nobody had spotted until now:
alongside `amount_paid` and `balance_due`, it rewrote `invoices.status` to
`'paid'` or `'partial'`.** Historical invoices carry ShopVOX's own status
verbatim, by explicit rule (see the status-vocabulary rule earlier in this
document) — this trigger would have silently overwritten seven years of
ShopVOX's own invoice statuses with a recomputed value, the same silent-write
pattern as the balance issue, just on a different column, and arguably a
bigger deal: a status is user-visible on every invoice list and detail page,
where a balance recompute might only show up in a total. **This is the
bigger finding, per Ruben's own instruction to record it as such.**

**Task AU — re-promoted all 12 pilot customers with the guard in place,
verified independently (separate process execution):**
- The 4 previously-drifted invoices (El Despecho #7227/#7236, Fuel America
  #6955, International Bank of Commerce #1380) now hold ShopVOX's own
  `payments_total`/`balance` exactly, matching staging to the cent.
- `invoices.status` now matches ShopVOX's own status verbatim on all 1,015
  promoted invoices, 0 mismatches — confirmed the status-overwrite guard
  actually holds, not just the balance one.
- All 12 customers reconcile to the penny: 0 identity violations
  (`total - amount_paid - credit_applied = balance_due`) across all 1,015
  invoices.
- Zero row-count growth anywhere — every table's org-wide count matches the
  pre-run baseline exactly (quotes 1,201, invoices 1,015, jobs 1,709,
  payments 763, etc.) — confirms idempotent re-promotion, no duplicates.
- `is_historical` still `false` everywhere (sealing remains a separate,
  later, deliberate step); 0 promoted invoices have a null `shopvox_id`.
- **Sames canary did NOT return to $1,191.18 — it holds at $1,232.38, same
  as before this fix.** Per Ruben's explicit instruction, this was reported
  and NOT investigated further this session — something else may be
  involved, or the $1,191.18 reference figure recorded earlier in this
  document may itself be stale relative to data captured/promoted since it
  was established. Open, not resolved. Do not assume either explanation;
  whoever picks this up should verify live before trusting either.

**Task AV — full discrepancy scan across all 12 pilot customers (ShopVOX's
own `payments_total` vs. the real sum of `payment_applications`) found
exactly the same 4 invoices already known, and nothing else anywhere in the
pilot.** Combined gap $3,434.32, unchanged. Written up in full — every
individual payment, amount, date, and method — in
`scripts/state/invoice-payment-discrepancies.md`. Two (IBC #1380, Fuel
America #6955) are flagged as suspected genuine double-payments, for Ruben to
check against bank records. El Despecho's pair is explained (one real
$2,000 payment legitimately split by ShopVOX across two invoices, confirmed
from that payment's own raw captured data) and marked as such, not flagged.

**Still undocumented as of this writing: the trigger functions themselves
have no migration file anywhere** (same live-schema-drift class as
`payments.is_posted`) — Migration N's guard was applied directly, and
whoever documents `recalc_invoice_payment_totals()`/`recalc_payment_applied()`
properly should also pin down whether each fires on `INSERT` only, `UPDATE`
only, or both, and write a migration file for the guard itself so it isn't
another undocumented live object.

## 2026-08-27 — Task AW: the canary didn't break, and it didn't move either
— the alarm was a filter bug in the verification script, not staging drift

**Investigated because Task AU's re-verification showed Sames' balance at
$1,232.38 instead of the documented $1,191.18.** Ruben's hypothesis was that
the number legitimately moved when staging got re-imported with fresher
data (per the standing sequencing rule above). **That hypothesis turned out
to be wrong too, in a good way — nothing moved, and nothing broke.**

Computed directly from staging (`shopvox_transactions`, `kind = 'invoice'`,
`customer_shopvox_id` = Sames): summing `balance` across the 287 rows where
`is_voided != true` (or, identically, `status != 'void'` — both filters
select the same 287 rows) gives **exactly $1,191.18** — unchanged from the
original baseline. Summing `balance` across all 288 rows with no void filter
gives **exactly $1,232.38** — the number Task AU's own verification script
reported, because that script summed `invoices.balance_due` across ALL of a
customer's invoices with no void exclusion.

**Native and staging agree exactly, invoice by invoice, on all 288 rows —
0 mismatches.** The entire $41.20 gap is one single invoice: **#4844,
`status = 'void'`**, whose `balance` staging genuinely carries as $41.20
(ShopVOX's own data, copied verbatim — not something this pipeline
computed or could have gotten wrong). It was excluded from the original
$1,191.18 hand-computation (correctly — a voided invoice isn't outstanding
receivable) and was never excluded from Task AU's ad hoc verification query,
which just summed every invoice's `balance_due` unconditionally.

**Answering Task AW's four questions directly:**
1. Non-voided sum from staging = $1,191.18, not $1,232.38.
2. So strictly: no, it does not equal $1,232.38 — but this is good news, not
   bad. It means the *correct* canary never moved at all.
3. Nothing else is writing these columns. Native matches staging exactly on
   every one of the 288 rows (checked, not assumed) — the entire discrepancy
   is which invoices get summed, not what any individual row contains.
4. **Zero Sames invoices changed** between the $1,191.18 baseline and now.
   The 12 invoices that make up $1,191.18 today are unchanged from whatever
   made up $1,191.18 originally (all their `captured_at` timestamps are
   2026-08-24, matching the baseline date; a later 2026-08-26 staging
   re-import re-touched their `imported_at` but left every `balance` value
   identical). The only invoice not in the original figure is #4844
   (void, $41.20) — its absence from the baseline was a deliberate exclusion
   (voided invoices don't count as outstanding), not a row that changed.

## Sames canary, re-baselined (Task AX, 2026-08-27)

The old canary was a bare number with no attached query — that's exactly why
it took a real investigation to tell "moved" from "broke." Replacing it with
a full definition:

**Current value: $1,191.18** (Sames Auto Arena, outstanding balance —
non-voided invoices only), confirmed identical from both staging and native
as of 2026-08-27.

**Staging query:**
```sql
select sum(balance) from shopvox_transactions
where customer_shopvox_id = '8f903be5-05db-49f3-826e-11997893f2f8'
  and kind = 'invoice'
  and is_voided is not true;
```

**Native query:**
```sql
select sum(i.balance_due) from invoices i
join customers c on c.id = i.customer_id
where c.shopvox_id = '8f903be5-05db-49f3-826e-11997893f2f8'
  and i.status <> 'void';
```
(native's `balance_due` is integer cents; staging's `balance` is dollars —
divide/multiply by 100 accordingly when comparing the two by hand.)

**Staging state this reflects**: 288 invoice-kind rows for Sames in
`shopvox_transactions`, last re-imported 2026-08-26 (`imported_at` around
04:25–06:48 UTC that day across different batches), 287 non-voided + 1
voided (#4844, `balance` $41.20, correctly excluded).

**This number is EXPECTED TO MOVE whenever staging is genuinely re-imported
with new transaction data for Sames** (a new payment captured, an invoice
voided or unvoided, a balance genuinely recalculated on ShopVOX's side) —
a changed value is not itself a sign of breakage. **The real check is not
"does this equal $1,191.18" — it's "does native equal staging, run both
queries above, right now, and compare."** A constant in a document can only
ever tell you what was true on the day it was written; only re-running both
queries tells you what's true today. If they ever disagree, THAT'S the
signal something is actually wrong — not a bare number failing to match a
remembered reading from days ago.

## Open questions for whoever picks this up next

- ~~TOP PRIORITY: is `transactions/{kind}/{id}` type-checked?~~ **RESOLVED —
  yes, type-checked.** Ran `scripts/api-probe/12_type_agnostic_endpoint_test.mjs`
  once the session was free (see `12_type_agnostic_endpoint_test.json` for
  raw output). Test 1: a quote confirmed to have never converted
  (`0373f951-02ea-470d-8280-255589296b63`, empty `next_transactions`)
  returns **404 at both `transactions/invoices/{id}` and
  `transactions/work_orders/{id}`**, and 200 only at its real
  `transactions/quotes/{id}`. Test 2: re-fetched the 2 Bolillos uuids that
  were earlier reported as having returned 200 at the invoice endpoint
  (`0b6225d5-...`, `d47f2c89-...`) — **both now 404 too**, same as the other
  11. That earlier "2 succeeded" claim was wrong — it was inferred from
  their absence off the importer's parse-failure list, without ever checking
  for an actual capture file; a later corruption-check (prompted by the
  Sames investigation) already found neither uuid had a capture file on
  disk, meaning neither was ever actually fetched — this live retest is the
  final confirmation. All 13 Bolillos phantoms, and the 108 on Sames, and
  the 3 on Indiana Transport SA de CV, are uniformly explained by the
  pre-fix `job.orderId` mistagging bug alone (workflow rule 7) — no second
  mechanism, no type-agnostic endpoint, nothing more to chase here.
  **Practical upshot**: `shopvox_transactions.shopvox_id` being the sole
  natural key (not composite with `kind`) is confirmed NOT a live risk —
  since the endpoint type-checks, a mistagged discovery reliably 404s at
  import time rather than silently succeeding under the wrong kind, so the
  silent-upsert-overwrite scenario this question was raised to guard against
  cannot happen through this path. No code change needed in
  `import-api-capture.mjs` on this account.
  **Re-confirmed a second, independent time on 2026-08-24** with a full 3x3
  matrix on three fresh, real, currently-live TAMIU uuids (a genuine quote,
  sales order, and invoice — not stale/never-converted ones) —
  `scripts/api-probe/13_endpoint_confirm_and_customer_lookups.mjs`, see the
  matching `.json` for raw bodies. Every one of the 9 combinations behaved
  identically to the first test: the correct-kind endpoint returns 200 with
  a real, populated body (`quote`/`workOrder`/`invoice` wrap key); both
  wrong-kind endpoints return 404 with `{"error": "Record Not Found"}` and
  no other wrap key — **a record can never be retrieved under the wrong
  kind with real data.** Zero silent-corruption risk on the
  `shopvox_transactions.shopvox_id` upsert key stands confirmed for the
  main run. **Also newly confirmed which SUB-endpoints are type-agnostic**
  (tested both directions — a real quote fetched as if it were an invoice,
  and a real invoice fetched as if it were a quote): `taggings` and
  `activities` return 200 regardless of the kind mismatch (empty/generic
  results, not real data for that record) — these two are structurally
  incapable of proving a record's kind. `detail`, `prices`,
  `previous_transactions`, `next_transactions`, `line_items`, `bom`, and
  `pdf_document` are all type-checked (404 on mismatch, matching the main
  `detail` endpoint). `emailed_documents` was seen 200 under a wrong-kind
  path in an earlier, disk-only observation (Indiana Transport SA de CV's
  phantom captures) but wasn't independently re-tested live this session —
  it's inherently type-agnostic by construction anyway, since it's a
  filtered list endpoint that takes the type as a filter *value*
  (`transactableType`), not something implied by the URL path.
- Is there any endpoint that reaches a voided job NOT referenced by anything
  else? Not found in this investigation; worth another look before accepting
  445 (Sames) as final.
- Should `manual_time_seconds` get used in an actual costing report, and if
  so does `estimated_user_seconds`/`estimated_machine_seconds` need the same
  treatment for variance analysis?
- `ralph morales`/`nezt real estate group`/`commerce bank`: which PrintOS row
  pairs with which ShopVOX uuid? Needs a human decision, not an algorithm —
  don't guess at this backfill.
- `Dos Marias`: which of the three branch variants (or none) is the one
  referenced by the twelve-customer contrast set?
- Should the closure pass also scan job `stages[].assignedTo[]`/proof
  reviewer references, or any field not yet checked, for further job uuids?
  Only line items, email parents, and `referenceJobId` have been tried.
