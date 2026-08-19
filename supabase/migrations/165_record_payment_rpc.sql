-- ============================================================
-- Migration 165: record_payment() -- the single, transactional write
-- path for recording a payment, replacing the two disconnected ones
-- (recordPayment's direct invoices.amount_paid write, logPayment's
-- invoice-less payments insert).
-- Applied: PROPOSED, NOT run.
-- ============================================================
--
-- Why an RPC and not two sequential inserts from the server action:
-- Supabase's REST/JS client has no BEGIN/COMMIT -- two separate
-- .insert() calls from app code are two separate transactions, and a
-- failure on the second (the applications insert) leaves an orphaned
-- payment row with nothing applied. A single plpgsql function call is
-- one implicit Postgres transaction: if anything inside raises, the
-- whole thing rolls back, including the payment insert. This is the
-- actual mechanism behind "in ONE transaction," not just a comment
-- saying so.
--
-- p_applications is a jsonb array of {target_type, target_id,
-- amount_applied} and may be EMPTY -- that's the deposit case (a
-- payment with zero applications, fully unapplied, matching the
-- 60/40-before-invoice scenario this whole schema exists for).
-- target_type routes into whichever of quote_id/sales_order_id/
-- invoice_id is non-null on the application row, matching
-- payment_applications' three-nullable-FK shape (migration 160) --
-- its own CHECK (num_nonnulls(...) = 1) is the backstop if this
-- routing is ever wrong.
--
-- Deliberately does NOT touch invoices.amount_paid/balance_due/status
-- -- trigger 161 owns those, fired automatically by the
-- payment_applications insert below. This function only ever writes
-- to payments and payment_applications, nothing else, which is the
-- whole point: the app writes applications, the database derives
-- everything downstream.

CREATE OR REPLACE FUNCTION record_payment(
  p_organization_id uuid,
  p_customer_id uuid,
  p_amount_paid integer,
  p_payment_method text,
  p_paid_on date,
  p_note text,
  p_check_number text,
  p_created_by uuid,
  p_applications jsonb
) RETURNS uuid AS $$
DECLARE
  v_payment_id uuid;
  v_app jsonb;
  v_target_type text;
  v_target_id uuid;
  v_amount_applied integer;
  v_total_applied integer := 0;
BEGIN
  IF p_amount_paid <= 0 THEN
    RAISE EXCEPTION 'amount_paid must be positive';
  END IF;

  INSERT INTO payments (
    organization_id, customer_id, amount_paid, payment_method,
    paid_on, note, check_number, created_by
  ) VALUES (
    p_organization_id, p_customer_id, p_amount_paid, p_payment_method,
    p_paid_on, p_note, p_check_number, p_created_by
  ) RETURNING id INTO v_payment_id;

  FOR v_app IN SELECT * FROM jsonb_array_elements(COALESCE(p_applications, '[]'::jsonb))
  LOOP
    v_target_type := v_app->>'target_type';
    v_target_id := (v_app->>'target_id')::uuid;
    v_amount_applied := (v_app->>'amount_applied')::integer;

    IF v_target_type NOT IN ('quote', 'sales_order', 'invoice') THEN
      RAISE EXCEPTION 'invalid target_type: %', v_target_type;
    END IF;
    IF v_amount_applied IS NULL OR v_amount_applied <= 0 THEN
      RAISE EXCEPTION 'amount_applied must be positive';
    END IF;

    v_total_applied := v_total_applied + v_amount_applied;

    INSERT INTO payment_applications (
      organization_id, payment_id, quote_id, sales_order_id, invoice_id,
      amount_applied, applied_by
    ) VALUES (
      p_organization_id,
      v_payment_id,
      CASE WHEN v_target_type = 'quote' THEN v_target_id END,
      CASE WHEN v_target_type = 'sales_order' THEN v_target_id END,
      CASE WHEN v_target_type = 'invoice' THEN v_target_id END,
      v_amount_applied,
      p_created_by
    );
  END LOOP;

  IF v_total_applied > p_amount_paid THEN
    RAISE EXCEPTION 'total applied (%) exceeds amount paid (%)', v_total_applied, p_amount_paid;
  END IF;

  RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql;

grant execute on function record_payment(uuid, uuid, integer, text, date, text, text, uuid, jsonb) to authenticated;
grant execute on function record_payment(uuid, uuid, integer, text, date, text, text, uuid, jsonb) to service_role;
