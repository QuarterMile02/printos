CREATE TABLE IF NOT EXISTS public.document_settings (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_type         text        NOT NULL CHECK (document_type IN ('quote', 'sales_order', 'invoice')),
  terms_and_conditions  text,
  paper_size            text        NOT NULL DEFAULT 'letter' CHECK (paper_size IN ('letter', 'legal', 'tabloid')),
  show_signature_line   boolean     NOT NULL DEFAULT true,
  show_deposit_line     boolean     NOT NULL DEFAULT true,
  show_pricing          boolean     NOT NULL DEFAULT true,
  show_unit_price       boolean     NOT NULL DEFAULT true,
  show_line_totals      boolean     NOT NULL DEFAULT true,
  show_subtotal         boolean     NOT NULL DEFAULT true,
  show_tax_line         boolean     NOT NULL DEFAULT true,
  show_production_notes boolean     NOT NULL DEFAULT false,
  footer_note           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, document_type)
);

-- Grants
GRANT SELECT ON public.document_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_settings TO service_role;

-- RLS
ALTER TABLE public.document_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view document_settings"
  ON public.document_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = document_settings.organization_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org admins can manage document_settings"
  ON public.document_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = document_settings.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

-- Seed default rows for all existing orgs
INSERT INTO public.document_settings (organization_id, document_type)
SELECT o.id, dt.doc_type
FROM public.organizations o
CROSS JOIN (VALUES ('quote'), ('sales_order'), ('invoice')) AS dt(doc_type)
ON CONFLICT (organization_id, document_type) DO NOTHING;
