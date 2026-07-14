-- ============================================================
-- Migration 073: Shipments
-- Applied: 2026-07-14
-- Tracks shipments attached to sales orders.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.shipments (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_order_id     uuid        NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  carrier            text        CHECK (carrier IN ('UPS', 'FedEx', 'USPS', 'Other')),
  tracking_number    text,
  shipped_date       date,
  estimated_delivery date,
  notes              text,
  status             text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'shipped', 'delivered', 'returned')),
  created_by         uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipments_org
  ON public.shipments(organization_id);

CREATE INDEX IF NOT EXISTS idx_shipments_sales_order
  ON public.shipments(sales_order_id);

-- Grants (required since Supabase policy May 2026)
GRANT SELECT                          ON public.shipments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.shipments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.shipments TO service_role;

-- RLS
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shipments_org_member_select" ON public.shipments;
CREATE POLICY "shipments_org_member_select"
  ON public.shipments FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "shipments_member_manage" ON public.shipments;
CREATE POLICY "shipments_member_manage"
  ON public.shipments FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles
      WHERE id = auth.uid() AND role IN ('owner', 'admin', 'member')
    )
  );
