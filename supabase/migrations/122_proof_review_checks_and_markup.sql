-- ============================================================
-- Migration 122: Required review checkboxes + customer markup upload
-- Applied: (pending — run manually in Supabase SQL Editor)
-- ============================================================
--
-- Backs two related additions to the public /proofs/[token] customer
-- review page:
--
-- customer_checks_acknowledged_at — set only at the moment a customer
--   approves a proof AND the server has independently verified (not just
--   trusted a disabled/enabled button state) that all required review
--   checkboxes (Colors, Text, Spelling, Logos, Finishes, Color-variance
--   disclaimer) were affirmatively checked. This is deliberately separate
--   from customer_responded_at (migration 119): responded_at fires for
--   approve AND reject, this fires ONLY for a verified-acknowledged
--   approval. Given the checkbox disclaimer text is explicit liability
--   language ("we're not responsible for errors caused by misspelled
--   words or typos... won't be eligible for a free reprint"), this column
--   is the durable record that the gate was actually enforced for this
--   specific approval, independent of whatever the current server-side
--   validation logic happens to be at the time -- it survives that logic
--   changing or having a bug later.
--
-- customer_markup_file_url — an optional file the customer uploads
--   alongside their typed feedback when requesting changes (e.g. a photo
--   of a printed, hand-marked-up proof). One file per response, same
--   cardinality as customer_feedback (a proof_versions row represents one
--   customer response to one proof version) -- not a separate table,
--   since there's no requirement yet for multiple markup files per
--   response. Public upload path stores to a NEW 'proof-markups' storage
--   bucket (kept separate from the staff-uploaded 'proofs' bucket
--   deliberately, so customer-supplied content is never mixed into the
--   same namespace as staff-uploaded proof files), created public (same
--   convention as 'proofs' -- see migration 119 / proof-actions.ts) so
--   the file is viewable the same simple way proof files already are.
--   The actual upload write path reuses respond-to-proof-core.ts's
--   token -> proof_sends -> proof_send_items membership-check sequence
--   before ever calling storage.upload -- there being no RLS backing an
--   anonymous caller here (same as every other public-page write).

ALTER TABLE proof_versions
  ADD COLUMN IF NOT EXISTS customer_checks_acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_markup_file_url text;

-- Grants — explicit per project policy, even though this is column-only.
-- proof_versions already has explicit whole-table grants
-- (supabase/migrations/057_backfill_grants.sql: anon selects, authenticated/
-- service_role full) -- re-issued below for audit-trail consistency only,
-- same as migration 119's identical note.
grant select                         on public.proof_versions to anon;
grant select, insert, update, delete on public.proof_versions to authenticated;
grant select, insert, update, delete on public.proof_versions to service_role;
