-- Notifications N4 (approved by the owner 2026-10-11): an app notification that couldn't reach the platform
-- (unreachable, too slow, 5xx) waits here and the daily / evening jobs send it again (kit.retryOutbox in
-- packages/module-kit). Only failures are stored, so the table stays small; rows are never deleted.
create table document_store.notification_outbox (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  input       jsonb not null,
  attempts    integer not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  given_up_at timestamptz
);
create index notification_outbox_waiting on document_store.notification_outbox (tenant_id, created_at)
  where sent_at is null and given_up_at is null;

alter table document_store.notification_outbox enable row level security;
alter table document_store.notification_outbox force row level security;
create policy tenant_isolation on document_store.notification_outbox
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

grant select, insert on document_store.notification_outbox to doc_app;
grant update (attempts, last_error, sent_at, given_up_at) on document_store.notification_outbox to doc_app;

-- the retry job lists plants with waiting notifications (ids only), then works inside each plant as usual
create function document_store.outbox_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from document_store.notification_outbox where sent_at is null and given_up_at is null
$$;
revoke all on function document_store.outbox_tenants() from public;
grant execute on function document_store.outbox_tenants() to doc_app;
