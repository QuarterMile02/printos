-- ============================================================
-- Fix infinite recursion in organization_members RLS policies
--
-- Root cause: the policies on organization_members contained
-- subqueries back onto organization_members, which Postgres
-- re-evaluates the policy for, causing infinite recursion.
--
-- Fix: security definer helper functions bypass RLS when
-- checking membership, so the policies can call them safely.
-- ============================================================

-- ============================================================
-- Helper functions (security definer = bypass RLS)
-- ============================================================

create or replace function is_org_member(org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from organization_members
    where organization_id = org_id
      and user_id = auth.uid()
  );
$$;

create or replace function is_org_admin(org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from organization_members
    where organization_id = org_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

-- ============================================================
-- Drop all recursive policies on organization_members
-- ============================================================

drop policy if exists "Members can view org members"         on organization_members;
drop policy if exists "Owners and admins can insert members" on organization_members;
drop policy if exists "Owners and admins can update member roles" on organization_members;
drop policy if exists "Owners and admins can delete members" on organization_members;

-- ============================================================
-- Drop and rewrite policies on organizations that also
-- referenced organization_members (safe to rewrite for clarity)
-- ============================================================

drop policy if exists "Members can view their organization"      on organizations;
drop policy if exists "Owners and admins can update organization" on organizations;
drop policy if exists "Org members can view invites"             on organization_invites;
drop policy if exists "Owners and admins can create invites"     on organization_invites;
drop policy if exists "Owners and admins can update invites"     on organization_invites;

-- ============================================================
-- Recreate organization_members policies using helper functions
-- ============================================================

create policy "Members can view org members"
  on organization_members for select
  using (is_org_member(organization_id));

create policy "Owners and admins can insert members"
  on organization_members for insert
  with check (is_org_admin(organization_id));

create policy "Owners and admins can update member roles"
  on organization_members for update
  using (is_org_admin(organization_id));

create policy "Owners and admins can delete members"
  on organization_members for delete
  using (
    user_id = auth.uid()
    or is_org_admin(organization_id)
  );

-- ============================================================
-- Recreate organizations policies using helper functions
-- ============================================================

create policy "Members can view their organization"
  on organizations for select
  using (is_org_member(id));

create policy "Owners and admins can update organization"
  on organizations for update
  using (is_org_admin(id));

-- ============================================================
-- Recreate organization_invites policies using helper functions
-- ============================================================

create policy "Org members can view invites"
  on organization_invites for select
  using (is_org_member(organization_id));

create policy "Owners and admins can create invites"
  on organization_invites for insert
  with check (is_org_admin(organization_id));

create policy "Owners and admins can update invites"
  on organization_invites for update
  using (is_org_admin(organization_id));
