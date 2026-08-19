-- ============================================================
-- Migration 161: invoices.amount_paid / balance_due / status --
-- recalculated by trigger from payment_applications, not app code.
-- Applied: PROPOSED, NOT run.
-- ============================================================
--
-- Decision (explicit, not the default choice): DB TRIGGER, not
-- app-layer recalculation. The bug this whole schema redesign exists
-- to fix was two disconnected write paths (invoice-page recordPayment
-- vs customer-page logPayment) that each updated their own half of
-- the picture and silently ignored the other's. An app-layer recalc
-- function has the same failure mode the moment a third code path
-- writes to payment_applications and forgets to call it. A trigger
-- cannot be bypassed by a future call site, the same reasoning already
-- applied to guard_invoice_edit_when_posted (migration 132).
--
-- Status logic mirrors recordPayment's existing behavior exactly
-- (invoices/actions.ts, being retired by this redesign) rather than
-- inventing new semantics: balance_due <= 0 -> 'paid', any amount
-- paid but not fully -> 'partial', otherwise leave status untouched
-- (a draft/void/etc. invoice with zero payment_applications rows
-- against it doesn't get forced into a payment-related status).
--
-- Only fires for target_type = 'invoice' -- quote/sales_order
-- applications (the 60/40 deposit case) are handled by scoping this
-- function to invoices only. Deliberately NOT adding amount_paid/
-- balance_due columns to quotes/sales_orders in this pass -- that
-- wasn't asked for; a quote/SO's applied-payment total can be queried
-- live against payment_applications when needed (e.g. "deposit
-- received: $X of $Y") without denormalizing it, since those aren't
-- rendered in bulk list views the way invoice totals are.

CREATE OR REPLACE FUNCTION recalc_invoice_payment_totals(p_invoice_id uuid) RETURNS void AS $$
DECLARE
  v_total integer;
  v_paid integer;
  v_balance integer;
BEGIN
  SELECT total INTO v_total FROM invoices WHERE id = p_invoice_id;
  IF v_total IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(amount_applied), 0) INTO v_paid
    FROM payment_applications
   WHERE target_type = 'invoice' AND target_id = p_invoice_id;

  v_balance := GREATEST(0, v_total - v_paid);

  UPDATE invoices
     SET amount_paid = v_paid,
         balance_due = v_balance,
         status = CASE
                     WHEN v_balance <= 0 AND v_total > 0 THEN 'paid'
                     WHEN v_paid > 0 THEN 'partial'
                     ELSE status
                   END,
         updated_at = now()
   WHERE id = p_invoice_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_payment_applications_recalc_invoice() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.target_type = 'invoice' THEN PERFORM recalc_invoice_payment_totals(OLD.target_id); END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.target_type = 'invoice' THEN PERFORM recalc_invoice_payment_totals(OLD.target_id); END IF;
    IF NEW.target_type = 'invoice' AND (OLD.target_type IS DISTINCT FROM NEW.target_type OR OLD.target_id IS DISTINCT FROM NEW.target_id) THEN
      PERFORM recalc_invoice_payment_totals(NEW.target_id);
    END IF;
    RETURN NEW;
  ELSE
    IF NEW.target_type = 'invoice' THEN PERFORM recalc_invoice_payment_totals(NEW.target_id); END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_applications_recalc_invoice
  AFTER INSERT OR UPDATE OR DELETE ON payment_applications
  FOR EACH ROW
  EXECUTE FUNCTION trg_payment_applications_recalc_invoice();
