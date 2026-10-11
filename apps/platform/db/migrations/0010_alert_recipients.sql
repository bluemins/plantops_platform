-- Notifications N2 (decided by the owner 2026-10-11): besides the owners, only people the owner picks get a
-- module's app notifications (e.g. a manager for Floor Stock). One row per person per module; unticking deletes
-- the row (the audit log keeps the history, like roles in user_roles). The platform re-checks at send time that
-- the person is active and still works in that module.
create table platform.alert_recipients (
  tenant_id  uuid not null references platform.tenants (id),
  user_id    uuid not null references platform.users (id),
  module_id  text not null references platform.modules (id),
  added_by   text not null,
  added_at   timestamptz not null default now(),
  primary key (tenant_id, user_id, module_id)
);

alter table platform.alert_recipients enable row level security;
alter table platform.alert_recipients force row level security;
create policy tenant_isolation on platform.alert_recipients
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

grant select, insert, delete on platform.alert_recipients to platform_app, platform_super;
