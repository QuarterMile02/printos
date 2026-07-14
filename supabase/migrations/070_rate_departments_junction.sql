-- ============================================================
-- Migration 070: Multi-department junction tables for labor and machine rates
-- Applied: 2026-07-14
-- Keeps existing department_id columns (not dropped) for backward compat.
-- ============================================================

-- ── labor_rate_departments ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.labor_rate_departments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  labor_rate_id  uuid NOT NULL REFERENCES public.labor_rates(id)  ON DELETE CASCADE,
  department_id  uuid NOT NULL REFERENCES public.departments(id)  ON DELETE CASCADE,
  UNIQUE(labor_rate_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_lrd_labor_rate  ON public.labor_rate_departments(labor_rate_id);
CREATE INDEX IF NOT EXISTS idx_lrd_department  ON public.labor_rate_departments(department_id);

-- ── machine_rate_departments ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.machine_rate_departments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_rate_id uuid NOT NULL REFERENCES public.machine_rates(id) ON DELETE CASCADE,
  department_id   uuid NOT NULL REFERENCES public.departments(id)   ON DELETE CASCADE,
  UNIQUE(machine_rate_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_mrd_machine_rate ON public.machine_rate_departments(machine_rate_id);
CREATE INDEX IF NOT EXISTS idx_mrd_department   ON public.machine_rate_departments(department_id);

-- ── Grants (required since Supabase policy May 2026) ──────────────────────────
GRANT SELECT                          ON public.labor_rate_departments   TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.labor_rate_departments   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.labor_rate_departments   TO service_role;

GRANT SELECT                          ON public.machine_rate_departments  TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.machine_rate_departments  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.machine_rate_departments  TO service_role;

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.labor_rate_departments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_rate_departments ENABLE ROW LEVEL SECURITY;

-- labor_rate_departments: allow org members to read/write
DROP POLICY IF EXISTS "lrd_org_member" ON public.labor_rate_departments;
CREATE POLICY "lrd_org_member"
  ON public.labor_rate_departments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.labor_rates lr
      JOIN public.organization_members om ON om.organization_id = lr.organization_id
      WHERE lr.id = labor_rate_departments.labor_rate_id
        AND om.user_id = auth.uid()
    )
  );

-- machine_rate_departments: allow org members to read/write
DROP POLICY IF EXISTS "mrd_org_member" ON public.machine_rate_departments;
CREATE POLICY "mrd_org_member"
  ON public.machine_rate_departments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.machine_rates mr
      JOIN public.organization_members om ON om.organization_id = mr.organization_id
      WHERE mr.id = machine_rate_departments.machine_rate_id
        AND om.user_id = auth.uid()
    )
  );
