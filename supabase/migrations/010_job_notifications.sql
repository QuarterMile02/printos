-- ============================================================
-- PrintOS — Job notification log
-- ============================================================

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

create policy "Org members can view job notifications"
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
