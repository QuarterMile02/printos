alter table customers
  add column if not exists sms_consent boolean not null default false;
