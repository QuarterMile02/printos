-- ============================================================
-- Migration 076: Customer Shipping Addresses
-- Applied: 2026-07-14
-- Stores multiple saved shipping addresses per customer,
-- distinct from the primary billing address on the customers table.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.shipping_addresses (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id     uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  label           text,
  street          text,
  city            text,
  state           text,
  zip             text,
  country         text        NOT NULL DEFAULT 'US',
  is_default      boolean     NOT NULL DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipping_addresses_customer
  ON public.shipping_addresses(customer_id);

CREATE INDEX IF NOT EXISTS idx_shipping_addresses_org
  ON public.shipping_addresses(organization_id);

GRANT SELECT                          ON public.shipping_addresses TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.shipping_addresses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.shipping_addresses TO service_role;

ALTER TABLE public.shipping_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ship_addr_org_member_select" ON public.shipping_addresses;
CREATE POLICY "ship_addr_org_member_select"
  ON public.shipping_addresses FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.profiles WHERE id = auth.uid()
  ));

DROP POLICY IF EXISTS "ship_addr_member_manage" ON public.shipping_addresses;
CREATE POLICY "ship_addr_member_manage"
  ON public.shipping_addresses FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM public.profiles
    WHERE id = auth.uid() AND role IN ('owner', 'admin', 'member')
  ));
