-- ── 1. Regional preferences + address columns on org_profile ─────────────────
ALTER TABLE public.org_profile
  ADD COLUMN IF NOT EXISTS timezone         text NOT NULL DEFAULT 'America/Chicago',
  ADD COLUMN IF NOT EXISTS date_format      text NOT NULL DEFAULT 'MM/DD/YYYY',
  ADD COLUMN IF NOT EXISTS currency         text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS units            text NOT NULL DEFAULT 'imperial',
  ADD COLUMN IF NOT EXISTS billing_address  jsonb,
  ADD COLUMN IF NOT EXISTS shipping_address jsonb;

-- ── 2. Business hours table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.business_hours (
  id               uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid     NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  day_of_week      integer  NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_open          boolean  NOT NULL DEFAULT true,
  open_time        text     NOT NULL DEFAULT '08:00',
  close_time       text     NOT NULL DEFAULT '17:00',
  UNIQUE (organization_id, day_of_week)
);

ALTER TABLE public.business_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members can read business_hours"  ON public.business_hours;
DROP POLICY IF EXISTS "org admins can manage business_hours" ON public.business_hours;

CREATE POLICY "org members can read business_hours"
  ON public.business_hours FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_id = business_hours.organization_id
        AND user_id = auth.uid()
    )
  );

CREATE POLICY "org admins can manage business_hours"
  ON public.business_hours FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_id = business_hours.organization_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_hours TO authenticated;
GRANT ALL                            ON public.business_hours TO service_role;

-- ── 3. Seed default hours for all existing orgs (Mon–Fri open, Sat–Sun closed)
INSERT INTO public.business_hours (organization_id, day_of_week, is_open, open_time, close_time)
SELECT
  o.id,
  d.day_of_week,
  CASE WHEN d.day_of_week BETWEEN 1 AND 5 THEN true ELSE false END,
  '08:00',
  '17:00'
FROM public.organizations o
CROSS JOIN (
  SELECT 0 AS day_of_week UNION ALL
  SELECT 1               UNION ALL
  SELECT 2               UNION ALL
  SELECT 3               UNION ALL
  SELECT 4               UNION ALL
  SELECT 5               UNION ALL
  SELECT 6
) d
ON CONFLICT (organization_id, day_of_week) DO NOTHING;
