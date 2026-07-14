-- ============================================================
-- Migration 072: Custom Notes
-- Applied: 2026-07-14
-- Predefined text snippets for quick-fill on quotes, jobs, orders.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.custom_notes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title           text        NOT NULL,
  body            text        NOT NULL,
  type            text        NOT NULL CHECK (type IN ('void_reason', 'lost_reason', 'customer_note', 'job_note', 'quote_note')),
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS custom_notes_org_title_type_uq
  ON public.custom_notes(organization_id, title, type);

CREATE INDEX IF NOT EXISTS idx_custom_notes_org
  ON public.custom_notes(organization_id);

CREATE INDEX IF NOT EXISTS idx_custom_notes_type
  ON public.custom_notes(organization_id, type);

-- Grants (required since Supabase policy May 2026)
GRANT SELECT                          ON public.custom_notes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.custom_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.custom_notes TO service_role;

-- RLS
ALTER TABLE public.custom_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cn_org_member_select" ON public.custom_notes;
CREATE POLICY "cn_org_member_select"
  ON public.custom_notes FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "cn_owner_manage" ON public.custom_notes;
CREATE POLICY "cn_owner_manage"
  ON public.custom_notes FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles
      WHERE id = auth.uid() AND role = 'owner'
    )
  );

-- ── Seed for all existing organizations ───────────────────────────────────────
INSERT INTO public.custom_notes (organization_id, title, body, type)
SELECT o.id, v.title, v.body, v.type
FROM public.organizations o
CROSS JOIN (VALUES
  -- void_reason
  ('Duplicate Order',    'This order was entered more than once.',                          'void_reason'),
  ('Customer Cancelled', 'Customer requested cancellation before production began.',        'void_reason'),
  ('Entered in Error',   'Order was created by mistake.',                                   'void_reason'),
  ('Pricing Error',      'Order contained incorrect pricing and must be re-entered.',       'void_reason'),
  -- lost_reason
  ('Price Too High',     'Customer felt our pricing was not competitive.',                  'lost_reason'),
  ('Went with Competitor','Customer chose another vendor.',                                 'lost_reason'),
  ('No Response',        'Customer did not respond to follow-up.',                          'lost_reason'),
  ('Budget Cut',         'Customer''s budget was reduced or eliminated.',                   'lost_reason'),
  ('Timeline',           'We could not meet the customer''s required timeline.',            'lost_reason'),
  -- customer_note
  ('Net 30',             'Customer is on Net 30 payment terms.',                            'customer_note'),
  ('COD',                'Cash on delivery required.',                                      'customer_note'),
  ('Proof Required',     'Customer must approve proof before production.',                  'customer_note'),
  ('Rush Order',         'This customer frequently requests expedited production.',         'customer_note'),
  ('VIP Customer',       'High-value account. Handle with priority and care.',              'customer_note'),
  -- job_note
  ('Handle with Care',   'Product is fragile or sensitive. Use extra packaging.',           'job_note'),
  ('Fragile',            'Item is fragile. Mark packaging and handle accordingly.',         'job_note'),
  ('Customer Pickup',    'Customer will pick up this order. Do not ship.',                  'job_note'),
  ('Requires Installation','This job includes on-site installation by our team.',           'job_note'),
  -- quote_note
  ('Prices valid for 30 days','All pricing in this quote is valid for 30 days from the date of issue.', 'quote_note'),
  ('Does not include installation','Quoted price does not include installation labor or materials.',      'quote_note'),
  ('Tax not included',   'Applicable taxes are not included in this quote and will be added at invoicing.', 'quote_note')
) AS v(title, body, type)
ON CONFLICT (organization_id, title, type) DO NOTHING;
