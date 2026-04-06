-- ============================================================
-- PrintOS — Add manager review flags to quotes
-- ============================================================

alter table quotes add column needs_pricing_approval boolean not null default false;
alter table quotes add column needs_rescue boolean not null default false;

create index idx_quotes_pricing_approval on quotes(organization_id) where needs_pricing_approval = true;
create index idx_quotes_rescue on quotes(organization_id) where needs_rescue = true;
