-- ============================================================
-- PrintOS — Jobs Table
-- ============================================================

create type job_status as enum (
  'new',
  'in_progress',
  'proof_review',
  'ready_for_pickup',
  'completed'
);

create table jobs (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  customer_id      uuid references customers(id) on delete set null,
  job_number       integer not null,
  title            text not null,
  description      text,
  status           job_status not null default 'new',
  due_date         date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, job_number)
);

-- ============================================================
-- Trigger: auto-assign per-org job number
-- ============================================================
-- Uses max+1 within the org. A unique constraint on
-- (organization_id, job_number) will reject the rare concurrent
-- collision so no silent duplicates can exist.

create or replace function set_job_number()
returns trigger
language plpgsql
as $$
begin
  select coalesce(max(job_number), 0) + 1
  into new.job_number
  from jobs
  where organization_id = new.organization_id;
  return new;
end;
$$;

create trigger set_job_number_before_insert
  before insert on jobs
  for each row execute procedure set_job_number();

-- ============================================================
-- Enable RLS
-- ============================================================

alter table jobs enable row level security;

-- ============================================================
-- RLS Policies: jobs
-- ============================================================

create policy "Org members can view jobs"
  on jobs for select
  using (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = jobs.organization_id
        and organization_members.user_id = auth.uid()
    )
  );

create policy "Org members can insert jobs"
  on jobs for insert
  with check (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = jobs.organization_id
        and organization_members.user_id = auth.uid()
        and organization_members.role in ('owner', 'admin', 'member')
    )
  );

create policy "Org members can update jobs"
  on jobs for update
  using (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = jobs.organization_id
        and organization_members.user_id = auth.uid()
        and organization_members.role in ('owner', 'admin', 'member')
    )
  );

create policy "Owners and admins can delete jobs"
  on jobs for delete
  using (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = jobs.organization_id
        and organization_members.user_id = auth.uid()
        and organization_members.role in ('owner', 'admin')
    )
  );

-- ============================================================
-- Trigger: keep updated_at current
-- ============================================================

create trigger set_jobs_updated_at
  before update on jobs
  for each row execute procedure set_updated_at();

-- ============================================================
-- Indexes
-- ============================================================

create index idx_jobs_org_id        on jobs(organization_id);
create index idx_jobs_customer_id   on jobs(customer_id);
create index idx_jobs_status        on jobs(organization_id, status);
create index idx_jobs_due_date      on jobs(organization_id, due_date);
