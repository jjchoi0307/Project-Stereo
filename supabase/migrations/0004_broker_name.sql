-- Broker display name captured at signup. Agency is the organization (orgs = agencies).
alter table public.brokers add column if not exists name text;
