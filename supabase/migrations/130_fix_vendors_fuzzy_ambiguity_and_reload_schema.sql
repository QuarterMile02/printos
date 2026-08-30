-- ============================================================
-- Migration 130: Fix search_vendors_fuzzy overload ambiguity + force
-- a PostgREST schema cache reload
-- Applied: NOT YET APPLIED — proposed only, paste into Supabase SQL editor to run
-- ============================================================
--
-- Discovered live-verifying migration 129: there was a SECOND, previously
-- undocumented `search_vendors_fuzzy(p_org_id uuid, p_term text, p_limit
-- integer)` overload already live in the database — same undocumented-
-- live-drift pattern as everything else in this cleanup, just not caught
-- by the original investigation (schema-drift-findings.md only found the
-- 2-arg version's broken column set, not that a second overload existed
-- at all). It returns the exact same broken (id, name, is_active) shape
-- the 2-arg version had before migration 129 fixed it -- almost certainly
-- someone applying the same "add p_limit" pattern search_customers_fuzzy
-- got via migration 097, live, without checking in a migration for it.
--
-- migration 129's CREATE OR REPLACE only touches the 2-arg signature, so
-- it left this 3-arg one untouched, alive, and now ambiguous: PostgREST
-- can't choose between the two when the app calls with 2 named args
-- (Could not choose the best candidate function...). The real call site
-- (vendors/actions.ts's searchVendors) only ever calls with 2 named args
-- (p_org_id, p_term), confirmed via grep -- no migration file or app code
-- anywhere expects a p_limit parameter on this function. Same "confirmed
-- zero real callers" standard as search_customers_fuzzy's dead 3-arg
-- overload in migration 129 -- dropping it here.

DROP FUNCTION IF EXISTS public.search_vendors_fuzzy(uuid, text, integer);

-- Also: after migration 129, search_customers_fuzzy(uuid, text) --
-- untouched by that migration, should still exist exactly as it did
-- before -- started returning PGRST202 "could not find the function...
-- in the schema cache" from a live RPC call, consistently across two
-- retries a minute apart. Most likely PostgREST's schema cache ended up
-- in an inconsistent state after the DROP FUNCTION on the 3-arg sibling
-- overload in the same migration. Forcing an explicit reload rather than
-- waiting on Supabase's automatic refresh to catch up on its own.

NOTIFY pgrst, 'reload schema';
