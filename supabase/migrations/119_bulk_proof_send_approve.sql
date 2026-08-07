-- ============================================================
-- Migration 119: Bulk proof send + independent per-item customer approval
-- Applied: (pending — run manually in Supabase SQL Editor)
-- ============================================================
--
-- Backs the bulk proof-sending feature on the Sales Order detail page:
-- staff check off multiple line items that each have a ready, unapproved
-- proof, click one "Send Proofs" action, and the customer gets ONE email
-- with ONE link (not one email per proof). Inside that single customer
-- session, each proof is approved/rejected independently. Per Ruben's
-- design reference ("Blueprint Section 19").
--
-- Confirmed during planning: no "existing Add New Proof -> Send for
-- Review flow" actually exists in the codebase to extend -- this is new,
-- not a rework.
--
-- proof_versions gets three new columns:
--   quote_line_item_id    — links a proof to the specific quote line item
--                            it belongs to. proof_versions today only has
--                            job_id; bulk send needs to check off "which
--                            line items have a ready proof," which means
--                            walking proof -> line item, not proof -> job.
--                            Nullable + ON DELETE SET NULL so removing a
--                            line item doesn't cascade-delete proof history.
--   customer_feedback      — free-text feedback the customer leaves when
--                            approving/rejecting on the public page.
--                            Text-only for this phase; visual/markup
--                            annotation is explicitly deferred to a later
--                            phase (confirmed with Ruben).
--   customer_responded_at — when the customer acted on this specific
--                            proof, independent of when the other proofs
--                            in the same bundle were (or weren't) acted on.
--
-- proof_sends: one row per "Send Proofs" click -- the bundle itself, and
-- the unguessable token the public /proofs/[token] page is keyed on.
-- token is a separate random uuid column (not the row id) so the id can
-- stay a normal internal PK without doubling as a bearer credential.
--
-- proof_send_items: join table, one row per proof_version included in a
-- given send. Lets one proof appear in multiple sends over time (e.g.
-- resent after a rejection) while each send's own bundle stays a clean,
-- independent set.
--
-- Access model (confirmed with Ruben): status-based lock (once a proof is
-- approved/rejected it's locked from further customer action on that
-- link), no time-based link expiry. The public page has no precedent in
-- this app -- it will be a new unauthenticated route validated
-- server-side against proof_sends.token using the service-role client;
-- the token itself is the entire security boundary, not RLS. Accordingly
-- proof_sends / proof_send_items get NO anon grant below -- the public
-- page never talks to Postgres directly as anon, it goes through a
-- server action that already holds the validated token.

ALTER TABLE proof_versions
  ADD COLUMN IF NOT EXISTS quote_line_item_id uuid REFERENCES quote_line_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_feedback text,
  ADD COLUMN IF NOT EXISTS customer_responded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_proof_versions_quote_line_item ON proof_versions(quote_line_item_id);

-- proof_versions already has its table-level grants from migration
-- 057_backfill_grants.sql (anon: select; authenticated/service_role:
-- select, insert, update, delete) -- those cover the new columns
-- automatically, re-issued below for audit-trail consistency only.
grant select                         on public.proof_versions to anon;
grant select, insert, update, delete on public.proof_versions to authenticated;
grant select, insert, update, delete on public.proof_versions to service_role;

CREATE TABLE IF NOT EXISTS proof_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sales_order_id uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  sent_by uuid REFERENCES auth.users(id),
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE proof_sends ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY ps_select_members ON proof_sends FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ps_insert_non_viewers ON proof_sends FOR INSERT WITH CHECK (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role <> 'viewer')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_proof_sends_sales_order ON proof_sends(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_proof_sends_org ON proof_sends(organization_id);
-- token already has a unique index from the UNIQUE constraint above --
-- that's what the public /proofs/[token] page's service-role lookup hits.

-- No anon grant -- see "Access model" note above. The public page reaches
-- this table only via a server action using the service-role client,
-- after validating the token itself; RLS is staff-facing only here.
grant select, insert, update, delete on public.proof_sends to authenticated;
grant select, insert, update, delete on public.proof_sends to service_role;

CREATE TABLE IF NOT EXISTS proof_send_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_send_id uuid NOT NULL REFERENCES proof_sends(id) ON DELETE CASCADE,
  proof_version_id uuid NOT NULL REFERENCES proof_versions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proof_send_id, proof_version_id)
);

ALTER TABLE proof_send_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY psi_select_members ON proof_send_items FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY psi_insert_non_viewers ON proof_send_items FOR INSERT WITH CHECK (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role <> 'viewer')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_proof_send_items_send ON proof_send_items(proof_send_id);
CREATE INDEX IF NOT EXISTS idx_proof_send_items_proof_version ON proof_send_items(proof_version_id);
CREATE INDEX IF NOT EXISTS idx_proof_send_items_org ON proof_send_items(organization_id);

-- No anon grant -- same rationale as proof_sends above.
grant select, insert, update, delete on public.proof_send_items to authenticated;
grant select, insert, update, delete on public.proof_send_items to service_role;
