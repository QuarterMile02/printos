-- ============================================================
-- Migration 071: General Categories
-- Applied: 2026-07-14
-- Used across quotes, jobs, and assets for tagging/categorization.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.general_categories (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  type            text        NOT NULL CHECK (type IN ('quote', 'job', 'asset', 'all')),
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS general_categories_org_name_type_uq
  ON public.general_categories(organization_id, name, type);

CREATE INDEX IF NOT EXISTS idx_general_categories_org
  ON public.general_categories(organization_id);

-- Grants (required since Supabase policy May 2026)
GRANT SELECT                          ON public.general_categories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.general_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.general_categories TO service_role;

-- RLS
ALTER TABLE public.general_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gc_org_member_select" ON public.general_categories;
CREATE POLICY "gc_org_member_select"
  ON public.general_categories FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "gc_owner_manage" ON public.general_categories;
CREATE POLICY "gc_owner_manage"
  ON public.general_categories FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles
      WHERE id = auth.uid() AND role = 'owner'
    )
  );

-- ── Seed for all existing organizations ───────────────────────────────────────
INSERT INTO public.general_categories (organization_id, name, type)
SELECT o.id, v.name, v.type
FROM public.organizations o
CROSS JOIN (VALUES
  -- Asset
  ('Client Quote',        'asset'),
  ('Other',               'asset'),
  ('Survey Photos',       'asset'),
  ('Proof',               'asset'),
  ('Job Proof',           'asset'),
  ('Customer RFP',        'asset'),
  ('Drafting',            'asset'),
  ('Intake Form',         'asset'),
  ('Customer Art File',   'asset'),
  ('Customer Docs',       'asset'),
  ('Customer Sample',     'asset'),
  ('Approved Proof',      'asset'),
  ('Approval Signature',  'asset'),
  ('Mockup',              'asset'),
  -- Job
  ('Installation',        'job'),
  ('Production',          'job'),
  ('Design',              'job'),
  ('Proof',               'job'),
  ('Delivery',            'job'),
  -- Quote
  ('Standard',            'quote'),
  ('Rush',                'quote'),
  ('Contract',            'quote')
) AS v(name, type)
ON CONFLICT (organization_id, name, type) DO NOTHING;
