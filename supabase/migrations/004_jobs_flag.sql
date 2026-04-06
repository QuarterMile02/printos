-- ============================================================
-- PrintOS — Add flag column to jobs
-- ============================================================

create type job_flag as enum ('file_error', 'help_needed');

alter table jobs add column flag job_flag;

create index idx_jobs_flag on jobs(organization_id, flag) where flag is not null;
