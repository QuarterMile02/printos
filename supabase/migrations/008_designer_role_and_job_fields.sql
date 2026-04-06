-- ============================================================
-- PrintOS — Add designer role and job assignment fields
-- ============================================================

-- Add 'designer' to org_role enum
alter type org_role add value 'designer';

-- Add assignment and revision tracking to jobs
alter table jobs add column assigned_to uuid references auth.users(id) on delete set null;
alter table jobs add column needs_revision boolean not null default false;

create index idx_jobs_assigned_to on jobs(assigned_to) where assigned_to is not null;
create index idx_jobs_needs_revision on jobs(organization_id) where needs_revision = true;
