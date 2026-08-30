-- ============================================================
-- Migration 129: Fix schema-drift-findings.md Section 8 items + sent_by FK
-- Applied: NOT YET APPLIED — proposed only, paste into Supabase SQL editor to run
-- ============================================================

-- ── 1. search_vendors_fuzzy — live function drifted from migration 062 ───────
--
-- The live function only returns (id, name, is_active); migration 062's own
-- file defines it with 8 columns (id, name, primary_contact, primary_email,
-- primary_phone, city, is_active, created_at). Someone edited the live
-- function directly at some point without a migration capturing the change.
-- User-visible effect: the Vendors list's fuzzy search results show blank
-- Contact/Phone/Email columns even when the vendor record has that data.
--
-- Restoring exactly migration 062's original definition — same signature,
-- same WHERE/ORDER BY logic, just the full column set.

CREATE OR REPLACE FUNCTION search_vendors_fuzzy(
  p_org_id uuid,
  p_term   text
)
RETURNS TABLE (
  id              uuid,
  name            text,
  primary_contact text,
  primary_email   text,
  primary_phone   text,
  city            text,
  is_active       boolean,
  created_at      timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.id,
    v.name::text,
    v.primary_contact::text,
    v.primary_email::text,
    v.primary_phone::text,
    v.city::text,
    v.is_active,
    v.created_at
  FROM vendors v
  WHERE v.organization_id = p_org_id
    AND (
      v.name             ILIKE '%' || p_term || '%'
      OR v.primary_contact ILIKE '%' || p_term || '%'
      OR v.primary_email   ILIKE '%' || p_term || '%'
      OR v.city            ILIKE '%' || p_term || '%'
      OR v.primary_phone   ILIKE '%' || p_term || '%'
      OR (v.name IS NOT NULL AND similarity(v.name, p_term) > 0.25)
      OR regexp_replace(coalesce(v.name, ''), '[^a-zA-Z0-9]', '', 'g')
           ILIKE '%' || regexp_replace(p_term, '[^a-zA-Z0-9]', '', 'g') || '%'
    )
  ORDER BY
    CASE WHEN v.name ILIKE '%' || p_term || '%' THEN 0 ELSE 1 END,
    v.name
  LIMIT 50
$$;

GRANT EXECUTE ON FUNCTION search_vendors_fuzzy(uuid, text) TO authenticated, service_role;

-- ── 2. search_customers_fuzzy — drop the dead 3-arg overload ─────────────────
--
-- Migration 097 added a (uuid, text, integer) overload, believing the live
-- 2-arg function was missing city/state/terms/tags/created_at. It wasn't —
-- migration 064 had already given the 2-arg function that full column set,
-- confirmed live right now: the 2-arg call already returns all 13 columns.
-- Every real caller (customers/actions.ts's searchCustomers) invokes this
-- with exactly 2 named args; Postgres always resolves that to the 2-arg
-- overload (exact-arity match beats one needing default expansion), so the
-- 3-arg overload from 097 has never been reachable from any caller. Dead
-- weight — removing it.

DROP FUNCTION IF EXISTS public.search_customers_fuzzy(uuid, text, integer);

-- ── 3. quote_deliveries.sent_by — contradictory NOT NULL + ON DELETE SET NULL ─
--
-- The column is `NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL` —
-- logically contradictory: if the referenced auth.users row is ever deleted,
-- Postgres tries to null out sent_by to satisfy ON DELETE SET NULL, which
-- the NOT NULL constraint then rejects, so the DELETE fails outright.
-- Dormant today (both real call sites in quotes/actions.ts always populate
-- sent_by from an authenticated session — never legitimately null), but a
-- real landmine if a staff auth.users row with send history is ever deleted.
--
-- Fix: drop the ON DELETE SET NULL, keep NOT NULL. quote_deliveries is an
-- audit trail — every row should keep genuinely recording who sent it;
-- there's no legitimate "unknown sender" case for this table (unlike
-- activity_log.user_id, which is nullable on purpose for customer-initiated
-- actions with no staff user). With no ON DELETE clause, Postgres defaults
-- to NO ACTION: deleting a staff user with delivery history will now
-- correctly fail with a clear FK violation instead of silently corrupting
-- the constraint — matches how this app already treats staff (deactivate,
-- don't delete; see TeamSettingsClient's Active toggle).
--
-- Looks up the actual live constraint name dynamically rather than assuming
-- it's still the auto-generated `quote_deliveries_sent_by_fkey` (it should
-- be, but this is safe either way and re-runnable).

DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.quote_deliveries'::regclass
    AND contype = 'f'
    AND conkey = ARRAY[(
      SELECT attnum FROM pg_attribute
      WHERE attrelid = 'public.quote_deliveries'::regclass AND attname = 'sent_by'
    )];
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.quote_deliveries DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE public.quote_deliveries
  ADD CONSTRAINT quote_deliveries_sent_by_fkey
  FOREIGN KEY (sent_by) REFERENCES auth.users(id);
