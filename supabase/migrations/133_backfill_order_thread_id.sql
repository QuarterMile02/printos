-- ============================================================
-- Migration 133: Backfill activity_log.order_thread_id
-- Applied: CONFIRMED LIVE in Supabase (2026-08-16) — "Success. No rows
-- returned." Verified post-run: all 5 previously-NULL rows resolved
-- exactly as the dry-run predicted (3 quote rows to themselves, 2 proof
-- rows to the same target quote via two independent metadata paths),
-- 0 rows left NULL, total row count unchanged at 38 (pure UPDATE, no
-- rows added/removed), and the 33 already-populated invoice rows were
-- left untouched.
-- ============================================================
--
-- Scope, checked live before writing this: 38 total activity_log rows
-- exist across the system today; 5 have order_thread_id IS NULL (3
-- quote, 2 proof). Zero sales_order/job/customer/qr_scan rows exist yet
-- — those call sites are wired but haven't fired in real data yet. This
-- migration is still written generically (not hardcoded to today's 5
-- rows) since it needs to keep working as more NULL rows accumulate
-- before every logActivity() call site is updated to stamp
-- order_thread_id at write time (a separate, later task).
--
-- Resolution rule per entity_type — same anchor definition as
-- resolveOrderThreadId in invoices/[id]/actions.ts and migration 132's
-- comment: the originating quote_id, or the sales_order_id itself when
-- there's no quote.
--
--   quote:       entity_id IS the quote's own id — no lookup needed.
--   sales_order: sales_orders.quote_id ?? sales_orders.id (via entity_id)
--   invoice:     invoices.sales_order_id -> sales_orders.quote_id ?? .id
--   job:         prefer jobs.source_quote_id (matches the existing
--                read-site convention — see convert-action.ts's comment
--                on why both source_quote_id and sales_order_id are set);
--                fall back to jobs.sales_order_id -> sales_orders chain
--                when there's no source quote.
--   proof:       entity_id is NOT reliable here — checked live, it's
--                sometimes a proof_versions.id, sometimes a
--                proof_sends.id, depending which of 3 call sites wrote
--                the row. Every call site already puts job_id or
--                sales_order_id directly in metadata jsonb (confirmed
--                against both real rows), so resolve from metadata
--                instead of guessing which table entity_id points to.
--   customer:    no order association exists for this entity_type by
--                design (collection calls, the only customer-level
--                event, aren't tied to one invoice/order in the current
--                schema — confirmed by reading the write path). Stays
--                NULL — not a bug, not something this migration touches.
--   qr_scan:     no call site produces this entity_type today. Nothing
--                to backfill; not handled here.
--
-- Every UPDATE is guarded by `WHERE order_thread_id IS NULL`, so this is
-- naturally idempotent — safe to re-run.

-- ── quote ──────────────────────────────────────────────────────────────
UPDATE activity_log
SET order_thread_id = entity_id
WHERE entity_type = 'quote' AND order_thread_id IS NULL;

-- ── sales_order ────────────────────────────────────────────────────────
UPDATE activity_log al
SET order_thread_id = COALESCE(so.quote_id, so.id)
FROM sales_orders so
WHERE al.entity_type = 'sales_order'
  AND al.order_thread_id IS NULL
  AND so.id = al.entity_id;

-- ── invoice ────────────────────────────────────────────────────────────
UPDATE activity_log al
SET order_thread_id = COALESCE(so.quote_id, so.id)
FROM invoices inv
JOIN sales_orders so ON so.id = inv.sales_order_id
WHERE al.entity_type = 'invoice'
  AND al.order_thread_id IS NULL
  AND inv.id = al.entity_id;

-- ── job — prefer source_quote_id directly ─────────────────────────────
UPDATE activity_log al
SET order_thread_id = j.source_quote_id
FROM jobs j
WHERE al.entity_type = 'job'
  AND al.order_thread_id IS NULL
  AND j.id = al.entity_id
  AND j.source_quote_id IS NOT NULL;

-- ── job — fall back through sales_order_id when no source quote ──────
UPDATE activity_log al
SET order_thread_id = COALESCE(so.quote_id, so.id)
FROM jobs j
JOIN sales_orders so ON so.id = j.sales_order_id
WHERE al.entity_type = 'job'
  AND al.order_thread_id IS NULL
  AND j.id = al.entity_id
  AND j.source_quote_id IS NULL
  AND j.sales_order_id IS NOT NULL;

-- ── proof — resolve from metadata.sales_order_id when present ────────
UPDATE activity_log al
SET order_thread_id = COALESCE(so.quote_id, so.id)
FROM sales_orders so
WHERE al.entity_type = 'proof'
  AND al.order_thread_id IS NULL
  AND (al.metadata->>'sales_order_id') IS NOT NULL
  AND so.id = (al.metadata->>'sales_order_id')::uuid;

-- ── proof — else resolve from metadata.job_id (source_quote_id first) ─
UPDATE activity_log al
SET order_thread_id = j.source_quote_id
FROM jobs j
WHERE al.entity_type = 'proof'
  AND al.order_thread_id IS NULL
  AND (al.metadata->>'job_id') IS NOT NULL
  AND j.id = (al.metadata->>'job_id')::uuid
  AND j.source_quote_id IS NOT NULL;

-- ── proof — else via job_id's sales_order_id fallback ─────────────────
UPDATE activity_log al
SET order_thread_id = COALESCE(so.quote_id, so.id)
FROM jobs j
JOIN sales_orders so ON so.id = j.sales_order_id
WHERE al.entity_type = 'proof'
  AND al.order_thread_id IS NULL
  AND (al.metadata->>'job_id') IS NOT NULL
  AND j.id = (al.metadata->>'job_id')::uuid
  AND j.source_quote_id IS NULL
  AND j.sales_order_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
