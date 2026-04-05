-- ============================================================
-- PrintOS — Initial Multi-Tenant Schema
-- ============================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm"; -- for slug/name search

-- ============================================================
-- Enums
-- ============================================================

create type org_role as enum ('owner', 'admin', 'member', 'viewer');
create type org_plan as enum ('free', 'pro', 'enterprise');
create type invite_status as enum ('pending', 'accepted', 'expired');

-- ============================================================
-- Tables (all tables first, before any RLS policies)
-- ============================================================

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table organizations (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  slug         text not null unique,
  plan         org_plan not null default 'free',
  logo_url     text,
  settings     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table organization_members (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  role             org_role not null default 'member',
  created_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table organization_invites (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  email            text not null,
  role             org_role not null default 'member',
  token            text not null unique default encode(gen_random_bytes(32), 'hex'),
  status           invite_status not null default 'pending',
  invited_by       uuid not null references auth.users(id),
  expires_at       timestamptz not null default (now() + interval '7 days'),
  created_at       timestamptz not null default now()
);

-- ============================================================
-- Enable RLS (after all tables exist)
-- ============================================================

alter table profiles enable row level security;
alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table organization_invites enable row level security;

-- ============================================================
-- RLS Policies: profiles
-- ============================================================

create policy "Users can view their own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on profiles for update
  using (auth.uid() = id);

-- ============================================================
-- RLS Policies: organizations
-- (organization_members now exists, so these are safe)
-- ============================================================

create policy "Members can view their organization"
  on organizations for select
  using (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = organizations.id
        and organization_members.user_id = auth.uid()
    )
  );

create policy "Owners and admins can update organization"
  on organizations for update
  using (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = organizations.id
        and organization_members.user_id = auth.uid()
        and organization_members.role in ('owner', 'admin')
    )
  );

-- ============================================================
-- RLS Policies: organization_members
-- ============================================================

create policy "Members can view org members"
  on organization_members for select
  using (
    exists (
      select 1 from organization_members as om
      where om.organization_id = organization_members.organization_id
        and om.user_id = auth.uid()
    )
  );

create policy "Owners and admins can insert members"
  on organization_members for insert
  with check (
    exists (
      select 1 from organization_members as om
      where om.organization_id = organization_members.organization_id
        and om.user_id = auth.uid()
        and om.role in ('owner', 'admin')
    )
  );

create policy "Owners and admins can update member roles"
  on organization_members for update
  using (
    exists (
      select 1 from organization_members as om
      where om.organization_id = organization_members.organization_id
        and om.user_id = auth.uid()
        and om.role in ('owner', 'admin')
    )
  );

create policy "Owners and admins can delete members"
  on organization_members for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from organization_members as om
      where om.organization_id = organization_members.organization_id
        and om.user_id = auth.uid()
        and om.role in ('owner', 'admin')
    )
  );

-- ============================================================
-- RLS Policies: organization_invites
-- ============================================================

create policy "Org members can view invites"
  on organization_invites for select
  using (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = organization_invites.organization_id
        and organization_members.user_id = auth.uid()
    )
  );

create policy "Owners and admins can create invites"
  on organization_invites for insert
  with check (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = organization_invites.organization_id
        and organization_members.user_id = auth.uid()
        and organization_members.role in ('owner', 'admin')
    )
  );

create policy "Owners and admins can update invites"
  on organization_invites for update
  using (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = organization_invites.organization_id
        and organization_members.user_id = auth.uid()
        and organization_members.role in ('owner', 'admin')
    )
  );

-- ============================================================
-- Helper function: get orgs for current user
-- ============================================================

create or replace function get_user_organizations(user_id uuid)
returns table (
  organization_id   uuid,
  organization_name text,
  organization_slug text,
  role              org_role
)
language sql
security definer
set search_path = public
as $$
  select
    o.id   as organization_id,
    o.name as organization_name,
    o.slug as organization_slug,
    om.role
  from organizations o
  join organization_members om on om.organization_id = o.id
  where om.user_id = $1;
$$;

-- ============================================================
-- Trigger: auto-create profile on user signup
-- ============================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- Trigger: keep updated_at current
-- ============================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_organizations_updated_at
  before update on organizations
  for each row execute procedure set_updated_at();

create trigger set_profiles_updated_at
  before update on profiles
  for each row execute procedure set_updated_at();

-- ============================================================
-- Indexes
-- ============================================================

create index idx_org_members_user_id      on organization_members(user_id);
create index idx_org_members_org_id       on organization_members(organization_id);
create index idx_org_invites_token        on organization_invites(token);
create index idx_org_invites_email        on organization_invites(email);
create index idx_organizations_slug       on organizations(slug);
