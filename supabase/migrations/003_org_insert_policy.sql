-- ============================================================
-- Allow authenticated users to create organizations
--
-- No INSERT policy existed on organizations — RLS defaults to
-- deny, blocking all inserts. Any authenticated user should be
-- able to create a new org (they become owner via the
-- organization_members insert that follows).
-- ============================================================

create policy "Authenticated users can create organizations"
  on organizations for insert
  with check (auth.uid() is not null);
