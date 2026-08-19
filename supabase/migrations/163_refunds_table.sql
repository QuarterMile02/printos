-- ============================================================
-- Migration 163: refunds -- schema now, UI later.
-- Applied: PROPOSED, NOT run.
-- ============================================================
--
-- Columns match ShopVOX's own Refunds sub-tab exactly (confirmed live
-- on PY #9241's Transactions tab: RF#, Payment Method, Refunded On,
-- Amount), plus the org/audit columns every other transaction table
-- in this schema carries. refund_number is a real MAX+1-per-org
-- column with a trigger, same pattern as payment_number (migration
-- 159) -- not left dead like payment_number was before this pass.
--
-- payment_method here is intentionally independent of the original
-- payment's method -- a card payment can be refunded by check, a
-- check payment refunded via ACH, etc. Not assumed to match.
--
-- RLS: added this pass, along with the REVOKE from anon that
-- job_notifications (migration 153) needed added after the fact --
-- not skipping that step again on a table that allocates money.

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  refund_number integer,
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount > 0),
  payment_method text,
  refunded_on date,
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION next_refund_number() RETURNS trigger AS $$
BEGIN
  SELECT COALESCE(MAX(refund_number), 0) + 1
    INTO NEW.refund_number
    FROM refunds
   WHERE organization_id = NEW.organization_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_refund_number
  BEFORE INSERT ON refunds
  FOR EACH ROW
  WHEN (NEW.refund_number IS NULL OR NEW.refund_number = 0)
  EXECUTE FUNCTION next_refund_number();

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can manage refunds" ON refunds FOR ALL USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())) WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

CREATE INDEX idx_refunds_payment ON refunds(payment_id);
CREATE INDEX idx_refunds_org ON refunds(organization_id);

grant select, insert, update, delete on public.refunds to authenticated;
grant select, insert, update, delete on public.refunds to service_role;
revoke all on public.refunds from anon;
