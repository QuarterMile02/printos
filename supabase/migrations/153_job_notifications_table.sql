-- ============================================================
-- Migration 153: job_notifications -- the table migration 010 was
-- supposed to create and never did ("Built But Not Connected" audit
-- finding #6).
-- Applied: CONFIRMED LIVE in Supabase (2026-08-19) -- verified via
--   pg_type / information_schema.tables / pg_policies / pg_indexes,
--   not the success message.
--
-- One statement below was NOT in the file as originally pasted and had
-- to be added after the fact: the final REVOKE. After the two GRANT
-- statements landed, information_schema.role_table_grants showed
-- `anon` holding full privileges on this table (DELETE, INSERT,
-- UPDATE, TRUNCATE, SELECT, REFERENCES, TRIGGER) -- Postgres's default
-- PUBLIC grant on a newly created table, not anything this migration
-- asked for. RLS blocks anon reads/writes, but TRUNCATE bypasses RLS
-- entirely, so this was a real gap, not a cosmetic one. Ruben ran
-- `revoke all on public.job_notifications from anon;` and confirmed
-- anon no longer appears in role_table_grants for this table. That
-- REVOKE is now included below as a required part of this migration,
-- not optional cleanup -- run it immediately after the two GRANTs.
-- ============================================================
--
-- Confirmed live via to_regclass: this table does not exist. But
-- src/app/(dashboard)/dashboard/[slug]/jobs/actions.ts:325 does an
-- unguarded `service.from('job_notifications').insert(...)` in the
-- "mark job ready -> notify customer" flow, positioned AFTER the real
-- email/SMS to the customer has already been sent -- so today that
-- insert throws a real Postgres 42703 error on every notify, right
-- after the customer was actually notified. The insert is being made
-- non-fatal in the same pass (see the app code diff, not this file),
-- but it still needs somewhere to log to once it stops being fatal.
--
-- Shape taken from migration 010's original (never-applied) definition,
-- cross-checked against what the app actually inserts today
-- (jobs/actions.ts:325-330: job_id, customer_id, method, status) --
-- they match exactly, so the original design is used as-is rather than
-- redesigned.

create type notification_method as enum ('email', 'sms', 'both');

create table job_notifications (
  id               uuid primary key default uuid_generate_v4(),
  job_id           uuid not null references jobs(id) on delete cascade,
  customer_id      uuid references customers(id) on delete set null,
  method           notification_method not null,
  sent_at          timestamptz not null default now(),
  status           text not null default 'sent',
  created_at       timestamptz not null default now()
);

alter table job_notifications enable row level security;

create policy "org members can view job notifications"
  on job_notifications for select
  using (
    exists (
      select 1 from jobs
      join organization_members on organization_members.organization_id = jobs.organization_id
      where jobs.id = job_notifications.job_id
        and organization_members.user_id = auth.uid()
    )
  );

create index idx_job_notifications_job on job_notifications(job_id);

-- Grants re-issued per this codebase's standing convention (explicit
-- grants required on every migration touching a new table since
-- Supabase stopped auto-granting, May 2026 -- migrations 120/128's
-- note). The actual write path uses the service-role client
-- (jobs/actions.ts:325), which bypasses RLS/grants entirely, but this
-- keeps the table consistent with every other table in the schema.
grant select, insert, update, delete on public.job_notifications to authenticated;
grant select, insert, update, delete on public.job_notifications to service_role;
revoke all on public.job_notifications from anon;
