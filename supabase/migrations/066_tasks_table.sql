-- ============================================================
-- Migration 066: Tasks table
-- Applied: 2026-07-11
-- ============================================================

create table if not exists public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  title               text not null,
  description         text,
  assigned_to         uuid references auth.users(id) on delete set null,
  created_by          uuid references auth.users(id) on delete set null,
  related_job_id      uuid references jobs(id) on delete set null,
  related_quote_id    uuid references quotes(id) on delete set null,
  related_customer_id uuid references customers(id) on delete set null,
  status              text not null default 'pending'
                        check (status in ('pending','in_progress','completed','cancelled')),
  priority            text not null default 'normal'
                        check (priority in ('low','normal','high','urgent')),
  due_date            timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index if not exists idx_tasks_org      on public.tasks(organization_id);
create index if not exists idx_tasks_assigned on public.tasks(assigned_to);
create index if not exists idx_tasks_status   on public.tasks(status);

-- Grants (required since Supabase policy May 2026)
grant select                          on public.tasks to anon;
grant select, insert, update, delete  on public.tasks to authenticated;
grant select, insert, update, delete  on public.tasks to service_role;

-- RLS
alter table public.tasks enable row level security;

-- Users can see tasks in their org that are assigned to them or created by them
drop policy if exists "tasks_self_view" on public.tasks;
create policy "tasks_self_view"
  on public.tasks for select
  using (
    assigned_to = auth.uid()
    or created_by = auth.uid()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.organization_id = tasks.organization_id
        and p.role in ('owner','accounting')
    )
    or exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.organization_id = tasks.organization_id
        and p.tier in ('manager','lead')
    )
  );

drop policy if exists "tasks_self_insert" on public.tasks;
create policy "tasks_self_insert"
  on public.tasks for insert
  with check (
    exists (
      select 1 from organization_members om
      where om.organization_id = tasks.organization_id
        and om.user_id = auth.uid()
    )
  );

drop policy if exists "tasks_self_update" on public.tasks;
create policy "tasks_self_update"
  on public.tasks for update
  using (
    assigned_to = auth.uid()
    or created_by = auth.uid()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.organization_id = tasks.organization_id
        and (p.role = 'owner' or p.tier in ('manager','lead'))
    )
  );

drop policy if exists "tasks_self_delete" on public.tasks;
create policy "tasks_self_delete"
  on public.tasks for delete
  using (
    created_by = auth.uid()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.organization_id = tasks.organization_id
        and (p.role = 'owner' or p.tier = 'manager')
    )
  );
