-- ============================================================
-- Migration 074: Shipping Foundation — Methods, Profiles, extended Shipments
-- Applied: 2026-07-14
-- ============================================================

-- ── Shipping Methods ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shipping_methods (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  carrier         text        CHECK (carrier IN ('fedex', 'ups', 'usps', 'easypost', 'local', 'pickup', 'other')),
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shipping_methods_org_name_uq
  ON public.shipping_methods(organization_id, name);

CREATE INDEX IF NOT EXISTS idx_shipping_methods_org
  ON public.shipping_methods(organization_id);

GRANT SELECT                          ON public.shipping_methods TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.shipping_methods TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.shipping_methods TO service_role;

ALTER TABLE public.shipping_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shmeth_org_member_select" ON public.shipping_methods;
CREATE POLICY "shmeth_org_member_select"
  ON public.shipping_methods FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.profiles WHERE id = auth.uid()
  ));

DROP POLICY IF EXISTS "shmeth_owner_manage" ON public.shipping_methods;
CREATE POLICY "shmeth_owner_manage"
  ON public.shipping_methods FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM public.profiles
    WHERE id = auth.uid() AND role = 'owner'
  ));

-- ── Shipping Profiles ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shipping_profiles (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  length_in       decimal(8,2),
  width_in        decimal(8,2),
  height_in       decimal(8,2),
  max_weight_lbs  decimal(8,2),
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shipping_profiles_org_name_uq
  ON public.shipping_profiles(organization_id, name);

CREATE INDEX IF NOT EXISTS idx_shipping_profiles_org
  ON public.shipping_profiles(organization_id);

GRANT SELECT                          ON public.shipping_profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.shipping_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.shipping_profiles TO service_role;

ALTER TABLE public.shipping_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shprof_org_member_select" ON public.shipping_profiles;
CREATE POLICY "shprof_org_member_select"
  ON public.shipping_profiles FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.profiles WHERE id = auth.uid()
  ));

DROP POLICY IF EXISTS "shprof_owner_manage" ON public.shipping_profiles;
CREATE POLICY "shprof_owner_manage"
  ON public.shipping_profiles FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM public.profiles
    WHERE id = auth.uid() AND role = 'owner'
  ));

-- ── Extend shipments table ───────────────────────────────────────────────────
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS shipping_method_id  uuid       REFERENCES public.shipping_methods(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shipping_profile_id uuid       REFERENCES public.shipping_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS weight_lbs          decimal(8,2),
  ADD COLUMN IF NOT EXISTS length_in           decimal(8,2),
  ADD COLUMN IF NOT EXISTS width_in            decimal(8,2),
  ADD COLUMN IF NOT EXISTS height_in           decimal(8,2),
  ADD COLUMN IF NOT EXISTS quoted_rate         decimal(10,2),
  ADD COLUMN IF NOT EXISTS actual_cost         decimal(10,2),
  ADD COLUMN IF NOT EXISTS label_url           text;

-- ── Seeds ────────────────────────────────────────────────────────────────────
INSERT INTO public.shipping_methods (organization_id, name, carrier)
SELECT o.id, v.name, v.carrier
FROM public.organizations o
CROSS JOIN (VALUES
  ('Delivered by Quarter Mile Employee', 'local'),
  ('Customer Pickup',                    'pickup'),
  ('FedEx Ground',                       'fedex'),
  ('FedEx 2Day',                         'fedex'),
  ('FedEx Overnight',                    'fedex'),
  ('UPS Ground',                         'ups'),
  ('UPS 2nd Day Air',                    'ups'),
  ('UPS Next Day Air',                   'ups'),
  ('USPS Priority Mail',                 'usps'),
  ('USPS First Class',                   'usps')
) AS v(name, carrier)
ON CONFLICT (organization_id, name) DO NOTHING;

INSERT INTO public.shipping_profiles (organization_id, name, length_in, width_in, height_in, max_weight_lbs)
SELECT o.id, v.name, v.l, v.w, v.h, v.mw
FROM public.organizations o
CROSS JOIN (VALUES
  ('Small Package',   12,  12,  12,  10),
  ('Medium Package',  24,  18,  12,  25),
  ('Large Package',   48,  24,  12,  50),
  ('Tube Small',      36,   6,   6,  10),
  ('Tube Large',      60,   8,   8,  20),
  ('Flat Pack Small', 24,  18,   3,  15),
  ('Flat Pack Large', 48,  36,   4,  30),
  ('Pallet',          48,  40,  48, 500)
) AS v(name, l, w, h, mw)
ON CONFLICT (organization_id, name) DO NOTHING;
