-- ============================================================
-- Migration 135: customer_contacts staff-email exclusion flag
-- Applied: PENDING — run manually in the Supabase SQL Editor (Ruben),
--   not auto-applied by Claude Code. See chat for context.
-- ============================================================
--
-- Step 2 of the Customer Portal account/invite build plan (rev. 2).
-- Data cleanup pass, no invite/login routes yet (step 3).
--
-- Confirmed live (2026-08-17): 86 customer_contacts rows carry an email
-- on QMI's own domains -- 45 @quartermileinc.com (8 distinct addresses:
-- ruben, sandra, mary, digital2, digital, ric, claudia, rep) and 41
-- @qtrmilegraphics.com (12 distinct addresses: sandra, ruben, sales,
-- bob, ric, mary, rose, info, rep2, andrea, design, jose). These are
-- QMI staff/department addresses that ended up attached as a customer's
-- "contact" (a ShopVOX-import-era artifact -- a rep's email landing in
-- the contact field), not real portal-invite candidates. A staff member
-- must never be invite-eligible for a customer's portal account.
--
-- Domain list, not an email-by-email list -- individually enumerating
-- addresses would already miss several found in this pass (digital@,
-- ric@, rep@, sales@, bob@, rose@, info@, rep2@, andrea@, design@,
-- jose@ were not part of the original 6-address estimate from the
-- duplicate-email investigation) and would keep rotting as staff
-- addresses change.
--
-- is_staff_contact is a data-cleanup FLAG for this backfill and for
-- auditability (staff can see/query which rows were excluded and why).
-- It is deliberately NOT the only defense: the step-3 invite-eligible-
-- contacts query should ALSO check the email domain directly at query
-- time, so a new customer_contacts row created after this backfill
-- (e.g. another @quartermileinc.com address added next month) is
-- excluded immediately rather than silently invite-eligible until
-- someone remembers to re-run a backfill. Belt-and-suspenders, not
-- redundant -- the flag documents intent/history, the live domain
-- check is what actually keeps step 3 safe over time.

ALTER TABLE customer_contacts
  ADD COLUMN IF NOT EXISTS is_staff_contact boolean NOT NULL DEFAULT false;

-- Backfill: flag every row already matching the two known QMI domains.
UPDATE customer_contacts
SET is_staff_contact = true
WHERE lower(email) LIKE '%@quartermileinc.com'
   OR lower(email) LIKE '%@qtrmilegraphics.com';
