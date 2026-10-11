-- App notifications (approved by the owner 2026-10-11): one inbox in the platform for every module, shown as a
-- bell on the launcher and sent to installed phones by Web Push (free; no email / SMS / WhatsApp).
-- Modules only send events (POST /api/m/tenants/:tid/notifications); the platform decides who receives them.

-- One row per recipient, so each person has their own "read" mark.
create table platform.notifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references platform.tenants (id),
  user_id     uuid not null references platform.users (id),
  module_id   text not null references platform.modules (id),
  kind        text not null check (length(kind) between 1 and 60),
  title       text not null check (length(title) between 1 and 80),
  body        text not null default '' check (length(body) <= 300),
  -- a path inside the module ("/day/2026-10-11"); opened through /sso/start
  link        text check (link is null or (link like '/%' and length(link) <= 500)),
  -- "push": phone + bell; "bell": the launcher list only (e.g. setup changes, so building a list doesn't flood phones)
  level       text not null default 'push' check (level in ('push', 'bell')),
  -- the same event sent twice (retry, double click) is stored once per person, per module
  dedupe_key  text not null check (length(dedupe_key) between 1 and 200),
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  unique (tenant_id, user_id, module_id, dedupe_key)
);
create index notifications_inbox on platform.notifications (tenant_id, user_id, created_at desc);

-- A phone or browser that turned on notifications (Web Push subscription). Removed on logout, or when the push
-- service says it is gone. Unique per plant (each plant sees only its own rows, so a global unique would fail
-- invisibly for a phone already used in another plant); a second user of the same phone in a plant takes it over.
create table platform.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references platform.tenants (id),
  user_id     uuid not null references platform.users (id),
  endpoint    text not null check (endpoint like 'https://%' and length(endpoint) <= 1000),
  p256dh      text not null check (length(p256dh) <= 200),
  auth        text not null check (length(auth) <= 100),
  user_agent  text check (length(user_agent) <= 300),
  created_at  timestamptz not null default now(),
  unique (tenant_id, endpoint)
);
create index push_subscriptions_user on platform.push_subscriptions (tenant_id, user_id);

do $$
declare t text;
begin
  foreach t in array array['notifications', 'push_subscriptions'] loop
    execute format('alter table platform.%I enable row level security', t);
    execute format('alter table platform.%I force row level security', t);
    execute format(
      'create policy tenant_isolation on platform.%I
         using (tenant_id = current_setting(''app.tenant_id'')::uuid)
         with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- ---------- permissions ----------
-- Notifications are never edited or deleted, only marked read.
grant select, insert on platform.notifications to platform_app;
grant update (read_at) on platform.notifications to platform_app;
grant select, insert, delete on platform.push_subscriptions to platform_app;
