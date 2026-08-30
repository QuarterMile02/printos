-- ============================================================
-- Migration 136: fix stale is_staff_contact, re-derive from live email
-- Applied: PENDING — run manually in the Supabase SQL Editor (Ruben),
--   not auto-applied by Claude Code. See chat for context.
-- ============================================================
--
-- Bug found 2026-08-17: is_staff_contact (migration 135) was a one-time
-- backfill with nothing recomputing it afterward. A contact's email
-- changed away from a QMI domain (@quartermileinc.com /
-- @qtrmilegraphics.com) sometime after the backfill -- customer_contacts
-- row 812ce1a7-57f1-4730-acdb-0acda3115877, "Ruben Reyes" /
-- ruben@nstransportllc.com on customer "Nearshoring Transportation LLC"
-- -- but the stale is_staff_contact=true was never cleared, so the
-- "Invite to Portal" button stayed hidden for a real, legitimate customer
-- contact who happens to share a name with QMI's owner.
--
-- saveContact() is fixed separately (application code, not a migration)
-- to recompute this on every create/edit from here on -- see
-- src/app/(dashboard)/dashboard/[slug]/customers/actions.ts.
--
-- This is the one-time data-correction half: re-derive is_staff_contact
-- for EVERY row from its CURRENT email, not the stored flag. Confirmed
-- live before writing this: 0 rows are missing a flag they should have
-- (understated), exactly 1 row has a flag it shouldn't (overstated --
-- the row above). This UPDATE fixes both directions in one pass rather
-- than special-casing the one known-bad row, since the whole point is to
-- stop trusting the stored value at all.
--
-- COALESCE(..., false) matters: 1,177 of 7,894 rows have a NULL email.
-- `lower(NULL) LIKE '...'` evaluates to NULL in Postgres (not false), and
-- is_staff_contact is NOT NULL -- without the COALESCE this UPDATE would
-- try to write NULL into a NOT NULL column for every one of those rows
-- and abort the whole statement. Confirmed live before writing this too,
-- not assumed.

UPDATE customer_contacts
SET is_staff_contact = COALESCE(
  lower(email) LIKE '%@quartermileinc.com' OR lower(email) LIKE '%@qtrmilegraphics.com', false
)
WHERE is_staff_contact IS DISTINCT FROM COALESCE(
  lower(email) LIKE '%@quartermileinc.com' OR lower(email) LIKE '%@qtrmilegraphics.com', false
);
