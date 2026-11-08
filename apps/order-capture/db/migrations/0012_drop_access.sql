-- Drop (customer app) Phase 1 (owner, 2026-11-08; docs/CUSTOMER_APP_PHASE_PLAN.md "Database"): which shops may use
-- Drop and which brands they see, their extra phones, login codes and app sessions. Four new tables with FORCE RLS;
-- order_app may read and add rows, and change only the columns listed in section 6. Nothing is ever deleted. No
-- existing table, column or grant changes. Backward-compatible: v0.48.x code ignores the new tables; the two triggers
-- only refuse a phone that would belong to two shops, which v0.48.x can't create (it has no extra phones).

-- 1. "Can use Drop" and the brands shown, kept as a history: the newest row per customer is the current setting.
--    `brands` = brands shown besides the plant's main brand (DROP_APPS), e.g. {Mr.Charge}.
create table order_capture.app_access_changes (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  customer_id      uuid not null,
  enabled          boolean not null,
  brands           text[] not null default '{}' check (cardinality(brands) <= 10),
  changed_by       uuid not null,
  changed_by_name  text not null,
  created_at       timestamptz not null default now(),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id)
);
create index app_access_changes_by_customer on order_capture.app_access_changes (tenant_id, customer_id, created_at);

-- 2. Extra phones (the main phone is customers.phone), kept as a history: a phone is an active extra phone of a
--    customer when its newest row for that customer is 'add'.
create table order_capture.app_phone_changes (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  customer_id      uuid not null,
  phone            text not null check (phone ~ '^[6-9][0-9]{9}$'),
  action           text not null check (action in ('add', 'remove')),
  changed_by       uuid not null,
  changed_by_name  text not null,
  created_at       timestamptz not null default now(),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id)
);
create index app_phone_changes_by_phone on order_capture.app_phone_changes (tenant_id, phone, created_at);
create index app_phone_changes_by_customer on order_capture.app_phone_changes (tenant_id, customer_id, created_at);

-- 3. Login codes sent on WhatsApp: only an HMAC of the code is kept (never the code). 10 minutes, single use,
--    5 wrong tries end it.
create table order_capture.app_login_codes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  customer_id  uuid not null,
  phone        text not null check (phone ~ '^[6-9][0-9]{9}$'),
  code_hmac    text not null check (code_hmac ~ '^[0-9a-f]{64}$'),
  expires_at   timestamptz not null,
  attempts     int not null default 0 check (attempts between 0 and 5),
  used_at      timestamptz,
  created_at   timestamptz not null default now(),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id)
);
create index app_login_codes_by_phone on order_capture.app_login_codes (tenant_id, phone, created_at);

-- 4. App sessions: only the token's SHA-256 is kept. 90 days; ended by logout or when the shop / phone loses access.
create table order_capture.app_sessions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  customer_id   uuid not null,
  phone         text not null check (phone ~ '^[6-9][0-9]{9}$'),
  token_sha256  text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  last_seen_at  timestamptz not null default now(),
  ended_at      timestamptz,
  end_reason    text check (end_reason in ('logout', 'switched_off', 'phone_removed', 'customer_off')),
  check ((ended_at is null) = (end_reason is null)),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id)
);
create index app_sessions_by_customer on order_capture.app_sessions (tenant_id, customer_id, created_at);

-- 5. A phone belongs to one shop only (the app code checks first; these triggers are the backstop). A transaction
--    lock on (plant, phone) stops two people adding the same number to two shops at the same moment.
create function order_capture.app_phone_owner(p_tenant uuid, p_phone text) returns uuid
language sql stable as $$
  select customer_id from (
    select distinct on (customer_id) customer_id, action
    from order_capture.app_phone_changes
    where tenant_id = p_tenant and phone = p_phone
    order by customer_id, created_at desc, id desc
  ) newest where action = 'add' limit 1
$$;

create function order_capture.app_phone_check() returns trigger
language plpgsql as $$
declare
  other uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':' || NEW.phone, 0));
  if TG_TABLE_NAME = 'app_phone_changes' then
    if NEW.action <> 'add' then return NEW; end if;
    select id into other from order_capture.customers where tenant_id = NEW.tenant_id and phone = NEW.phone and id <> NEW.customer_id;
    if other is null then
      select owner into other from (select order_capture.app_phone_owner(NEW.tenant_id, NEW.phone) as owner) o where owner <> NEW.customer_id;
    end if;
  else -- customers: a new customer, or a changed mobile
    select owner into other from (select order_capture.app_phone_owner(NEW.tenant_id, NEW.phone) as owner) o where owner <> NEW.id;
  end if;
  if other is not null then
    raise exception 'phone % already belongs to another customer', NEW.phone using errcode = 'unique_violation';
  end if;
  return NEW;
end
$$;

create trigger app_phone_changes_one_shop before insert on order_capture.app_phone_changes
  for each row execute function order_capture.app_phone_check();
create trigger customers_phone_one_shop before insert or update of phone on order_capture.customers
  for each row execute function order_capture.app_phone_check();

-- 6. Row-level security, like every other table, and grants: read + add; the only changes allowed are a code's tries /
--    use and a session's last seen / end.
alter table order_capture.app_access_changes enable row level security;
alter table order_capture.app_access_changes force row level security;
create policy tenant_isolation on order_capture.app_access_changes
  using (tenant_id = current_setting('app.tenant_id')::uuid) with check (tenant_id = current_setting('app.tenant_id')::uuid);
alter table order_capture.app_phone_changes enable row level security;
alter table order_capture.app_phone_changes force row level security;
create policy tenant_isolation on order_capture.app_phone_changes
  using (tenant_id = current_setting('app.tenant_id')::uuid) with check (tenant_id = current_setting('app.tenant_id')::uuid);
alter table order_capture.app_login_codes enable row level security;
alter table order_capture.app_login_codes force row level security;
create policy tenant_isolation on order_capture.app_login_codes
  using (tenant_id = current_setting('app.tenant_id')::uuid) with check (tenant_id = current_setting('app.tenant_id')::uuid);
alter table order_capture.app_sessions enable row level security;
alter table order_capture.app_sessions force row level security;
create policy tenant_isolation on order_capture.app_sessions
  using (tenant_id = current_setting('app.tenant_id')::uuid) with check (tenant_id = current_setting('app.tenant_id')::uuid);

grant select, insert on order_capture.app_access_changes, order_capture.app_phone_changes,
  order_capture.app_login_codes, order_capture.app_sessions to order_app;
grant update (attempts, used_at) on order_capture.app_login_codes to order_app;
grant update (last_seen_at, ended_at, end_reason) on order_capture.app_sessions to order_app;
grant execute on function order_capture.app_phone_owner(uuid, text) to order_app;
