-- ============================================================
-- PrintOS — Link jobs to their source quote
-- ============================================================

alter table jobs add column source_quote_id uuid references quotes(id) on delete set null;

create index idx_jobs_source_quote on jobs(source_quote_id) where source_quote_id is not null;
