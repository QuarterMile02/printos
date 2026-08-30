-- ============================================================
-- Migration 159: payments.payment_number -- auto-generation trigger.
-- Applied: PROPOSED, NOT run.
-- ============================================================
--
-- payment_number already existed as a plain integer column but nothing
-- populated it (confirmed: no trigger on payments, no app code sets
-- it -- dead column). Same MAX+1-per-org pattern as
-- next_invoice_number (migration 026), next_so_number, next_po_number
-- -- not a global sequence, matching every other transaction number in
-- this schema.

CREATE OR REPLACE FUNCTION next_payment_number() RETURNS trigger AS $$
BEGIN
  SELECT COALESCE(MAX(payment_number), 0) + 1
    INTO NEW.payment_number
    FROM payments
   WHERE organization_id = NEW.organization_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_payment_number
  BEFORE INSERT ON payments
  FOR EACH ROW
  WHEN (NEW.payment_number IS NULL OR NEW.payment_number = 0)
  EXECUTE FUNCTION next_payment_number();
