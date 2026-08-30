-- ============================================================
-- Migration 158: payments -- redesign columns for the polymorphic
-- payment-applications model.
-- Applied: PROPOSED, NOT run.
-- ============================================================
--
-- Context (full design discussion in chat, not repeated here): a live
-- ShopVOX payment record (PY #9241) confirmed applications are
-- polymorphic -- a payment can apply to a quote, sales order, or
-- invoice, not just an invoice. QMI's 60/40 deposit applies against
-- the quote/SO directly, before an invoice exists. A single
-- payments.invoice_id column cannot represent that -- dropped below.
--
-- Also confirmed live on that same ShopVOX record and folded in here:
--   - Applied / Refunded / Balance as three distinct values, not one
--     balance. applied and refunded_amount are maintained by triggers
--     (migrations 161/164, from payment_applications and refunds
--     respectively) since they're cross-table aggregates. balance is
--     a GENERATED column computed purely from this row's own three
--     amount columns -- no trigger needed for it, no drift possible.
--   - Check Number (method-specific -- checks only) and card fields
--     (card_last4, card_brand, gateway_transaction_id -- NEVER a PAN
--     or CVV; Authorize.net Accept.js tokenizes client-side, PrintOS
--     never receives raw card data).
--   - is_posted / posted_at -- payments get their own posting axis,
--     matching invoices' migration 090 pattern exactly.
--   - created_by already existed; updated_by/updated_at added to
--     match.
--
-- Type tightening: amount_paid/applied/balance were `numeric` with
-- zero live rows (confirmed) -- changed to `integer` (cents) to match
-- every other money column in this schema (quotes/sales_orders/
-- invoices are all cents-as-integer). The one existing write path
-- (CustomerTabsSection.tsx's logPayment -> POST /api/payments) already
-- sends `Math.round(dollars * 100)`, i.e. already cents -- this just
-- makes the column type honest about what's actually stored.

ALTER TABLE payments
  DROP COLUMN invoice_id,
  ALTER COLUMN amount_paid TYPE integer USING amount_paid::integer,
  ALTER COLUMN applied TYPE integer USING applied::integer,
  ALTER COLUMN applied SET DEFAULT 0,
  DROP COLUMN balance,
  ADD COLUMN refunded_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN balance integer GENERATED ALWAYS AS (amount_paid - applied - refunded_amount) STORED,
  ADD COLUMN check_number text,
  ADD COLUMN card_last4 text,
  ADD COLUMN card_brand text,
  ADD COLUMN gateway_transaction_id text,
  ADD COLUMN is_posted boolean NOT NULL DEFAULT false,
  ADD COLUMN posted_at timestamptz,
  ADD COLUMN updated_by uuid REFERENCES auth.users(id),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT payments_amount_paid_nonneg CHECK (amount_paid >= 0),
  ADD CONSTRAINT payments_applied_nonneg CHECK (applied >= 0),
  ADD CONSTRAINT payments_refunded_nonneg CHECK (refunded_amount >= 0);
