ALTER TABLE public.document_settings
  DROP CONSTRAINT IF EXISTS document_settings_document_type_check;

ALTER TABLE public.document_settings
  ADD CONSTRAINT document_settings_document_type_check
  CHECK (document_type IN ('quote', 'sales_order', 'invoice', 'purchase_order'));

-- Seed PO row for all existing orgs
INSERT INTO public.document_settings (organization_id, document_type)
SELECT o.id, 'purchase_order'
FROM public.organizations o
ON CONFLICT (organization_id, document_type) DO NOTHING;
