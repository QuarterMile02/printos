ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone2 text;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO service_role;
