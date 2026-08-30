# import-chain-capture.mjs — unmapped-field report

Generated against the live capture in `scripts/chain-capture/chainA/*.json`
and `scripts/chain-capture/chainB/*.json` (5 transactions, 3 jobs). Every
field listed below IS still preserved — it survives in the `raw` jsonb
column of whichever row it belongs to (or, for transaction/job-level fields,
on the parent transaction/job's own `raw`) — this is a list of what did
**not** get promoted to a typed column, not a list of data that was lost.

## Part 1 — captured fields NOT promoted to a typed column

### Transactions (quote / sales_order / invoice) — one entry per file, same shape across all 5

**Header (`collapsedHeader` / `expandedHeader`)**
- `collapsedHeader.*` in its entirety (labelValuePairs, tables, links other
  than the one customer-uuid link, tabCandidates, buttonTexts,
  bodyTextLength) — captured specifically to diff against `expandedHeader`
  post-"Show All Information", never itself promoted. Sample:
  `collapsedHeader.labelValuePairs` has 18 pairs on IN #9380; none written.
- `expandedHeader.labelValuePairs` entries for: **Customer** (both the "AT
  Anissa Trevino" and "SA Sames Auto Arena" rows — company name has no
  column; contact name IS captured via Primary Contact), **Team
  Assignments** (a redundant echo of Sales Rep), **Payment & Tax** (sample:
  `"EXEMPT (0%)"`), **Down Payment** (sample: `"($48.52)"`), **Tax** (the
  exemption-status text, distinct from the numeric `tax_total` — sample:
  `"EXEMPT (0%)"`), **Terms** (SO/IN only — sample: `"Net 30"`), **Expiry
  Date** (QT only — sample: `"08/29/2026"`), **Next Contact Date** (sample:
  `"08/01/2026"`), and a mis-paired category→job-status entry (e.g.
  `"Signs / Large Format Printing"` → `"Job Completed"` — an artifact of the
  generic p/span extractor, not real data; the real category is
  correctly captured per-line-item instead).
- `expandedHeader.tables` (the totals-preview table, redundant with
  `totals[]`, which IS separately parsed), `.links`, `.tabCandidates`,
  `.buttonTexts`, `.bodyTextLength` — none promoted.

**Line items**
- `lineItems[].jobStatusText` — a human-readable snapshot of the job's
  status AT CAPTURE TIME (sample: `"Job In Progress (Diagnose Electrical
  Sign)"`). Only the job UUID (via `jobHref`) is promoted, into
  `shopvox_job_line_items`; this descriptive string is dropped. Consider
  promoting if a point-in-time status snapshot has reporting value.
- `lineItems[].additionalInfoBtnLabel` (sample: `"Additional Info (1)"`) —
  not stored; it was only ever a UI-state signal.
- `lineItems[].productDetails.title` — redundant with `product_name`, not
  separately stored (expected/fine).

**Totals**
- `totals[]` entries for **`PO Total:`**, **`SO - PO Total:`**, and
  **`Invoiced:`** (sales orders only) — `shopvox_transactions` has no
  columns for these. Sample from SO #9371: `PO Total: "$0.00"`,
  `SO - PO Total: "$4,246.93"`, `Invoiced: "0%"`. These are real,
  meaningful fields (PO reconciliation, invoiced %) with nowhere to go —
  flagging for a possible schema addition.

**PDF**
- `pdf.requiredAuthHeaders` — my own investigative note from capture time
  (a description of the auth mechanism, not transaction data). Not a
  column anywhere; kept only in `shopvox_documents.raw`.

**Tabs**
- `tabs.tasks`, `tabs.assets`, `tabs.notes`, `tabs.related`, `tabs.emails`,
  `tabs.shipments`, `tabs.bom` — the generic extractor captured only an
  empty shell for every one of these on every transaction (confirmed:
  `tabs.related.tables[*].rowCount` is `0` on all 5 files despite the page
  showing a nonzero "Related (2)" badge — see
  `scripts/chain-capture/_findings.md`'s grid-parsing limitation). **Zero
  rows were produced for `shopvox_notes`, `shopvox_tasks`,
  `shopvox_record_assets`, and `shopvox_shipments` from the transaction
  side as a direct result** — this is a capture gap, not confirmed-empty
  data (see Part 2).
- `tabs.purchasing` (sales orders only) — read but never mapped to
  anything. Both captured SOs show an empty Purchasing tab (no PO raised
  yet), so there was nothing to promote either way.
- `tabs.history.labelValuePairs/tables/links/tabCandidates/buttonTexts/bodyTextLength`
  — only `tabs.history.historyFullText` (a separate field added specifically
  for parsing) was used; the generic-extractor half of this tab's capture
  is unused.

### Jobs — one entry per file (JB_14597, JB_2abfb144, JB_9f307de8)

- **`breadcrumb[]`** (QT/SO/LI/IN parent links, e.g. `{"text":"LI:1",
  "href":"/transactions/sales-orders/.../#position=1"}`) — never written to
  any `shopvox_jobs` column. This is mostly redundant with
  `shopvox_job_line_items` (populated from the transaction side), but it's
  richer in one way: it shows a job's line-item position on BOTH its SO and
  its IN (two separate `LI:1` entries), confirming the position is stable
  across the sales-order→invoice conversion — that specific cross-check
  isn't preserved anywhere structured.
- `headerBadges.jobColor.text` (always the literal label `"Job Color:"`) —
  only `.backgroundColor` (the swatch's rgb value) is stored, into
  `job_color`. **Note this is a genuine representation compromise**: the
  UI never exposes a color NAME (e.g. "Pink"), only a swatch color, so
  `job_color` is being populated with an `rgb(...)` string rather than a
  human label — flagging in case the real schema/reports expect a name.
- `bom.text`'s prose header (product name / quantity / modifiers, restated
  above the materials grid) — only the grid rows are parsed
  (`parseBomGridRows`); the prose is redundant with the line item's own
  `modifiers`/`description` already captured on the transaction side.
- `proofMenuOptions` (sample: `["Disapprove Proof","Download Proof","Visit
  Customer Link","Delete Proof"]`) — no schema column represents "available
  actions on a record," so this stays raw-only by design, not an oversight.
- `history.linkHrefs` (e.g. a proof-review contact link, or the job's own
  self-link) — not consumed; only `history.text` is parsed into activities.
- `rightRail.pairs` entries for **`Customer`** (company name — sample:
  `"SA\nSames Auto Arena"`) and **`Primary Contact`** (sample:
  `"AT\nAnissa Trevino"`) — `customer_shopvox_id` IS populated (from a
  separate link lookup), but the human-readable customer name and the
  primary contact's name/uuid have **no column on `shopvox_jobs` at all**
  (contrast: `shopvox_transactions.primary_contact_name` exists and IS
  populated). This is arguably a schema gap — see Part 2.
- `genericFallback.*` in its entirety except `.links` (used only for the
  customer-uuid lookup) — kept purely as a capture-time fallback/diagnostic,
  never promoted.

## Part 2 — schema columns with NO source field (the inverse)

- **`shopvox_transactions.accounting_status`** — never appears in any
  captured `labelValuePairs` set on any of the 5 transactions, despite
  being visible on-screen (confirmed manually once, on the Invoice's
  `/activities` sub-route: `"Accounting Status" → "Posted"`). The
  systematic capture script never picked it up. **Scraper gap**: worth
  adding an explicit selector for this field.
- **`shopvox_transactions.production_manager`**, **`.project_manager`** —
  not exposed anywhere at the transaction-header level in this app (they
  only appear on jobs, where they ARE captured). Left `null` for all 5
  transactions; not a capture bug, the field genuinely isn't there.
- **`captured_at`** (on `shopvox_transactions`, `shopvox_line_items`,
  `shopvox_jobs`, `shopvox_proofs`, `shopvox_documents`,
  `shopvox_job_workflow_steps`, `shopvox_activities`) — the capture script
  never records a per-page/per-section timestamp anywhere in its JSON
  output. Left `null` everywhere rather than substituting file mtime (which
  would conflate "when I dumped this JSON to disk" with "when the page was
  actually loaded" — several files were re-captured hours apart while
  fixing a bug, so mtime would be actively misleading). **Scraper gap**:
  the capture script should stamp `new Date().toISOString()` once per
  page-load and thread it through.
- **`shopvox_proofs.approved_by`**, **`.approved_at`** — technically
  derivable (the proof's own activity log, captured verbatim in
  `proofsBlock.text`, includes `"Anissa Trevino ... Approved this proof."`
  with a timestamp) but this importer does not do that second-level parse.
  Left `null`. Worth a follow-up parser if proof approval SLAs matter.
- **`shopvox_proofs.file_size_bytes`**, **`.storage_path`** — never
  captured (would require a HEAD request per proof; the capture script
  never made one). `storage_path` is correctly left `null` regardless since
  proofs live on ShopVOX's own CDN, not anything we've downloaded.
- **`shopvox_job_workflow_steps.status`**, **`.assignees`**,
  **`.recorded_time_minutes`**, **`.started_at`**, **`.completed_at`** —
  this is the central finding of the capture investigation (see
  `_findings.md` §1): none of these are exposed anywhere in the workflow
  step UI. `status` (idle/started/completed, conveyed only by icon color)
  and `assignees` (names, vs. the count we DO have) were visually present
  but not captured as text by the script — scraper gap. `started_at` /
  `completed_at` / `recorded_time_minutes` are NOT capturable from the UI
  at all in any authoritative form; they must be reconstructed from
  `shopvox_activities` `State: Idling → Started` / `Started → Completed`
  transitions on the same `parent_shopvox_id`.
- **`shopvox_bom_items.notes`** — no source field maps to it (`Attr 1`/
  `Attr 2` in the BOM grid were both literal placeholder dashes on the one
  row captured).
- **`shopvox_documents.sha256`** — not computed by the capture or import
  script.
- **`shopvox_emails`**, **`shopvox_email_attachments`** — 0 rows, by
  **deliberate scope decision**, not a gap: `tabs.emails` on every
  transaction is an empty capture shell (see Part 1), and the only REAL
  email data this pilot captured (3 full samples with bodies, in
  `scripts/chain-capture/_emails_investigation.json`) is customer-wide, not
  scoped to chain A/B specifically, and sits outside the literal read scope
  this task specified (`chainA/*.json` and `chainB/*.json` only). Flagging
  for a decision: import those 3 samples anyway (they're real, usable
  data, just not chain-specific), or leave them out until a dedicated
  emails-capture pass exists.
- **`shopvox_notes`**, **`shopvox_tasks`**, **`shopvox_record_assets`**,
  **`shopvox_shipments`** — 0 rows from every source. For **jobs**, this is
  confirmed genuinely empty (`Notes (0)`, `Assets (0)` literal counts
  observed on all 3 jobs). For **transactions**, it is NOT confirmed empty
  — it's the same grid-parsing capture gap noted in Part 1 (the tabs render
  a real shopvox grid the generic extractor doesn't parse into rows).
  Treat job-side zeros as fact, transaction-side zeros as unknown.

## Part 3 — natural-key / idempotency notes (surfaced while building this importer)

- The task brief gave no natural key for **`shopvox_transaction_charges`**
  or **`shopvox_bom_items`**. I inferred `(transaction_shopvox_id, label)`
  and `(job_shopvox_id, position)` respectively and tried them as
  `ON CONFLICT` targets — **confirmed live against the real database: no
  such unique constraint exists on either table.** The importer instead
  achieves idempotency for these two tables by deleting every existing row
  for the parent(s) being re-imported, then inserting fresh, inside the
  same run. Net effect is identical to an upsert; verified idempotent by
  running the importer 3 times consecutively and confirming row counts
  never grew (20 charges, 1 bom item, stable across runs).
- `shopvox_activities.field_name` and `shopvox_job_workflow_steps.stage`
  are both part of their table's unique constraint and are sometimes
  genuinely absent (an activity with no field change; a workflow step
  whose phase couldn't be confidently attributed — see `_findings.md`-style
  reasoning in `scripts/lib/shopvox-import-blocks.mjs`). Postgres unique
  constraints treat `NULL` as distinct-from-everything, which would have
  silently broken idempotent re-runs for exactly those rows. Both are
  stored as `''` (empty string) instead of `null` specifically to keep
  `ON CONFLICT` working — a deliberate, documented substitution, not a
  data-quality error. The true "was this attributed with confidence?"
  signal survives in each row's `raw.stageAttributionConfident`.
- `shopvox_emails` was given no natural key either; I inferred
  `(parent_shopvox_id, subject, sent_at)` but never exercised it (0 rows
  this run — see Part 2's `shopvox_emails` entry).
