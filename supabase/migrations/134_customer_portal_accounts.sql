-- ============================================================
-- Migration 134: Customer Portal accounts — customer_contacts columns
-- Applied: PENDING — run manually in the Supabase SQL Editor (Ruben),
--   not auto-applied by Claude Code. See chat for context.
-- ============================================================
--
-- Step 1 of the Customer Portal account/invite build plan (rev. 2,
-- confirmed 2026-08-17). Schema-only -- no invite/login routes, no RLS
-- policy changes on quotes/sales_orders/invoices/payments yet (those are
-- steps 3 and 6 of the phased plan, separate migrations).
--
-- portal_user_id is DELIBERATELY NOT UNIQUE. Confirmed against live data
-- (671 of 6,717 emailed customer_contacts rows -- ~10% -- appear across
-- 2+ different `customers` records; some are large institutional
-- accounts sharing one AP inbox across dozens of department/location
-- "customer" rows, e.g. apinvoices@webbcountytx.gov across 33 customers).
-- One real person's login must be able to map to multiple customer_id
-- values, so multiple customer_contacts rows are allowed to carry the
-- same portal_user_id once that person has an account. The eventual RLS
-- policies (step 6) read this as
--   customer_id IN (SELECT customer_id FROM customer_contacts
--                    WHERE portal_user_id = auth.uid())
-- which already handles the one-login/many-customers case correctly as
-- long as this column stays non-unique.
--
-- Linking across customers is explicit opt-in only (locked decision,
-- rev. 2 plan) -- accepting one invite never auto-links other
-- customer_contacts rows that happen to share the same email, even
-- though the schema permits it once staff deliberately invites each
-- relationship. No auto-link logic lives in this migration; it's an
-- application-layer decision enforced in the invite flow (step 3).
--
-- portal_invite_token/_expires_at mirror organization_invites' existing
-- token/expiry shape (migration 001) rather than inventing a new
-- pattern. portal_invited_at/portal_last_login_at are audit fields only,
-- not used by any access-control logic.
--
-- Revoke semantics (locked decision, rev. 2 plan) are enforced entirely
-- at the application layer using these same columns, no separate schema
-- support needed:
--   - "Revoke Portal Access" (customer detail page) nulls
--     portal_user_id/_token/_expires_at on ONE customer_contacts row only.
--   - "Delete Login" (separate, rare, contact-level action -- not yet
--     built) calls auth.admin.deleteUser() on the auth.users row itself;
--     ON DELETE SET NULL below cascades portal_user_id to null on every
--     customer_contacts row that shared it, with no manual cleanup query
--     needed.
--
-- No new grants/RLS needed: customer_contacts already has RLS enabled
-- and grants to anon/authenticated/service_role from migrations 041 and
-- 057 -- these are new columns on an already-secured table, not a new
-- table. Postgres has no per-column grants; the existing table-level
-- policies already cover them.

ALTER TABLE customer_contacts
  ADD COLUMN IF NOT EXISTS portal_user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS portal_invited_at         timestamptz,
  ADD COLUMN IF NOT EXISTS portal_invite_token       text,
  ADD COLUMN IF NOT EXISTS portal_invite_expires_at  timestamptz,
  ADD COLUMN IF NOT EXISTS portal_last_login_at      timestamptz;

-- Non-unique -- see note above. Partial index (WHERE NOT NULL) keeps it
-- small and fast for the lookups that matter (login -> which customers,
-- and the "does this contact already have an account" check in the
-- invite flow), without constraining the data shape.
CREATE INDEX IF NOT EXISTS idx_customer_contacts_portal_user
  ON customer_contacts(portal_user_id)
  WHERE portal_user_id IS NOT NULL;
