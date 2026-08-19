-- ============================================================
-- Migration 160: payment_applications -- payment-to-target allocation
-- table.
-- Applied: PROPOSED, NOT run.
-- ============================================================
--
-- Decouples "money received" (payments) from "what it's for" (this
-- table). One payment can apply to N targets (split across multiple
-- invoices), sit partially applied, or sit fully unapplied (a deposit
-- with zero rows here at all) -- confirmed against a live ShopVOX
-- payment record (PY #9241) as the real, needed shape, not a
-- hypothetical one.
--
-- REVISED from the first draft: three nullable FK columns
-- (quote_id/sales_order_id/invoice_id) instead of a generic
-- target_type/target_id pair. This gives real DB-enforced referential
-- integrity and cascade behavior -- this table allocates money, it
-- should be the strictest thing in the schema, not the loosest,
-- especially after Session 11 found 17 products with orphaned recipe
-- rows pointing at a material that no longer existed under the
-- equivalent generic-reference pattern. num_nonnulls(...) = 1 enforces
-- "exactly one target" at the database level, not the app layer.
--
-- Invariant this table exists to support:
--   payments.amount_paid = sum(payment_applications.amount_applied
--                               for that payment_id)
--                           + payments.refunded_amount
--                           + payments.balance (unapplied remainder)
-- "Unapplied Payments" = payments where balance > 0.
--
-- RLS: added this pass, along with the REVOKE from anon that
-- job_notifications (migration 153) needed added after the fact --
-- not skipping that step again on a table that allocates money.

CREATE TABLE payment_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  quote_id uuid REFERENCES quotes(id),
  sales_order_id uuid REFERENCES sales_orders(id),
  invoice_id uuid REFERENCES invoices(id),
  amount_applied integer NOT NULL CHECK (amount_applied > 0),
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by uuid REFERENCES auth.users(id),
  CHECK (num_nonnulls(quote_id, sales_order_id, invoice_id) = 1)
);

ALTER TABLE payment_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can manage payment applications" ON payment_applications FOR ALL USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())) WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

CREATE INDEX idx_payment_applications_payment ON payment_applications(payment_id);
CREATE INDEX idx_payment_applications_quote ON payment_applications(quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX idx_payment_applications_sales_order ON payment_applications(sales_order_id) WHERE sales_order_id IS NOT NULL;
CREATE INDEX idx_payment_applications_invoice ON payment_applications(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX idx_payment_applications_org ON payment_applications(organization_id);

grant select, insert, update, delete on public.payment_applications to authenticated;
grant select, insert, update, delete on public.payment_applications to service_role;
revoke all on public.payment_applications from anon;
