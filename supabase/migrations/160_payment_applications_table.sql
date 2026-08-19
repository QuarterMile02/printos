-- ============================================================
-- Migration 160: payment_applications -- polymorphic payment-to-target
-- allocation table.
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
-- target_type/target_id is a generic polymorphic pair, not three
-- separate nullable FK columns -- matches the shape decided in chat.
-- Trade-off, noted rather than silently made: Postgres can't express
-- a single FK across three target tables, so referential integrity to
-- quotes/sales_orders/invoices is enforced at the application layer,
-- not by the database, for this one relationship. Every other FK in
-- this schema is DB-enforced; this is the one deliberate exception.
--
-- Invariant this table exists to support:
--   payments.amount_paid = sum(payment_applications.amount_applied
--                               for that payment_id)
--                           + payments.refunded_amount
--                           + payments.balance (unapplied remainder)
-- "Unapplied Payments" = payments where balance > 0.

CREATE TABLE payment_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('quote', 'sales_order', 'invoice')),
  target_id uuid NOT NULL,
  amount_applied integer NOT NULL CHECK (amount_applied > 0),
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by uuid REFERENCES auth.users(id)
);

ALTER TABLE payment_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can manage payment applications" ON payment_applications FOR ALL USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())) WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

CREATE INDEX idx_payment_applications_payment ON payment_applications(payment_id);
CREATE INDEX idx_payment_applications_target ON payment_applications(target_type, target_id);
CREATE INDEX idx_payment_applications_org ON payment_applications(organization_id);

grant select, insert, update, delete on public.payment_applications to authenticated;
grant select, insert, update, delete on public.payment_applications to service_role;
