-- ============================================================
-- Migration 172: delivery_methods -- settings table. Build 1 item 5.
-- Applied: PROPOSED, NOT run.
-- ============================================================
--
-- Numbered ahead of material_vendors' delivery_method_id FK (175) since
-- that column needs this table to exist first.
--
-- is_scheduled is the one field driving Build 2's form behavior later
-- ("is_scheduled true = delivery days apply, lead time greys out; false
-- = reverse") -- stored as data specifically so adding a method later
-- (e.g. "Next Day") is a settings row, not a code change, per instruction.
--
-- Org-scoped like every other settings table in this schema (delivery
-- methods could differ per org in a multi-tenant future, and it costs
-- nothing to scope it now vs. retrofitting later).

-- ------------------------------------------------------------
-- STATEMENT 1 of 3 -- create table.
-- ------------------------------------------------------------
CREATE TABLE public.delivery_methods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  is_scheduled    boolean NOT NULL DEFAULT false,
  sort_order      integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

DROP TRIGGER IF EXISTS set_delivery_methods_updated_at ON public.delivery_methods;
CREATE TRIGGER set_delivery_methods_updated_at
  BEFORE UPDATE ON public.delivery_methods
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

ALTER TABLE public.delivery_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can manage delivery_methods" ON public.delivery_methods
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

CREATE INDEX idx_delivery_methods_org ON public.delivery_methods(organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_methods TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_methods TO service_role;
REVOKE ALL ON public.delivery_methods FROM anon;

-- Verification for statement 1:
-- select table_name from information_schema.tables where table_schema = 'public' and table_name = 'delivery_methods';
-- Expected: one row.

-- ------------------------------------------------------------
-- STATEMENT 2 of 3 -- seed the six methods named in the spec, for
-- EVERY existing organization (not hardcoded to one org id, since this
-- table is org-scoped and any org using materials needs these rows to
-- pick from). Idempotent via the UNIQUE (organization_id, name) above.
-- ------------------------------------------------------------
INSERT INTO public.delivery_methods (organization_id, name, is_scheduled, sort_order)
SELECT o.id, v.name, v.is_scheduled, v.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('Local Delivery',     true,  0),
  ('Vendor Truck',       true,  1),
  ('From Manufacturer',  false, 2),
  ('Freight / LTL',      false, 3),
  ('Ground',             false, 4),
  ('Will Call',          false, 5)
) AS v(name, is_scheduled, sort_order)
ON CONFLICT (organization_id, name) DO NOTHING;

-- Verification for statement 2:
-- select name, is_scheduled, sort_order from public.delivery_methods
-- where organization_id = '4ca12dff-97be-4472-8099-ab102a3af01a' order by sort_order;
-- Expected: 6 rows, Local Delivery/Vendor Truck/From Manufacturer/Freight / LTL/Ground/Will Call
-- in that order, is_scheduled true/true/false/false/false/false.

-- ------------------------------------------------------------
-- STATEMENT 3 of 3 -- verification-only row count across all orgs.
-- ------------------------------------------------------------
-- select organization_id, count(*) from public.delivery_methods group by organization_id;
-- Expected: 6 per organization_id.
